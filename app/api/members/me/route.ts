import { NextRequest, NextResponse } from 'next/server';
import { getContainer, getActiveSessionId } from '@/lib/cosmos';
import { groupScope } from '@/lib/groupScope';
import { resolveGroupId } from '@/lib/groupContext';
import { isFlagOn } from '@/lib/flags';
import { resolveActiveMemberId } from '@/lib/memberResolve';
import { readMembership } from '@/lib/groups';
import { checkRateLimit, getClientIp } from '@/lib/rateLimit';
import { hashPin, verifyPin, FAKE_HASH } from '@/lib/recoveryHash';
import {
  verifyMemberAuth,
  isAdminAuthed,
  isAdminAuthedWithMember,
  setMemberCookie,
  clearMemberCookie,
  clearAdminCookie,
} from '@/lib/auth';
import {
  purgeMember,
  anonymizePlayerRows,
  anonymizeGameResults,
  anonymizeFeedback,
} from '@/lib/memberPurge';
import {
  normalizeStatsPrivacy,
  parseStatsPrivacyPatch,
  type StatsPrivacy,
} from '@/lib/statsPrivacy';

const BLOCKLISTED_PINS = new Set(['0000', '1111', '1234', '4321', '1212']);

export async function GET(req: NextRequest) {
  const ip = getClientIp(req);
  if (!checkRateLimit(`members-me:${ip}`, 10, 60 * 1000)) {
    // `statsPrivacy: null` means UNKNOWN, not "never asked". These degraded
    // paths never read the member doc, so answering with the default
    // (`promptedAt: null`) would tell the client the member is unprompted and
    // re-fire the first-run consent sheet at someone who already answered.
    return NextResponse.json({ role: 'member', hasPin: false, statsPrivacy: null });
  }

  try {
    const name = new URL(req.url).searchParams.get('name')?.trim().slice(0, 50);
    if (!name) {
      return NextResponse.json({ role: 'member', hasPin: false, statsPrivacy: null });
    }

    // NOTE: this is a PROJECTED select, so there is no destructure here and
    // therefore no strip site. Add fields to the projection one at a time and
    // deliberately -- never widen it to `SELECT *`, and never add
    // `c.passwordHash`, `c.emailVerification` or `c.passwordReset`.
    // `__tests__/auth-strip-canary.test.ts` enforces both rules, because the
    // usual destructure-based canary cannot fire on a projection at all.
    const container = getContainer('members');
    const groupId = resolveGroupId(req);
    // With groups on, the name is resolved INSIDE the group (a point read of
    // its reservation) and the person is read by id under the same projection;
    // the role is the membership's. Flag off: the name scan it always was.
    const groupsOn = isFlagOn('NEXT_PUBLIC_FLAG_MULTI_GROUP');
    const groupMemberId = groupsOn ? await resolveActiveMemberId(groupId, name) : null;
    const probe = groupsOn
      ? groupMemberId
        ? {
            query: 'SELECT c.role, c.pinHash, c.createdAt, c.statsPrivacy FROM c WHERE c.id = @id AND c.active = true',
            parameters: [{ name: '@id', value: groupMemberId }],
          }
        : null // not on this group's roster: nobody, without a read
      : {
          query:
            'SELECT c.role, c.pinHash, c.createdAt, c.statsPrivacy FROM c WHERE LOWER(c.name) = LOWER(@name) AND c.active = true',
          parameters: [{ name: '@name', value: name }],
        };
    const resources = probe ? (await container.items.query(probe).fetchAll()).resources : [];

    const me = resources[0];
    const hasPin = typeof me?.pinHash === 'string' && me.pinHash.length > 0;
    const createdAt = typeof me?.createdAt === 'string' ? me.createdAt : null;
    // Does this device hold a valid member_session cookie for THIS name? If so,
    // the client can drop the PIN field — the sign-up endpoint accepts the
    // cookie as identity proof (skip the per-session PIN re-entry).
    const memberAuth = verifyMemberAuth(req);
    const authed = !!memberAuth && memberAuth.name.toLowerCase() === name.toLowerCase();

    /**
     * `hasPin` and `createdAt` ARE the anonymous half, and must stay that way:
     * the adaptive sign-up form reads `createdAt`'s presence as "this member
     * exists" (lib/useHasPin.ts) and `hasPin` to choose anon / sign-in / create
     * mode, all before anyone has proved anything.
     *
     * `role` and `statsPrivacy` are NOT. The name is the only input and names
     * are enumerable through `GET /api/members`, so answering them for an
     * unproven caller turns the public roster into a list of which accounts are
     * admins — the 4-digit-PIN accounts worth attacking — and which are
     * unclaimed. `/api/auth/methods` already refuses the same question.
     *
     * Withheld reads as UNKNOWN, not as a default: `role: 'member'` is what an
     * unprivileged caller would see anyway, and `statsPrivacy: null` is the
     * same unknown the degraded paths above return, which
     * `shouldPromptForComparison` deliberately declines to act on. So a member
     * whose 30-day cookie lapsed sees the comparison cards stay hidden — it
     * does NOT re-fire the consent sheet at someone who already answered.
     *
     * Read-only route, so the cheap sync admin check (rule 3).
     */
    const privileged = authed || isAdminAuthed(req);
    const groupRole =
      privileged && groupMemberId ? (await readMembership(groupId, groupMemberId))?.role : undefined;
    const role = !privileged
      ? 'member'
      : groupRole
        ? groupRole === 'member'
          ? 'member'
          : 'admin'
        : (me?.role ?? 'member');
    const statsPrivacy = privileged ? normalizeStatsPrivacy(me?.statsPrivacy) : null;
    return NextResponse.json({ role, hasPin, createdAt, authed, statsPrivacy });
  } catch (error) {
    console.error('GET members/me error:', error);
    return NextResponse.json({ role: 'member', hasPin: false, createdAt: null, statsPrivacy: null });
  }
}

