import { NextRequest, NextResponse } from 'next/server';
import { getContainer, getActiveSessionId } from '@/lib/cosmos';
import { groupScope } from '@/lib/groupScope';
import { resolveGroupId } from '@/lib/groupContext';
import { isAdminAuthed, isAdminAuthedWithMember, unauthorized } from '@/lib/auth';
import { isFlagOn } from '@/lib/flags';
import { rosterMembers, adminAddToRoster } from '@/lib/roster';
import { rosterNameHolder, renameRosterMember, removeFromRoster, RosterNameTakenError } from '@/lib/groups';
import { resolveActiveMemberId } from '@/lib/memberResolve';
import { randomBytes } from 'crypto';

const groupsOn = () => isFlagOn('NEXT_PUBLIC_FLAG_MULTI_GROUP');

export async function GET(req: NextRequest) {
  try {
    const isAdmin = isAdminAuthed(req);
    const includeInactive = new URL(req.url).searchParams.get('all') === 'true' && isAdmin;
    // THE ROSTER (lib/roster.ts): every active Member with the flag off; the
    // group's memberships joined to their Member docs with it on, each under
    // the name the group knows them by.
    const entries = await rosterMembers(resolveGroupId(req), { includeInactive });
    const resources = entries.map((e) =>
      e.membership ? { ...e.member, active: e.membership.status === 'active' } : e.member,
    );
    // Non-admin: only return names (no stats or IDs)
    if (!isAdmin) {
      return NextResponse.json(resources.map((m: { name: string; active: boolean }) => ({ name: m.name, active: m.active })));
    }
    // Strip pinHash even for admins — it's a strip-canary per CLAUDE.md.
    // Admin clients have no use for the scrypt hash; if they need to verify
    // a PIN, they go through /api/admin (server-side timingSafeEqual).
    return NextResponse.json(
      (resources as unknown as Array<Record<string, unknown>>).map(
        ({ pinHash: _ph, recoveryCode: _rc, passwordHash: _pw, emailVerification: _ev, passwordReset: _pr, email: _em, ...m }) => m,
      ),
    );
  } catch (error) {
    console.error('GET members error:', error);
    return NextResponse.json([]);
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
    const strip = (doc: Record<string, unknown>) => {
      const { pinHash: _ph, recoveryCode: _rc, passwordHash: _pw, emailVerification: _ev, passwordReset: _pr, email: _em, ...safe } = doc;
      return safe;
    };

    // With groups on a name is unique PER GROUP, so the global scan below
    // would refuse a name another club uses and, worse, reactivate that
    // club's soft-deleted person onto this roster. `adminAddToRoster` owns
    // the decision (rejoin the name's holder here, else a new person).
    if (groupsOn()) {
      const groupId = resolveGroupId(req);
      if (await resolveActiveMemberId(groupId, trimmedName)) {
        return NextResponse.json({ error: 'Member already exists' }, { status: 409 });
      }
      const { member, created } = await adminAddToRoster(groupId, trimmedName);
      return NextResponse.json(strip(member as unknown as Record<string, unknown>), { status: created ? 201 : 200 });
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
        const { pinHash: _ph, recoveryCode: _rc, passwordHash: _pw, emailVerification: _ev, passwordReset: _pr, email: _em, ...safe } = (resource ?? {}) as Record<string, unknown>;
        return NextResponse.json(safe, { status: 200 });
      }
      return NextResponse.json({ error: 'Member already exists' }, { status: 409 });
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
    const { pinHash: _ph, recoveryCode: _rc, passwordHash: _pw, emailVerification: _ev, passwordReset: _pr, email: _em, ...safe } = (resource ?? {}) as Record<string, unknown>;
    return NextResponse.json(safe, { status: 201 });
  } catch (error) {
    console.error('POST members error:', error);
    return NextResponse.json({ error: 'Failed to create member' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  if (!(await isAdminAuthedWithMember(req)).authed) return unauthorized();
  try {
    const body = await req.json();
    const { id } = body;
    if (typeof id !== 'string') {
      return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
    }

    const container = getContainer('members');
    const { resource: existing } = await container.item(id, id).read();
    if (!existing) {
      return NextResponse.json({ error: 'Member not found' }, { status: 404 });
    }

    const updates: Record<string, unknown> = {};
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
        const groupId = resolveGroupId(req);
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
      updates.name = nextName;
    }
    if (typeof body.stage === 'number') updates.stage = Math.max(1, Math.min(4, body.stage));
    if (body.stage === null) updates.stage = undefined;
    if (typeof body.active === 'boolean') updates.active = body.active;
    if (typeof body.role === 'string' && ['admin', 'member'].includes(body.role)) updates.role = body.role;
    // Orthogonal to `role` on purpose — see Member.canString.
    if (typeof body.canString === 'boolean') updates.canString = body.canString;

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
        const scope = groupScope(resolveGroupId(req));
        // '' when there is no session: matches nothing, nothing to mirror.
        const sessionId = (await getActiveSessionId(scope.groupId)) ?? '';
        const matches = await scope.query<Record<string, unknown> & { id: string }>('players', {
          where: 'c.sessionId = @sessionId AND LOWER(c.name) = LOWER(@name)',
          params: [
            { name: '@sessionId', value: sessionId },
            { name: '@name', value: existing.name },
          ],
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

    const { pinHash: _ph, recoveryCode: _rc, passwordHash: _pw, emailVerification: _ev, passwordReset: _pr, email: _em, ...safe } = (updated ?? {}) as Record<string, unknown>;
    return NextResponse.json(safe);
  } catch (error) {
    console.error('PATCH members error:', error);
    return NextResponse.json({ error: 'Failed to update member' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  if (!(await isAdminAuthedWithMember(req)).authed) return unauthorized();
  try {
    const body = await req.json();
    const { id } = body;
    if (typeof id !== 'string') {
      return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
    }

    const container = getContainer('members');

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
    // name released); `Member.active` is still flipped for the flag-off
    // readers until Phase 3's per-group route replaces this one.
    if (groupsOn()) await removeFromRoster(resolveGroupId(req), id);
    const { resource: updated } = await container.items.upsert({ ...existing, active: false });
    const { pinHash: _ph, recoveryCode: _rc, passwordHash: _pw, emailVerification: _ev, passwordReset: _pr, email: _em, ...safe } = (updated ?? {}) as Record<string, unknown>;
    return NextResponse.json(safe);
  } catch (error) {
    console.error('DELETE members error:', error);
    return NextResponse.json({ error: 'Failed to delete member' }, { status: 500 });
  }
}
