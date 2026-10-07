/**
 * WHAT `app/page.tsx` RENDERS, decided on the server.
 *
 * Members only has two answers — signed in, or not — and `requireMember` is the
 * one gate that gives them (docs/plans/members-only.md). Multi-group adds a
 * third person the gate refuses but who is not a stranger: a real, active
 * account with NO club in the group its cookie claims. Two ways to be that
 * person, both ordinary once strangers can install the app:
 *
 *   - a new organiser, half-way through "Create a club": the account step made
 *     an account on no roster (`noGroup`, lib/inviteSignup.ts) and the page
 *     reloaded; without this they were handed the Welcome screen again and
 *     could never reach the form that makes their club;
 *   - a member removed from the club their 30-day cookie still names, who may
 *     well belong to another.
 *
 * `requireMember` is still the gate and still refuses them — every club-data
 * read must, and that is the members-only boundary (security rule 13). This
 * function only decides which SCREEN a refused visitor gets: the signed-out
 * Welcome, or the signed-in-but-in-no-club doors. It reads the Member doc and
 * their memberships, nothing of any club's data, and anything it cannot answer
 * is `signed-out` — the same refuse-on-doubt `requireGroupMember` applies.
 *
 * With groups OFF a no-club member cannot exist (everyone active is in BPM), so
 * the answer is exactly what it was before this file: pass or signed-out.
 */
import type { NextRequest } from 'next/server';
import { requireMember, verifyMemberAuth } from '@/lib/auth';
import { getContainer } from '@/lib/cosmos';
import { isFlagOn } from '@/lib/flags';
import { listMembershipsForMember, readGroup } from '@/lib/groups';
import type { Member } from '@/lib/types';
import type { GroupListEntry } from '@/lib/useCurrentGroup';

export type PageOutcome =
  | { kind: 'app'; memberName: string | null }
  | { kind: 'signed-out' }
  /**
   * A signed-in, active account with no active membership in the claimed
   * group. `groups` is every OTHER open club they are in, in the shape and
   * order `GET /api/groups/mine` answers — empty for a brand-new organiser,
   * who gets the doors; non-empty for a removed member, who gets the list.
   */
  | { kind: 'no-club'; memberName: string; groups: GroupListEntry[] };

const SIGNED_OUT: PageOutcome = { kind: 'signed-out' };

/** Called only under `membersOnlyOn()`; the page keeps that check literal. */
export async function decidePage(req: NextRequest): Promise<PageOutcome> {
  const gate = await requireMember(req);
  if (gate.ok) return { kind: 'app', memberName: gate.member?.name ?? null };
  if (!isFlagOn('NEXT_PUBLIC_FLAG_MULTI_GROUP')) return SIGNED_OUT;

  // Signature and expiry only — the membership read the gate made is the one
  // that refused, so this is "who does the cookie say?", not "who is allowed?".
  const session = verifyMemberAuth(req);
  if (!session) return SIGNED_OUT;

  try {
    const { resource } = await getContainer('members').item(session.memberId, session.memberId).read<Member>();
    if (!resource || resource.active !== true) return SIGNED_OUT;
    // The CURRENT name, not the one baked into a cookie that can be 30 days old.
    const memberName = typeof resource.name === 'string' && resource.name ? resource.name : session.name;

    const memberships = (await listMembershipsForMember(session.memberId)).filter((m) => m.status === 'active');
    const groups = await Promise.all(
      memberships.map(async (m): Promise<GroupListEntry | null> => {
        const group = await readGroup(m.groupId);
        // A closed club is dropped, as `mine` drops it: nothing lists or joins one.
        if (!group || group.closedAt) return null;
        return { id: group.id, name: group.name, role: m.role, rosterName: m.name, joinedAt: m.joinedAt, current: false };
      }),
    );
    const list = groups.filter((g): g is GroupListEntry => g !== null);
    list.sort((a, b) => (a.joinedAt ?? '').localeCompare(b.joinedAt ?? '') || a.id.localeCompare(b.id));
    return { kind: 'no-club', memberName, groups: list };
  } catch {
    return SIGNED_OUT;
  }
}
