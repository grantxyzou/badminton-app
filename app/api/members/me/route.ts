import { NextRequest, NextResponse } from 'next/server';
import { getContainer, getActiveSessionId } from '@/lib/cosmos';
import { checkRateLimit, getClientIp } from '@/lib/rateLimit';
import { hashPin, verifyPin, FAKE_HASH } from '@/lib/recoveryHash';
import { verifyMemberAuth, isAdminAuthedWithMember, setMemberCookie } from '@/lib/auth';
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
    const { resources } = await container.items
      .query({
        query:
          'SELECT c.role, c.pinHash, c.createdAt, c.statsPrivacy FROM c WHERE LOWER(c.name) = LOWER(@name) AND c.active = true',
        parameters: [{ name: '@name', value: name }],
      })
      .fetchAll();

    const me = resources[0];
    const role = me?.role ?? 'member';
    const hasPin = typeof me?.pinHash === 'string' && me.pinHash.length > 0;
    const createdAt = typeof me?.createdAt === 'string' ? me.createdAt : null;
    const statsPrivacy = normalizeStatsPrivacy(me?.statsPrivacy);
    // Does this device hold a valid member_session cookie for THIS name? If so,
    // the client can drop the PIN field — the sign-up endpoint accepts the
    // cookie as identity proof (skip the per-session PIN re-entry).
    const memberAuth = verifyMemberAuth(req);
    const authed = !!memberAuth && memberAuth.name.toLowerCase() === name.toLowerCase();
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

  const caller = verifyMemberAuth(req);
  const isSelf = !!caller && caller.name.toLowerCase() === name.toLowerCase();
  if (!isSelf && !(await isAdminAuthedWithMember(req)).authed) {
    return NextResponse.json({ error: 'auth_required' }, { status: 401 });
  }

  const membersContainer = getContainer('members');
  const { resources: members } = await membersContainer.items
    .query({
      query: 'SELECT * FROM c WHERE LOWER(c.name) = LOWER(@name) AND c.active = true',
      parameters: [{ name: '@name', value: name }],
    })
    .fetchAll();
  const member = members[0];
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

  const ip = getClientIp(req);
  if (!checkRateLimit(`pin-update:${name.toLowerCase()}:${ip}`, 5, 60 * 60 * 1000)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }

  const membersContainer = getContainer('members');
  const { resources: members } = await membersContainer.items
    .query({
      query: 'SELECT * FROM c WHERE LOWER(c.name) = LOWER(@name) AND c.active = true',
      parameters: [{ name: '@name', value: name }],
    })
    .fetchAll();
  const member = members[0];

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
  if (!hadPin) {
    const caller = verifyMemberAuth(req);
    const isSelf = !!caller && caller.name.toLowerCase() === name.toLowerCase();
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
    const sessionId = await getActiveSessionId();
    const playersContainer = getContainer('players');
    const { resources: players } = await playersContainer.items
      .query({
        query: 'SELECT * FROM c WHERE c.sessionId = @sessionId AND LOWER(c.name) = LOWER(@name)',
        parameters: [
          { name: '@sessionId', value: sessionId },
          { name: '@name', value: name },
        ],
      })
      .fetchAll();
    const player = players[0];
    if (player) {
      const playerDoc = { ...player };
      if (clearPin) {
        delete playerDoc.pinHash;
      } else {
        playerDoc.pinHash = nextPinHash;
      }
      await playersContainer.items.upsert(playerDoc);
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
    setMemberCookie(out, String(member.id), String(member.name));
  }
  return out;
}