/**
 * Member-scoped PIN management. Replaces the legacy `PATCH /api/players`
 * PIN branch which authenticated via session-scoped `deleteToken` and only
 * worked when the user had a player record in the active session. The PIN
 * is an account-level secret — `members.pinHash` is the canonical store —
 * so changing it shouldn't require re-signing-up every week.
 *
 * Behavior:
 * - Body: `{ name, currentPin?: string, newPin: string | null }`
 * - If member already has a `pinHash`, `currentPin` is required and must
 *   verify (real password-change semantics, closes the "anyone with browser
 *   access can rewrite my PIN" hole).
 * - If member has no `pinHash` yet (claim flow / first-time set), no
 *   `currentPin` is required.
 * - `newPin: null` clears the PIN.
 * - Best-effort: mirrors the new pinHash to the active-session player
 *   record so legacy code paths that still read `players.pinHash` keep
 *   working through the transition.
 * - Constant-time miss against `FAKE_HASH` so attackers can't enumerate
 *   names via timing.
 * - Rate-limited 5/hr per (name, IP) — same envelope as `/recover`.
 */
/**
 * Write the member's club-comparison answer.
 *
 * The client sends only `{ clubComparison }` — `promptedAt` is stamped
 * server-side. A caller must not be able to forge "already asked", which would
 * suppress the first-run prompt on an account permanently.
 *
 * Auth is the member cookie for THIS name, or an admin. There is no name-only
 * path: member names are enumerable via `GET /api/members`, so a name-keyed
 * write would let anyone flip a stranger's privacy setting (rule 12).
 */
