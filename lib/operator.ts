/**
 * THE OPERATOR — the one person who runs the deployment, and the only one
 * who may act across clubs (docs/plans/roles-v2.md, PR 3).
 *
 * WHO: the member ids in the `OPERATOR_MEMBER_IDS` App Setting (comma
 * separated). Ids, not names: names change and repeat across clubs. Each
 * must still pass `isAdminAuthedWithMember` — an active admin cookie for
 * SOME club — so a listed id that has been deactivated is nobody.
 *
 * UNSET means the rule from before the list: an admin of the operator's
 * club, BPM. That was "the operator" from 2026-10-24 until this file, and it
 * holds until the setting exists so the day this deploys nothing is locked.
 * It stops being enough the moment BPM has several organisers and admins,
 * which is why the list exists: cross-club power is a person's, not a club's.
 *
 * EVERY USE OF THE OVERRIDE IS WRITTEN DOWN (`recordOperatorAction`): one
 * `kind: 'operatorAction'` doc in the GLOBAL `groups` container — who, when,
 * which club, whom, the rank before and after — beside the leak records
 * (`lib/groupLeaks.ts`), read back on the operator's status route. An
 * override nobody can see afterwards is not break-glass.
 */
import { randomBytes } from 'crypto';
import type { NextRequest } from 'next/server';
import { ensureContainer, getContainer } from './cosmos';
import { isAdminAuthedWithMember } from './auth';
import { BPM_GROUP_ID } from './groupScope';
import type { MembershipRole } from './types';

export function operatorMemberIds(): Set<string> {
  const raw = process.env.OPERATOR_MEMBER_IDS ?? '';
  return new Set(raw.split(',').map((s) => s.trim()).filter((s) => s.length > 0));
}

/**
 * STAFF: the operator's own usage is not a member's usage (roles v2, PR 4).
 * Ten opens a day to check a payment or look at a fix would carry a club of
 * thirty's daily-active and stickiness on one person. The three usage kinds
 * — `app_open`, `tab_view`, `sign_in` — skip a listed id; nothing else does:
 * a sign-up, a payment, a kudos is a real club record whoever made it, and a
 * `client_error` from the operator's phone is still an error. The list IS
 * the staff list — no field, no setter.
 */
export function skipsUsageRecord(memberId: string): boolean {
  return isOperatorId(memberId);
}

export function operatorListConfigured(): boolean {
  return operatorMemberIds().size > 0;
}

/** Is this id the operator's? Pure over the setting; the fallback is `isOperator`'s. */
export function isOperatorId(memberId: string): boolean {
  return operatorMemberIds().has(memberId);
}

/** The rule over an admin check that already PASSED — no read of its own,
 *  so `GET /api/admin` can tell the console without a second round trip. */
export function isOperatorAdmin(auth: { memberId: string; groupId: string }): boolean {
  return operatorListConfigured() ? isOperatorId(auth.memberId) : auth.groupId === BPM_GROUP_ID;
}

export type OperatorCheck =
  | { ok: true; memberId: string; name: string; groupId: string }
  | { ok: false; reason: 'unauthorized' | 'operator_only' };

/**
 * The operator, or why not. `unauthorized` is no admin cookie at all;
 * `operator_only` is an admin who is not the operator.
 */
export async function isOperator(req: NextRequest): Promise<OperatorCheck> {
  const auth = await isAdminAuthedWithMember(req);
  if (!auth.authed) return { ok: false, reason: 'unauthorized' };
  if (!isOperatorAdmin(auth)) return { ok: false, reason: 'operator_only' };
  return { ok: true, memberId: auth.memberId, name: auth.name, groupId: auth.groupId };
}

export const OPERATOR_ACTION_KIND = 'operatorAction' as const;

export interface OperatorActionRecord {
  id: string;
  kind: typeof OPERATOR_ACTION_KIND;
  at: string;
  actorMemberId: string;
  groupId: string;
  targetMemberId: string;
  action: 'set_role';
  before: MembershipRole;
  after: MembershipRole;
  /** Who the club passed to, when the action took its last organiser. */
  handedTo: string | null;
}

/** Write one record. Throws: the override must not report success unrecorded. */
export async function recordOperatorAction(input: Omit<OperatorActionRecord, 'id' | 'kind' | 'at'>): Promise<OperatorActionRecord> {
  const doc: OperatorActionRecord = {
    id: `operator:${randomBytes(8).toString('hex')}`,
    kind: OPERATOR_ACTION_KIND,
    at: new Date().toISOString(),
    ...input,
  };
  await ensureContainer('groups', '/id');
  await getContainer('groups').items.create(doc);
  return doc;
}

const READ_CAP = 200;

/** Every recorded use, newest first. Throws on a failed read. */
export async function readOperatorActions(): Promise<OperatorActionRecord[]> {
  await ensureContainer('groups', '/id');
  const { resources } = await getContainer('groups')
    .items.query<Record<string, unknown>>({
      // ORDER BY before the cap, or past 200 records Cosmos keeps an arbitrary
      // 200 and the newest override can drop out of the audit read.
      query: `SELECT * FROM c WHERE c.kind = @kind ORDER BY c.at DESC OFFSET 0 LIMIT ${READ_CAP}`,
      parameters: [{ name: '@kind', value: OPERATOR_ACTION_KIND }],
    })
    .fetchAll();
  // Re-checked in JS: the mock store filters by parameter NAME and applies no
  // WHERE it does not know, so the kind test is what holds under test.
  return (resources ?? [])
    .filter((r): r is Record<string, unknown> & { id: string } => r.kind === OPERATOR_ACTION_KIND && typeof r.id === 'string')
    .map((r) => ({
      id: r.id,
      kind: OPERATOR_ACTION_KIND,
      at: String(r.at ?? ''),
      actorMemberId: String(r.actorMemberId ?? ''),
      groupId: String(r.groupId ?? ''),
      targetMemberId: String(r.targetMemberId ?? ''),
      action: 'set_role' as const,
      before: r.before as MembershipRole,
      after: r.after as MembershipRole,
      handedTo: typeof r.handedTo === 'string' ? r.handedTo : null,
    }))
    .sort((a, b) => b.at.localeCompare(a.at));
}
