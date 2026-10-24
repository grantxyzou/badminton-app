import { NextRequest, NextResponse } from 'next/server';
import { getContainer, getActiveSessionId } from '@/lib/cosmos';
import { publicMember } from '@/lib/publicShapes';
import { groupScope, BPM_GROUP_ID } from '@/lib/groupScope';
import { resolveGroupId } from '@/lib/groupContext';
import { isAdminAuthed, isAdminAuthedWithMember, unauthorized, requireMember } from '@/lib/auth';
import { isFlagOn } from '@/lib/flags';
import { rosterMembers, adminAddToRoster, rosterPublicRows } from '@/lib/roster';
import {
  rosterNameHolder,
  renameRosterMember,
  removeFromRoster,
  addMembership,
  setMembershipRole,
  setMembershipCanGift,
  readMembership,
  RosterNameTakenError,
} from '@/lib/groups';
import { resolveActiveMemberId } from '@/lib/memberResolve';
import { randomBytes } from 'crypto';
import { normalizeAvatar } from '@/lib/memberAvatar';

const groupsOn = () => isFlagOn('NEXT_PUBLIC_FLAG_MULTI_GROUP');

/**
 * WHICH COPY A WRITE REACHES (security review, 2026-10-24).
 *
 * With groups on, `role`, `active` and `name` are facts about THIS roster and
 * are written to the MEMBERSHIP — the only place flag-on auth and the roster
 * read them. Until this, the Roster sheet's "make admin" and "restore" wrote
 * `Member.role` / `Member.active` alone, which nothing read with the flag on,
 * so neither did anything in production from the day the flag flipped.
 *
 * The Member fields are the flag-off values and the rollback copy, and
 * flag-off IS BPM: only BPM's admin (or the flag off) writes them. An admin of
 * another club writing `Member.role = 'admin'` onto a person who is also in
 * BPM would have minted a BPM admin for the day the flag came off, and
 * `Member.active = false` would have locked them out of every club at once.
 */
const writesMemberCopy = (adminGroupId: string) => !groupsOn() || adminGroupId === BPM_GROUP_ID;
const ownerImmutable = () => NextResponse.json({ error: 'owner_immutable' }, { status: 403 });

export async function GET(req: NextRequest) {
  const gate = await requireMember(req);
  if (!gate.ok) return gate.response;
  try {
    const isAdmin = isAdminAuthed(req);
    // Non-admin: only names and the picture a member chose to show beside
    // theirs (no stats or IDs). The avatar is picked by its owner, never set
    // for them (lib/memberAvatar.ts). Read as those three fields alone.
    if (!isAdmin) {
      const rows = await rosterPublicRows(resolveGroupId(req));
      return NextResponse.json(rows.map((m) => ({ name: m.name, active: m.active, avatar: normalizeAvatar(m.avatar) })));
    }
    const includeInactive = new URL(req.url).searchParams.get('all') === 'true';
    // THE ROSTER (lib/roster.ts): every active Member with the flag off; the
    // group's memberships joined to their Member docs with it on, each under
    // the name the group knows them by.
    const entries = await rosterMembers(resolveGroupId(req), { includeInactive });
    const resources = entries.map((e) =>
      // `joinedAt` is when they joined THIS group: the dormant grace period
      // (lib/dormant.ts) runs from it. Admin-only; a non-admin returned above.
      e.membership ? { ...e.member, active: e.membership.status === 'active', joinedAt: e.membership.joinedAt } : e.member,
    );
    // Strip pinHash even for admins — it's a strip-canary per CLAUDE.md.
    // Admin clients have no use for the scrypt hash; if they need to verify
    // a PIN, they go through /api/admin (server-side timingSafeEqual).
    return NextResponse.json(
      (resources as unknown as Array<Record<string, unknown>>).map(publicMember),
    );
  } catch (error) {
    // 503, not an empty roster with a 200 — an outage must look like one.
    console.error('GET members error:', error);
    return NextResponse.json({ error: 'read_failed' }, { status: 503 });
  }
}