async function handleStatsPrivacyPatch(req: NextRequest, name: string, raw: unknown) {
  // Rate limit before auth, so the limiter can't be bypassed (rule 4).
  const ip = getClientIp(req);
  if (!checkRateLimit(`stats-privacy:${name.toLowerCase()}:${ip}`, 20, 60 * 60 * 1000)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }

  const patch = parseStatsPrivacyPatch(raw);
  if (!patch) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }

  const membersContainer = getContainer('members');
  // Resolved INSIDE the group (lib/memberResolve) — the probe above is, and a
  // PIN write must land on the person the probe described, not on whichever
  // same-named person a cross-partition scan returns first.
  //
  // The resolve moved ABOVE the gate so the gate can compare ids (see below).
  const memberId = await resolveActiveMemberId(resolveGroupId(req), name);

  // A name that resolves to nobody is answered before the gate, exactly as it
  // was before. There is no one to impersonate, so 404 discloses nothing a
  // caller could not read straight off the unauthenticated `GET /api/members`
  // roster — and the alternative would turn "this member was deleted" into a
  // 401 that reads as "your cookie is bad", which is a worse answer to the
  // person actually in that state.
  if (!memberId) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  // COMPARE IDENTITY, NOT DISPLAY TEXT. The cookie carries an immutable
  // memberId; `name` is mutable, reusable, and — once groups are on — is a
  // per-club roster name, so the cookie's name and the resolved member's name
  // live in two different namespaces. Matching the strings let a caller whose
  // own display name happens to equal a target's roster name in the claimed
  // group write that target's privacy setting. The id the route already
  // resolved is the thing that identifies a person.
  const caller = verifyMemberAuth(req);
  const isSelf = !!caller && caller.memberId === memberId;
  if (!isSelf && !(await isAdminAuthedWithMember(req)).authed) {
    return NextResponse.json({ error: 'auth_required' }, { status: 401 });
  }

  const member = (await membersContainer.item(memberId, memberId).read()).resource;
  if (!member) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const existing = normalizeStatsPrivacy(member.statsPrivacy);
  const statsPrivacy: StatsPrivacy = {
    clubComparison: patch.clubComparison,
    // First answer stamps the clock; later toggles from the settings screen
    // must not reset it, or the consent sheet would fire again.
    promptedAt: existing.promptedAt ?? new Date().toISOString(),
  };

  await membersContainer.items.upsert({ ...member, statsPrivacy });
  return NextResponse.json({ success: true, statsPrivacy });
}

export async function PATCH(req: NextRequest) {
  try {
    return await handlePatch(req);
  } catch (err) {
    console.error('PATCH /api/members/me unhandled:', err);
    return NextResponse.json({ error: 'service_unavailable' }, { status: 503 });
  }
}

