import { NextRequest, NextResponse } from 'next/server';
import { getContainer, getActiveSessionId, POINTER_ID, DEFAULT_SESSION } from '@/lib/cosmos';
import { isAdminAuthed, isAdminAuthedWithMember, unauthorized } from '@/lib/auth';
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
    // editing client doesn't send (e.g. DateTimeEditor sends only datetimes)
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

    // Handle bird usages — array of { purchaseId, tubes }. Each entry is
    // looked up live so cost snapshots are authoritative.
    let birdUsages: BirdUsage[] | undefined = undefined;
    if (Array.isArray(body.birdUsages)) {
      const entries: BirdUsage[] = [];
      const birdsContainer = getContainer('birds');
      for (const entry of body.birdUsages) {
        const tubes = Number(entry?.tubes);
        if (!Number.isFinite(tubes) || tubes <= 0 || tubes > 100) {
          return NextResponse.json({ error: 'Bird tubes must be between 0 and 100' }, { status: 400 });
        }
        // Multiple of 0.25 — rejects 0.33, 1.7, etc.
        if (Math.round(tubes * 4) !== tubes * 4) {
          return NextResponse.json({ error: 'Bird tubes must be in 0.25 increments' }, { status: 400 });
        }
        const purchaseId = entry?.purchaseId;
        if (typeof purchaseId !== 'string' || !purchaseId) {
          return NextResponse.json({ error: 'Bird purchase must be selected' }, { status: 400 });
        }
        const { resource: purchase } = await birdsContainer.item(purchaseId, purchaseId).read();
        if (!purchase) {
          return NextResponse.json({ error: 'Selected bird purchase not found' }, { status: 404 });
        }
        entries.push({
          purchaseId: purchase.id,
          purchaseName: purchase.name,
          tubes,
          costPerTube: purchase.costPerTube,
          totalBirdCost: Math.round(tubes * purchase.costPerTube * 100) / 100,
        });
      }
      birdUsages = entries;
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
    const { resource } = await container.items.upsert(sessionData);
    return NextResponse.json(resource);
  } catch (error) {
    console.error('PUT session error:', error);
    return NextResponse.json({ error: 'Failed to update session' }, { status: 500 });
  }
}
