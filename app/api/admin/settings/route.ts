import { NextRequest, NextResponse } from 'next/server';
import { getContainer } from '@/lib/cosmos';
import { isAdminAuthedWithMember, unauthorized } from '@/lib/auth';
import { resolveGroupId } from '@/lib/groupContext';
import { isFlagOn } from '@/lib/flags';
import { readGroup, updateGroupSettings } from '@/lib/groups';
import type { ETransferRecipient } from '@/lib/types';

export const dynamic = 'force-dynamic';

const SKIP_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_SKIP_DATES = 100;

function isValidETransferRecipient(value: unknown): value is ETransferRecipient {
  if (!value || typeof value !== 'object') return false;
  const v = value as { name?: unknown; email?: unknown; memo?: unknown };
  if (typeof v.name !== 'string' || !v.name.trim() || v.name.length > 100) return false;
  if (typeof v.email !== 'string' || !v.email.trim() || v.email.length > 200) return false;
  if (v.memo !== undefined && (typeof v.memo !== 'string' || v.memo.length > 200)) return false;
  return true;
}

function isValidSkipDates(value: unknown): value is string[] {
  if (!Array.isArray(value)) return false;
  if (value.length > MAX_SKIP_DATES) return false;
  return value.every((d) => typeof d === 'string' && SKIP_DATE_RE.test(d));
}

/**
 * The club's settings (eTransferRecipient, skipDates). Reading from
 * /api/members and finding `role === 'admin'` is fragile when there are
 * multiple admins and breaks if the public list changes shape; this endpoint
 * is auth-gated.
 *
 * WHERE THEY LIVE (multi-group Phase 2): on the GROUP doc, `groups.settings`,
 * which is what makes them the club's rather than one admin's. With the flag
 * on, and a group doc present, that is the answer; otherwise — flag off, or
 * BPM before the backfill has created its doc — they are read from the
 * calling admin's own Member doc, where they always were. PATCH writes BOTH
 * (the Member fields stay for rollback: older code reads only those).
 */
const groupsOn = () => isFlagOn('NEXT_PUBLIC_FLAG_MULTI_GROUP');

export async function GET(req: NextRequest) {
  const auth = await isAdminAuthedWithMember(req);
  if (!auth.authed) return unauthorized();

  try {
    const container = getContainer('members');
    const { resource: existing } = await container.item(auth.memberId, auth.memberId).read();
    const member = (existing ?? {}) as Record<string, unknown> & { eTransferRecipient?: ETransferRecipient; skipDates?: string[] };
    // PER FIELD: a group doc that exists but has never had a recipient saved
    // still answers with the admin's — otherwise Setup showed no recipient
    // until the first re-save, and receipts went out without one.
    const group = groupsOn() ? await readGroup(resolveGroupId(req)) : undefined;
    const skipDates = Array.isArray(group?.settings.skipDates) && group.settings.skipDates.length > 0
      ? group.settings.skipDates
      : Array.isArray(member.skipDates) ? member.skipDates : [];
    return NextResponse.json({
      eTransferRecipient: group?.settings.eTransferRecipient ?? member.eTransferRecipient ?? null,
      skipDates,
    });
  } catch (error) {
    console.error('GET /api/admin/settings error:', error);
    return NextResponse.json({ error: 'Failed to load settings' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  const auth = await isAdminAuthedWithMember(req);
  if (!auth.authed) return unauthorized();

  let body: { skipDates?: unknown; eTransferRecipient?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }

  if (body.skipDates !== undefined && !isValidSkipDates(body.skipDates)) {
    return NextResponse.json({ error: 'Invalid skipDates' }, { status: 400 });
  }
  if (body.eTransferRecipient !== undefined && !isValidETransferRecipient(body.eTransferRecipient)) {
    return NextResponse.json({ error: 'Invalid eTransferRecipient' }, { status: 400 });
  }

  try {
    const container = getContainer('members');
    const { resource: existing } = await container.item(auth.memberId, auth.memberId).read();
    if (!existing) {
      return NextResponse.json({ error: 'Member not found' }, { status: 404 });
    }

    const updated = {
      ...existing,
      ...(body.skipDates !== undefined ? { skipDates: body.skipDates } : {}),
      ...(body.eTransferRecipient !== undefined ? { eTransferRecipient: body.eTransferRecipient } : {}),
    };
    const { resource } = await container.items.upsert(updated);
    // The group doc is the authoritative copy once groups are on. Written
    // AFTER the Member doc so a failure here leaves the legacy copy current.
    if (groupsOn()) {
      await updateGroupSettings(resolveGroupId(req), {
        ...(body.skipDates !== undefined ? { skipDates: body.skipDates } : {}),
        ...(body.eTransferRecipient !== undefined ? { eTransferRecipient: body.eTransferRecipient } : {}),
      });
    }
    const safe = resource as Record<string, unknown>;
    // This reads and echoes back the caller's own MEMBER document, so every
    // member secret has to come off — not just the PIN hash. `recoveryCode`
    // was already leaking here before the credential fields existed.
    const {
      pinHash: _ph,
      recoveryCode: _rc,
      passwordHash: _pw,
      emailVerification: _ev,
      passwordReset: _pr,
      email: _em,
      ...exposed
    } = safe;
    return NextResponse.json(exposed);
  } catch (error) {
    console.error('PATCH /api/admin/settings error:', error);
    return NextResponse.json({ error: 'Failed to update settings' }, { status: 500 });
  }
}