async function handlePatch(req: NextRequest) {
  let body: {
    name?: unknown;
    currentPin?: unknown;
    newPin?: unknown;
    statsPrivacy?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }

  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const currentPin = typeof body.currentPin === 'string' ? body.currentPin : null;
  if (!name) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }

  // Club-comparison privacy is its own branch and must be handled BEFORE the
  // PIN validation below, which rejects any body without a well-formed
  // `newPin`. This route was PIN-only; the only other member-write path
  // (`PATCH /api/members`) is admin-gated, so without this a member could not
  // write their own privacy setting at all.
  if (body.statsPrivacy !== undefined) {
    return handleStatsPrivacyPatch(req, name, body.statsPrivacy);
  }

  /**
   * BOTH LIMITS RUN BEFORE `hashPin`, AND THE COARSE ONE IS WHY.
   *
   * `hashPin` is scrypt at ~16 MiB, synchronous enough to block the single
   * Node event loop on the B1 instance this runs on. It used to be called
   * during shape validation, ABOVE the limiter, so every anonymous request
   * carrying any well-formed 4-digit string bought one derivation (rule 4,
   * violated).
   *
   * Moving the per-identifier limit up is not enough on its own: its bucket
   * key contains the caller-chosen `name`, so a fresh name mints a fresh
   * 5-per-hour bucket every request and the cut-off is never reached. The
   * coarse IP-only guard is the one that actually bounds the work, and it is
   * the shape `auth/signin` and `auth/claim-name` already use — generous
   * enough to only catch someone hammering the endpoint.
   */
  const ip = getClientIp(req);
  if (!checkRateLimit(`pin-update:ip:${ip}`, 20, 60 * 60 * 1000)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }
  if (!checkRateLimit(`pin-update:${name.toLowerCase()}:${ip}`, 5, 60 * 60 * 1000)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }

  // Validate newPin shape: null = clear, '4-digit' = set/change.
  let nextPinHash: string | undefined;
  let clearPin = false;
  if (body.newPin === null) {
    clearPin = true;
  } else if (typeof body.newPin === 'string') {
    if (!/^[0-9]{4}$/.test(body.newPin)) {
      return NextResponse.json({ error: 'Invalid PIN format' }, { status: 400 });
    }
    if (BLOCKLISTED_PINS.has(body.newPin)) {
      return NextResponse.json({ error: 'pin_too_common' }, { status: 400 });
    }
    nextPinHash = await hashPin(body.newPin);
  } else {
    return NextResponse.json({ error: 'Invalid PIN format' }, { status: 400 });
  }

  const membersContainer = getContainer('members');
  // Resolved INSIDE the group (lib/memberResolve) — the probe above is, and a
  // PIN write must land on the person the probe described, not on whichever
  // same-named person a cross-partition scan returns first.
  const memberId = await resolveActiveMemberId(resolveGroupId(req), name);
  const member = memberId ? (await membersContainer.item(memberId, memberId).read()).resource : undefined;

  if (!member) {
    if (currentPin) await verifyPin(currentPin, FAKE_HASH);
    return NextResponse.json({ error: 'invalid_credentials' }, { status: 401 });
  }

  const hadPin = typeof member.pinHash === 'string' && member.pinHash.length > 0;
  if (hadPin) {
    if (!currentPin) {
      // Constant-time penalty so callers can't tell "no current PIN
      // submitted" from "current PIN wrong" by latency.
      await verifyPin('0000', member.pinHash);
      return NextResponse.json({ error: 'current_pin_required' }, { status: 401 });
    }
    const ok = await verifyPin(currentPin, member.pinHash);
    if (!ok) {
      return NextResponse.json({ error: 'invalid_credentials' }, { status: 401 });
    }
  }
  // No prior pinHash → first-set / claim flow. There's no currentPin to require,
  // but identity must still be proven: a member_session cookie for THIS name
  // (minted at sign-up, PIN sign-in, or recovery-code reset) or an admin.
  // Without this, anyone who knows an enumerable member name (GET /api/members)
  // could claim the account by setting its first PIN, then sign in as them.
  //
  // The self-check is on the resolved memberId, NOT on the cookie's name.
  // A name is mutable and, with groups on, is a per-club roster name, so the
  // cookie's `name` and this member's name are two different namespaces: an
  // attacker whose own display name equalled a PIN-less target's roster name
  // in the claimed group passed a string comparison and set that person's
  // first PIN — which the response then hands back a session for. The id is
  // already in hand from the resolve above, so the correct check is free.
  if (!hadPin) {
    const caller = verifyMemberAuth(req);
    const isSelf = !!caller && caller.memberId === memberId;
    if (!isSelf && !(await isAdminAuthedWithMember(req)).authed) {
      return NextResponse.json({ error: 'auth_required' }, { status: 401 });
    }
  }

  const memberDoc: Record<string, unknown> = { ...member, lastSeen: new Date().toISOString() };
  if (clearPin) {
    delete memberDoc.pinHash;
  } else {
    memberDoc.pinHash = nextPinHash;
  }
  await membersContainer.items.upsert(memberDoc);

  // Best-effort mirror to the active session player. Legacy code that
  // reads `players.pinHash` directly stays in sync. A failure here is
  // non-fatal — the member record is the source of truth.
  try {
    // No session yet means no player row to mirror into; '' matches nothing,
    // which is the right outcome and not the failure the catch below logs.
    const scope = groupScope(resolveGroupId(req));
    const sessionId = (await getActiveSessionId(scope.groupId)) ?? '';
    const players = await scope.query<Record<string, unknown> & { id: string }>('players', {
      where: 'c.sessionId = @sessionId AND LOWER(c.name) = LOWER(@name)',
      params: [
        { name: '@sessionId', value: sessionId },
        { name: '@name', value: name },
      ],
    });
    const player = players[0];
    if (player) {
      const playerDoc = { ...player };
      if (clearPin) {
        delete playerDoc.pinHash;
      } else {
        playerDoc.pinHash = nextPinHash;
      }
      await scope.upsert('players', playerDoc);
    }
  } catch (err) {
    console.warn('member PIN: player mirror failed (non-fatal):', err);
  }

  const out = NextResponse.json({ success: true, hasPin: !clearPin });
  // Setting or changing a PIN proves ownership on this device — trust it for
  // future one-tap sign-ups, same as a PIN sign-in via /recover. Skip on clear
  // (no PIN means nothing to skip). Mirrors the cookie-minting in
  // POST /api/players so a member who sets their PIN in Profile isn't asked
  // for it again on the Home sign-up card.
  if (!clearPin) {
    setMemberCookie(out, String(member.id), String(member.name), resolveGroupId(req));
  }
  return out;
}

