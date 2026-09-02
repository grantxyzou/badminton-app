import { NextRequest, NextResponse } from 'next/server';
import { getContainer, getActiveSessionId, POINTER_ID, DEFAULT_SESSION } from '@/lib/cosmos';
import { isAdminAuthed, isAdminAuthedWithMember, unauthorized } from '@/lib/auth';
import { resolveBirdUsages } from '@/lib/birdWrite';
import { isFlagOn } from '@/lib/flags';
import { sendPushToAll } from '@/lib/push';
import { buildSignupOpenPayload } from '@/lib/pushMessages';
import type { BirdUsage, ETransferRecipient } from '@/lib/types';

function isValidETransferRecipient(value: unknown): value is ETransferRecipient {
  if (!value || typeof value !== 'object') return false;
  const v = value as { name?: unknown; email?: unknown; memo?: unknown };
  if (typeof v.name !== 'string' || !v.name.trim() || v.name.length > 100) return false;
  if (typeof v.email !== 'string' || !v.email.trim() || v.email.length > 200) return false;
  if (v.memo !== undefined && (typeof v.memo !== 'string' || v.memo.length > 200)) return false;
  return true;
}

function isValidAnomalyDismissedList(value: unknown): value is string[] {
  if (!Array.isArray(value)) return false;
  if (value.length > 20) return false;
  return value.every((c) => typeof c === 'string' && c.length > 0 && c.length <= 50);
}

export const dynamic = 'force-dynamic';

/**
 * Removes admin-only fields from a session doc before it goes to a non-admin
 * caller. `eTransferRecipient` is payment PII (rule 10) and `approvedNames` is
 * the invite list (enables name enumeration); both are read only by admin
 * components. Same strip convention as `deleteToken`/`pinHash` elsewhere.
 * `settled` is intentionally kept — it carries the player's own cost.
 */
function stripForPublic<T extends Record<string, unknown>>(session: T) {
  const {
    eTransferRecipient: _etr,
    approvedNames: _an,
    anomaliesAtAdvance: _aaa,
    anomaliesDismissed: _ad,
    ...safe
  } = session;
  return safe;
}

export async function GET(req: NextRequest) {
  try {
    const sessionId = await getActiveSessionId();
    const container = getContainer('sessions');
    const { resources } = await container.items
      .query({
        query: 'SELECT * FROM c WHERE c.id = @id',
        parameters: [{ name: '@id', value: sessionId }],
      })
      .fetchAll();
    const session = resources.find((r) => r.id !== POINTER_ID)
      ?? { ...DEFAULT_SESSION, id: sessionId, sessionId };
    return NextResponse.json(isAdminAuthed(req) ? session : stripForPublic(session));
  } catch (error) {
    console.error('GET session error:', error);
    return NextResponse.json(DEFAULT_SESSION);
  }
}

export function toValidIso(val: unknown): string {
  const s = String(val ?? '').slice(0, 30);
  return s && !isNaN(Date.parse(s)) ? s : '';
}