export async function POST(req: NextRequest) {
  if (!(await isAdminAuthedWithMember(req)).authed) return unauthorized();
  try {
    const body = await req.json();
    const trimmedName = typeof body.name === 'string' ? body.name.trim() : '';
    if (!trimmedName) {
      return NextResponse.json({ error: 'Name required' }, { status: 400 });
    }
    if (trimmedName.length > 50) {
      return NextResponse.json({ error: 'Name too long (max 50 chars)' }, { status: 400 });
    }

    const container = getContainer('members');
    const strip = publicMember;

    // With groups on a name is unique PER GROUP, so the global scan below
    // would refuse a name another club uses and, worse, reactivate that
    // club's soft-deleted person onto this roster. `adminAddToRoster` owns
    // the decision (rejoin the name's holder here, else a new person).
    if (groupsOn()) {
      const groupId = resolveGroupId(req);
      if (await resolveActiveMemberId(groupId, trimmedName)) {
        // SAY WHAT IS WRONG AND WHAT TO DO. A roster name is unique inside a
        // club by construction, so this 409 is the ONLY moment the constraint
        // is ever visible — it cannot be discovered in advance, because the
        // clash cannot be created. "Member already exists" left an admin with
        // no idea whether they had double-added the same person or hit a
        // genuine name clash between two different ones, and no idea that a
        // roster name is a per-club thing they are free to change.
        return NextResponse.json(
          {
            error:
              'Someone on this roster already goes by that name. Roster names have to be unique inside a group — give this person a distinct one, such as adding a last initial.',
            code: 'roster_name_taken',
          },
          { status: 409 },
        );
      }
      try {
        const { member, created } = await adminAddToRoster(groupId, trimmedName);
        return NextResponse.json(strip(member as unknown as Record<string, unknown>), { status: created ? 201 : 200 });
      } catch (err) {
        // THE LOST RACE lands here: `adminAddToRoster` reads the holder first,
        // but two admins adding the same name concurrently means one of them
        // loses `reserveRosterName` between that read and the create. Without
        // this catch it fell through to the generic handler as a 500 — so the
        // one path where the constraint is genuinely enforced was the one path
        // that never explained itself, which is the opposite of this change's
        // whole point.
        if (!(err instanceof RosterNameTakenError)) throw err;
        return NextResponse.json(
          {
            error:
              'Someone on this roster already goes by that name. Roster names have to be unique inside a group — give this person a distinct one, such as adding a last initial.',
            code: 'roster_name_taken',
          },
          { status: 409 },
        );
      }
    }

    // Check for existing member with same name (case-insensitive)
    const { resources: existing } = await container.items
      .query({
        query: 'SELECT * FROM c WHERE LOWER(c.name) = LOWER(@name)',
        parameters: [{ name: '@name', value: trimmedName }],
      })
      .fetchAll();

    if (existing.length > 0) {
      // If inactive, reactivate instead of creating duplicate
      const inactive = existing.find((m: { active?: boolean }) => m.active === false);
      if (inactive) {
        const reactivated = { ...inactive, active: true };
        const { resource } = await container.items.upsert(reactivated);
        return NextResponse.json(publicMember(resource as Record<string, unknown> | undefined), { status: 200 });
      }
      return NextResponse.json(
        { error: 'A member with that name already exists.', code: 'member_exists' },
        { status: 409 },
      );
    }

    const member = {
      id: randomBytes(12).toString('hex'),
      name: trimmedName,
      role: 'member' as const,
      stage: undefined,
      sessionCount: 0,
      lastSeen: undefined,
      createdAt: new Date().toISOString(),
      active: true,
    };

    const { resource } = await container.items.create(member);
    return NextResponse.json(publicMember(resource as Record<string, unknown> | undefined), { status: 201 });
  } catch (error) {
    console.error('POST members error:', error);
    return NextResponse.json({ error: 'Failed to create member' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  const auth = await isAdminAuthedWithMember(req);
  if (!auth.authed) return unauthorized();
  try {
    const body = await req.json();
    const { id } = body;
    if (typeof id !== 'string') {
      return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
    }
    // An admin edits people on THEIR roster. Without this, any member who
    // created a club of their own held an admin cookie that could rewrite or
    // deactivate anyone whose id they had read off a roster (security review,
    // 2026-10-24). A removed membership still counts, so a restore works.
    const membership = groupsOn() ? await readMembership(auth.groupId, id) : undefined;
    if (groupsOn() && !membership) {
      return NextResponse.json({ error: 'Member not found' }, { status: 404 });
    }

    const container = getContainer('members');
    const { resource: existing } = await container.item(id, id).read();
    if (!existing) {
      return NextResponse.json({ error: 'Member not found' }, { status: 404 });
    }

    const updates: Record<string, unknown> = {};
    const memberCopy = writesMemberCopy(auth.groupId);

    // `active` FIRST, on the membership: a removal releases the roster name and
    // a restore reserves it again (`addMembership` rejoins a removed row), so
    // the rename below acts on a row in its final state. The owner cannot be
    // removed this way — hand the group on first.
    if (membership && typeof body.active === 'boolean') {
      if (body.active === false && membership.status === 'active') {
        if (!(await removeFromRoster(auth.groupId, id))) return ownerImmutable();
      } else if (body.active === true && membership.status !== 'active') {
        const rosterName = typeof body.name === 'string' && body.name.trim()
          ? body.name.trim().slice(0, 50)
          : membership.name;
        try {
          await addMembership({ groupId: auth.groupId, memberId: id, name: rosterName, joinedVia: 'admin' });
        } catch (err) {
          if (err instanceof RosterNameTakenError) return NextResponse.json({ error: 'name_taken' }, { status: 409 });
          throw err;
        }
      }
    }
    if (typeof body.name === 'string') {
      const nextName = body.name.trim().slice(0, 50);
      // A rename must not collide with another member. POST already refuses a
      // duplicate name (409 above); PATCH did not, so renaming A onto B's name
      // left two `members` rows sharing one — and since every name-keyed route
      // resolves by name (lib/memberResolve), a cross-partition `LOWER(c.name)`
      // query with no ORDER BY then picks arbitrarily between them for an id
      // that keys drills, assessments, kudos and gear.
      if (groupsOn()) {
        // Per-group: the reservation is the clash check, and the membership's
        // roster name (what `GET /api/members` shows and what sign-up resolves)
        // moves with the Member's display name.
        const groupId = auth.groupId;
        const holder = await rosterNameHolder(groupId, nextName);
        if (holder && holder !== id) return NextResponse.json({ error: 'name_taken' }, { status: 409 });
        try {
          await renameRosterMember(groupId, id, nextName);
        } catch (err) {
          if (err instanceof RosterNameTakenError) return NextResponse.json({ error: 'name_taken' }, { status: 409 });
          throw err;
        }
      } else if (nextName.toLowerCase() !== String(existing.name ?? '').trim().toLowerCase()) {
        const { resources: clash } = await container.items
          .query({
            query: 'SELECT c.id FROM c WHERE LOWER(c.name) = LOWER(@name) AND c.id != @id',
            parameters: [
              { name: '@name', value: nextName },
              { name: '@id', value: id },
            ],
          })
          .fetchAll();
        if (clash.length > 0) {
          return NextResponse.json({ error: 'name_taken' }, { status: 409 });
        }
      }
      if (memberCopy) updates.name = nextName;
    }
    if (typeof body.stage === 'number') updates.stage = Math.max(1, Math.min(4, body.stage));
    if (body.stage === null) updates.stage = undefined;
    if (memberCopy && typeof body.active === 'boolean') updates.active = body.active;
    if (typeof body.role === 'string' && ['admin', 'member'].includes(body.role)) {
      if (groupsOn()) {
        // Re-read: the `active` step above may have removed or revived the row.
        // A removed membership keeps no role (a rejoin starts as member). The
        // owner is an admin already and is demoted only by handing the group
        // on — the Roster sheet sends `admin` for them, which is a no-op here.
        const current = await readMembership(auth.groupId, id);
        if (current?.status === 'active') {
          if (current.role === 'owner') {
            if (body.role !== 'admin') return ownerImmutable();
          } else if (current.role !== body.role && !(await setMembershipRole(auth.groupId, id, body.role))) {
            return NextResponse.json({ error: 'Member not found' }, { status: 404 });
          }
        }
      }
      if (memberCopy) updates.role = body.role;
    }
    // Orthogonal to `role` on purpose — see Member.canString.
    if (typeof body.canString === 'boolean') updates.canString = body.canString;
    // The third switch: may give out gift cards (docs/plans/gift-card-ledger.md).
    // With groups on it is the MEMBERSHIP's — a card is this club's liability,
    // and the person may be on another roster where nobody granted it. The
    // Member field is still written: it is the flag-off value and the rollback
    // copy. Someone not on this roster is a 404, not a silent no-op.
    if (typeof body.canGift === 'boolean') {
      updates.canGift = body.canGift;
      if (groupsOn() && !(await setMembershipCanGift(auth.groupId, id, body.canGift))) {
        return NextResponse.json({ error: 'Member not found' }, { status: 404 });
      }
    }

    // Admin can clear a member's PIN — deletes both the canonical
    // members.pinHash AND the legacy mirror on the active session's
    // player record (if any). Used when a player loses their PIN and
    // needs to set a new one without going through the recovery-code
    // flow. Only accepts `clearPin: true`; admins can never SET a PIN
    // on someone else's behalf.
    let clearPin = false;
    if (body.clearPin === true) {
      clearPin = true;
    }

    const baseDoc: Record<string, unknown> = { ...existing, ...updates };
    if (clearPin) {
      delete baseDoc.pinHash;
    }
    const { resource: updated } = await container.items.upsert(baseDoc);

    // Mirror clearing to the legacy players.pinHash field for parity
    // with /api/players PIN updates.
    if (clearPin && typeof existing?.name === 'string') {
      try {
        const scope = groupScope(auth.groupId);
        // '' when there is no session: matches nothing, nothing to mirror.
        const sessionId = (await getActiveSessionId(scope.groupId)) ?? '';
        const matches = await scope.query<Record<string, unknown> & { id: string }>('players', {
          where: 'c.sessionId = @sessionId AND LOWER(c.name) = LOWER(@name)',
          params: [
            { name: '@sessionId', value: sessionId },
            { name: '@name', value: existing.name },
          ],
          partitionKey: sessionId,
        });
        for (const p of matches) {
          if ('pinHash' in p) {
            const mirror = { ...p };
            delete mirror.pinHash;
            await scope.upsert('players', mirror);
          }
        }
      } catch {
        // Best-effort — member-side clear already succeeded.
      }
    }

    return NextResponse.json(publicMember(updated as Record<string, unknown> | undefined));
  } catch (error) {
    console.error('PATCH members error:', error);
    return NextResponse.json({ error: 'Failed to update member' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const auth = await isAdminAuthedWithMember(req);
  if (!auth.authed) return unauthorized();
  try {
    const body = await req.json();
    const { id } = body;
    if (typeof id !== 'string') {
      return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
    }

    const container = getContainer('members');

    if (groupsOn()) {
      // A club admin removes someone from THEIR roster and nothing more. A hard
      // delete erases the PERSON from every club, so it is not one club's call
      // (account deletion is `DELETE /api/members/me`); and someone off this
      // roster is not this admin's to touch at all.
      if (body.hard === true) {
        return NextResponse.json({ error: 'hard_delete_disabled' }, { status: 403 });
      }
      if (!(await readMembership(auth.groupId, id))) {
        return NextResponse.json({ error: 'Member not found' }, { status: 404 });
      }
    }

    if (body.hard === true) {
      await container.item(id, id).delete();
      return NextResponse.json({ success: true });
    }

    // Soft delete — set active: false
    const { resource: existing } = await container.item(id, id).read();
    if (!existing) {
      return NextResponse.json({ error: 'Member not found' }, { status: 404 });
    }
    // With groups on, this is removal from THIS roster (status `removed`,
    // name released). `Member.active` is the flag-off value and the rollback
    // copy, written only by BPM's admin — see `writesMemberCopy`.
    if (groupsOn() && !(await removeFromRoster(auth.groupId, id))) return ownerImmutable();
    if (!writesMemberCopy(auth.groupId)) {
      return NextResponse.json(publicMember({ ...existing, active: false } as Record<string, unknown>));
    }
    const { resource: updated } = await container.items.upsert({ ...existing, active: false });
    return NextResponse.json(publicMember(updated as Record<string, unknown> | undefined));
  } catch (error) {
    console.error('DELETE members error:', error);
    return NextResponse.json({ error: 'Failed to delete member' }, { status: 500 });
  }
}
