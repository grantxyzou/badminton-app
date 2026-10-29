import { NextRequest, NextResponse } from 'next/server';
import { getContainer } from '@/lib/cosmos';
import { publicMember } from '@/lib/publicShapes';
import { isAdminAuthedWithMember, unauthorized } from '@/lib/auth';
import { resolveGroupId } from '@/lib/groupContext';
import { isFlagOn } from '@/lib/flags';
import { readGroup, renameGroup, setGuestsAllowed, setLateCancelHours, updateGroupSettings } from '@/lib/groups';
import { cleanString, GROUP_NAME_MIN, GROUP_NAME_MAX } from '@/lib/groupRoutes';
import { isValidLateCancelHours, lateCancelHoursOf } from '@/lib/cancelPolicy';
import { guestsAllowedOf } from '@/lib/plusOne';
import { clubRunOf, parseClubRun } from '@/lib/clubRun';
import { recipientOf } from '@/lib/payTo';
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
 *
 * EXCEPT THE RECIPIENT, which reads the group doc whenever one exists, flag on
 * or off, and PATCH writes the group doc whenever one exists. Members are told
 * that copy (`clubPayTo` in lib/payTo.ts), so this screen has to show and edit
 * that copy too — with groups off it once showed the admin's own while Home
 * showed the group's, and a save never reached members (2026-10-12).
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
    const group = await readGroup(resolveGroupId(req));
    const groupSkipDates = groupsOn() ? group?.settings.skipDates : undefined;
    const skipDates = Array.isArray(groupSkipDates) && groupSkipDates.length > 0
      ? groupSkipDates
      : Array.isArray(member.skipDates) ? member.skipDates : [];
    return NextResponse.json({
      eTransferRecipient: recipientOf(group) ?? member.eTransferRecipient ?? null,
      skipDates,
      // The group record only, flag on or off (docs/plans/late-cancel-fee.md):
      // a new field has no Member-doc history to fall back to. null = off.
      lateCancelHours: lateCancelHoursOf(group?.settings),
      // Plus-ones (docs/plans/plus-one.md): the group record only, like the window.
      guestsAllowed: guestsAllowedOf(group?.settings),
      // The CLUB's name (`Group.name`), flag on or off: the group record exists
      // from the backfill on, and it is what the flip will show members. Null
      // before the record exists.
      groupName: group?.name ?? null,
      // How the club runs (lib/clubRun.ts), defaults filled in. The group
      // record only, like the late-cancel window: there is no Member copy.
      run: clubRunOf(group?.settings),
    });
  } catch (error) {
    console.error('GET /api/admin/settings error:', error);
    return NextResponse.json({ error: 'Failed to load settings' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  const auth = await isAdminAuthedWithMember(req);
  if (!auth.authed) return unauthorized();

  let body: { skipDates?: unknown; eTransferRecipient?: unknown; lateCancelHours?: unknown; guestsAllowed?: unknown; groupName?: unknown; run?: unknown };
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
  if (body.lateCancelHours !== undefined && body.lateCancelHours !== null && !isValidLateCancelHours(body.lateCancelHours)) {
    return NextResponse.json({ error: 'Invalid lateCancelHours' }, { status: 400 });
  }
  if (body.guestsAllowed !== undefined && typeof body.guestsAllowed !== 'boolean') {
    return NextResponse.json({ error: 'Invalid guestsAllowed' }, { status: 400 });
  }
  // The same rule as creating a club (`POST /api/groups`): trimmed, 2–40 chars.
  const groupName = body.groupName !== undefined ? cleanString(body.groupName, GROUP_NAME_MIN, GROUP_NAME_MAX) : undefined;
  if (body.groupName !== undefined && !groupName) {
    return NextResponse.json({ error: 'invalid_name' }, { status: 400 });
  }

  // The whole run object or nothing; the style is worked out from the values.
  const run = body.run !== undefined ? parseClubRun(body.run) : undefined;
  if (body.run !== undefined && !run) {
    return NextResponse.json({ error: 'Invalid run' }, { status: 400 });
  }

  try {
    // The late-cancellation window and the run settings live on the group
    // record ONLY, so a save with no record would be a 200 that stored
    // nothing. Refuse it up front, before anything else in the body is written.
    const groupId = resolveGroupId(req);
    if ((body.lateCancelHours !== undefined || body.guestsAllowed !== undefined || groupName !== undefined || run) && !(await readGroup(groupId))) {
      return NextResponse.json({ error: 'no_group' }, { status: 409 });
    }
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
    // The group doc is the authoritative copy, written whenever it exists
    // (a no-op when it does not), flag on or off: members are told its
    // recipient either way. AFTER the Member doc so a failure here leaves the
    // legacy copy current.
    await updateGroupSettings(resolveGroupId(req), {
      ...(body.skipDates !== undefined ? { skipDates: body.skipDates } : {}),
      ...(body.eTransferRecipient !== undefined ? { eTransferRecipient: body.eTransferRecipient } : {}),
    });
    if (body.lateCancelHours !== undefined) {
      await setLateCancelHours(groupId, body.lateCancelHours as number | null);
    }
    if (typeof body.guestsAllowed === 'boolean') {
      await setGuestsAllowed(groupId, body.guestsAllowed);
    }
    if (run) {
      await updateGroupSettings(groupId, { run });
    }
    // The club's name lives on the group record ONLY — it has no Member-doc
    // copy, because a club is not a person's setting.
    if (typeof groupName === 'string') {
      await renameGroup(groupId, groupName);
    }
    // This reads and echoes back the caller's own MEMBER document, so every
    // member secret has to come off — not just the PIN hash. `recoveryCode`
    // was already leaking here before the credential fields existed.
    return NextResponse.json(publicMember(resource as Record<string, unknown>));
  } catch (error) {
    console.error('PATCH /api/admin/settings error:', error);
    return NextResponse.json({ error: 'Failed to update settings' }, { status: 500 });
  }
}