export async function PUT(req: NextRequest) {
  if (!(await isAdminAuthedWithMember(req)).authed) return unauthorized();

  try {
    const body = await req.json();
    const sessionId = await getActiveSessionId();

    // Build updates from ONLY the keys the body actually supplied. A field the
    // editing client doesn't send (e.g. a date-only editor sends only datetimes)
    // must be left untouched, not reset to a default — see the read-spread below.
    const updates: Record<string, unknown> = {};
    if (body.title !== undefined) updates.title = String(body.title ?? '').trim().slice(0, 100);
    if (body.locationName !== undefined) updates.locationName = String(body.locationName ?? '').trim().slice(0, 200);
    if (body.locationAddress !== undefined) updates.locationAddress = String(body.locationAddress ?? '').trim().slice(0, 300);
    if (body.datetime !== undefined) updates.datetime = toValidIso(body.datetime);
    if (body.endDatetime !== undefined) updates.endDatetime = toValidIso(body.endDatetime);
    if (body.deadline !== undefined) updates.deadline = toValidIso(body.deadline);
    if (body.courts !== undefined) updates.courts = Math.max(1, Math.min(20, parseInt(body.courts, 10) || 2));
    if (body.maxPlayers !== undefined) updates.maxPlayers = Math.max(1, Math.min(100, parseInt(body.maxPlayers, 10) || 12));
    if (typeof body.signupOpen === 'boolean') updates.signupOpen = body.signupOpen;
    if (typeof body.costPerCourt === 'number') updates.costPerCourt = Math.max(0, Math.min(500, body.costPerCourt));
    if (typeof body.showCostBreakdown === 'boolean') updates.showCostBreakdown = body.showCostBreakdown;

    // Handle bird usages — array of { purchaseId, tubes }. Resolved through the
    // shared contract (validate → dedup → drop tubes:0 → batch-read → snapshot)
    // so this and advance can never validate or cost differently. An entry with
    // tubes:0 removes that purchase (Decision: 0 = remove, same as the
    // retro-assign PATCH). Only run when the client actually sent the array —
    // absent means "leave birdUsages untouched".
    let birdUsages: BirdUsage[] | undefined = undefined;
    if (Array.isArray(body.birdUsages)) {
      const resolved = await resolveBirdUsages(body.birdUsages);
      if (!resolved.ok) return NextResponse.json({ error: resolved.error }, { status: resolved.status });
      birdUsages = resolved.usages;
    }

    if (body.eTransferRecipient !== undefined && !isValidETransferRecipient(body.eTransferRecipient)) {
      return NextResponse.json({ error: 'Invalid eTransferRecipient' }, { status: 400 });
    }
    if (body.anomaliesDismissed !== undefined && !isValidAnomalyDismissedList(body.anomaliesDismissed)) {
      return NextResponse.json({ error: 'Invalid anomaliesDismissed' }, { status: 400 });
    }

    if (birdUsages !== undefined) updates.birdUsages = birdUsages;
    if (body.eTransferRecipient !== undefined) updates.eTransferRecipient = body.eTransferRecipient;
    if (body.anomaliesDismissed !== undefined) updates.anomaliesDismissed = body.anomaliesDismissed;

    const container = getContainer('sessions');
    // Read the existing doc FIRST and spread it, so fields the editing client
    // never sent (settled, approvedNames, prev*, anomaliesAtAdvance) survive.
    // A fixed-key upsert silently wipes them — the atomic-merge-over-PUT rule
    // (CLAUDE.md), same pattern as /api/session/dismiss-anomaly.
    const { resources } = await container.items
      .query({ query: 'SELECT * FROM c WHERE c.id = @id', parameters: [{ name: '@id', value: sessionId }] })
      .fetchAll();
    const existing = (resources.find((r) => r.id !== POINTER_ID) ?? {}) as Record<string, unknown>;

    const sessionData: Record<string, unknown> = { ...existing, ...updates, id: sessionId, sessionId };
    // When writing the new birdUsages array, drop the legacy single-object
    // `birdUsage` field (the old full-doc replace dropped it implicitly; the
    // read-spread would otherwise let it linger alongside the array).
    if (birdUsages !== undefined) delete sessionData.birdUsage;

    // Sign-ups just opened? `existing` is already in hand for the merge above,
    // so the edge costs no extra read.
    //
    // Strict `=== false` is deliberate: CLAUDE.md documents that an ABSENT
    // signupOpen means OPEN, so an absent -> true transition is not an edge and
    // must not notify. Sessions created by /advance always set signupOpen:false
    // explicitly, so the real flow is always an explicit false -> true.
    const wasClosed = existing.signupOpen === false;
    const willOpen = sessionData.signupOpen === true;
    const notYetNotified = typeof existing.signupOpenNotifiedAt !== 'string';
    const shouldNotify =
      wasClosed && willOpen && notYetNotified && isFlagOn('NEXT_PUBLIC_FLAG_PUSH_NOTIFY');

    const now = new Date().toISOString();
    // Record the first open regardless of the flag — it's plain session
    // history, and it's the value calculateSignupOpensOffset (advance route)
    // currently hardcodes to 0 for want of it.
    if (wasClosed && willOpen && typeof existing.signupOpenedAt !== 'string') {
      sessionData.signupOpenedAt = now;
    }
    // Stamp in the SAME upsert as the flip: a second write would race the
    // optimistic client toggle in NextSessionCard and could double-send.
    if (shouldNotify) sessionData.signupOpenNotifiedAt = now;

    const { resource } = await container.items.upsert(sessionData);

    // Persist first, notify best-effort — a push failure must never fail the
    // admin's toggle (same posture as app/api/report/route.ts).
    if (shouldNotify) {
      try {
        await sendPushToAll(buildSignupOpenPayload(sessionData as Parameters<typeof buildSignupOpenPayload>[0]));
      } catch (err) {
        console.error('[session] signup-open push failed (session still saved):', err);
      }
    }

    return NextResponse.json(resource);
  } catch (error) {
    console.error('PUT session error:', error);
    return NextResponse.json({ error: 'Failed to update session' }, { status: 500 });
  }
}
