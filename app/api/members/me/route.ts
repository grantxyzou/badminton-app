import { NextRequest, NextResponse } from 'next/server';
import { getContainer, getActiveSessionId } from '@/lib/cosmos';
import { checkRateLimit, getClientIp } from '@/lib/rateLimit';
import { hashPin, verifyPin, FAKE_HASH } from '@/lib/recoveryHash';

const BLOCKLISTED_PINS = new Set(['0000', '1111', '1234', '4321', '1212']);

export async function GET(req: NextRequest) {
  const ip = getClientIp(req);
  if (!checkRateLimit(`members-me:${ip}`, 10, 60 * 1000)) {
    return NextResponse.json({ role: 'member', hasPin: false });
  }

  try {
    const name = new URL(req.url).searchParams.get('name')?.trim().slice(0, 50);
    if (!name) {
      return NextResponse.json({ role: 'member', hasPin: false });
    }

    const container = getContainer('members');
    const { resources } = await container.items
      .query({
        query: 'SELECT c.role, c.pinHash FROM c WHERE LOWER(c.name) = LOWER(@name) AND c.active = true',
        parameters: [{ name: '@name', value: name }],
      })
      .fetchAll();

    const role = resources[0]?.role ?? 'member';
    const hasPin = typeof resources[0]?.pinHash === 'string' && resources[0].pinHash.length > 0;
    return NextResponse.json({ role, hasPin });
  } catch (error) {
    console.error('GET members/me error:', error);
    return NextResponse.json({ role: 'member', hasPin: false });
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
export async function PATCH(req: NextRequest) {
  try {
    return await handlePatch(req);
  } catch (err) {
    console.error('PATCH /api/members/me unhandled:', err);
    return NextResponse.json({ error: 'service_unavailable' }, { status: 503 });
  }
}

async function handlePatch(req: NextRequest) {
  let body: { name?: unknown; currentPin?: unknown; newPin?: unknown };
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
  // No prior pinHash → claim flow, no currentPin required.

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

  return NextResponse.json({ success: true, hasPin: !clearPin });
}