/**
 * Delete your own account.
 *
 * Required by App Store Guideline 5.1.1(v) — an app that lets you create an
 * account must let you delete it from inside the app — and it is the PIPEDA /
 * GDPR answer independently of that. The existing admin `DELETE /api/members`
 * is not this: it is admin-gated, and it only sets `active: false` on the
 * member row, leaving every other trace in place.
 *
 * WHAT IT DOES NOT DO: cancel money you owe. Deleting the account removes the
 * person, not the debt, and the confirm sheet says so. It also cannot be
 * blocked on an unpaid balance — Apple requires the path to be available.
 *
 * BOUND TO THE COOKIE, never to a name. Member names are enumerable via
 * GET /api/members, so a name-keyed delete would let anyone erase anyone
 * (security rule 12). There is deliberately NO admin-on-behalf branch: an admin
 * removing someone else already has `DELETE /api/members`, and giving this
 * route a second door would make "who asked for this deletion?" unanswerable.
 */
export async function DELETE(req: NextRequest) {
  // Rate limit BEFORE auth (rule 4) so the limiter can't be bypassed.
  const ip = getClientIp(req);
  if (!checkRateLimit(`member-delete:${ip}`, 5, 60 * 60 * 1000)) {
    return NextResponse.json({ error: 'Too many attempts. Try again later.' }, { status: 429 });
  }

  const caller = verifyMemberAuth(req);
  if (!caller) {
    return NextResponse.json({ error: 'Sign in on this device first' }, { status: 401 });
  }

  // An explicit flag, so a stray DELETE cannot erase an account by accident.
  // The real confirmation is the sheet; this is the seatbelt behind it.
  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    /* no body — falls through to the check below */
  }
  if (body.confirm !== true) {
    return NextResponse.json({ error: 'Confirmation required' }, { status: 400 });
  }

  try {
    const members = getContainer('members');
    const { resource: member } = await members.item(caller.memberId, caller.memberId).read();
    if (!member) {
      return NextResponse.json({ error: 'Account not found' }, { status: 404 });
    }
    const name = String(member.name ?? caller.name);

    // Shared history first: if a later step fails, the rows that OTHER members
    // depend on have already been made safe, and the owned rows can be retried.
    const activeSessionId = await getActiveSessionId(resolveGroupId(req));
    const players = await anonymizePlayerRows(caller.memberId, name, activeSessionId);
    const games = await anonymizeGameResults(name);
    const reports = await anonymizeFeedback(name);

    const summary = await purgeMember(caller.memberId, name);

    /* BEST-EFFORT, NOT TRANSACTIONAL — and deliberately not resumable.
       Cosmos has no cross-container transaction, so a container that fails
       leaves its rows behind. The member row is still deleted when that
       happens: the person asked to be gone and Apple requires the path to
       work, so refusing would trap them in an account they cannot leave over a
       cleanup problem they cannot see or fix. What is left is orphaned rows
       nothing points at, which is an admin chore, not a live account.

       An earlier draft of this comment claimed the purge was "resumable"
       because the member row went last. Nothing resumes it. The failed
       container names go back to the caller AND to the log, which is the
       actual recovery path: someone reads it and clears them by hand. */
    if (summary.failed.length > 0) {
      console.error(
        `[account-delete] member ${caller.memberId} deleted with orphaned rows in: ` +
          `${summary.failed.join(', ')} — these need clearing by hand.`,
      );
    }
    await members.item(caller.memberId, caller.memberId).delete();

    const out = NextResponse.json({
      success: true,
      deleted: summary.deleted,
      anonymized: summary.anonymized + players.anonymized + games + reports,
      spotsFreed: players.removed,
      // Surfaced rather than swallowed: a partial delete the user is not told
      // about is the lying-empty-state rule wearing a different hat.
      failed: summary.failed,
    });
    // Sign the device out. Member cookie first, then admin — never a `set*`
    // after a `clear*` on the same response (see lib/authSession.ts).
    clearMemberCookie(out);
    clearAdminCookie(out);
    return out;
  } catch (error) {
    console.error('DELETE /api/members/me error:', error);
    return NextResponse.json({ error: 'Failed to delete account' }, { status: 500 });
  }
}
