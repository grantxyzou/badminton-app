import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { isAdminAuthed } from '@/lib/auth';
import { checkRateLimit, getClientIp } from '@/lib/rateLimit';
import { getContainer } from '@/lib/cosmos';
import { verifyPin, FAKE_HASH } from '@/lib/recoveryHash';
import { consumeCode } from '@/lib/recoveryCodes';
import { appendEvent } from '@/lib/recoveryAudit';
import { isFlagOn } from '@/lib/flags';

export const dynamic = 'force-dynamic';

const FAIL = () => NextResponse.json({ error: 'invalid_credentials' }, { status: 401 });

export async function POST(req: NextRequest) {
  if (!isFlagOn('NEXT_PUBLIC_FLAG_RECOVERY')) {
    return NextResponse.json({ error: 'Not Found' }, { status: 404 });
  }

  let body: { name?: unknown; sessionId?: unknown; pin?: unknown; code?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }

  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const sessionId = typeof body.sessionId === 'string' ? body.sessionId : '';
  const pin = typeof body.pin === 'string' ? body.pin : null;
  const code = typeof body.code === 'string' ? body.code : null;

  if (!name || !sessionId) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }
  if ((pin && code) || (!pin && !code)) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }
  if (pin && !/^[0-9]{4}$/.test(pin)) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }
  if (code && !/^[0-9]{6}$/.test(code)) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }

  // Admins must use /reset-access; never let /recover mint tokens for them.
  if (isAdminAuthed(req)) {
    return NextResponse.json({ error: 'Use reset-access' }, { status: 403 });
  }

  const ip = getClientIp(req);
  // Rate-limit BEFORE looking up the player so non-existent names also bucket
  // and an attacker can't enumerate names by timing.
  if (!checkRateLimit(`recover:${name.toLowerCase()}:${ip}`, 5, 60 * 60 * 1000)) {
    return NextResponse.json({ error: 'rate_limited', retryAfter: 60 * 60 }, { status: 429 });
  }

  const container = getContainer('players');
  const { resources } = await container.items
    .query({
      query:
        'SELECT * FROM c WHERE c.sessionId = @sessionId AND LOWER(c.name) = LOWER(@name) AND (NOT IS_DEFINED(c.removed) OR c.removed != true)',
      parameters: [
        { name: '@sessionId', value: sessionId },
        { name: '@name', value: name },
      ],
    })
    .fetchAll();
  const player = resources[0];

  // Constant-time miss: do a real verify against FAKE_HASH so latency matches
  // a real failed verify and an attacker can't distinguish "no player" from "wrong PIN".
  if (!player) {
    if (pin) await verifyPin(pin, FAKE_HASH);
    else await verifyPin(code!, FAKE_HASH);
    return FAIL();
  }

  let ok = false;
  if (pin) {
    if (typeof player.pinHash === 'string' && player.pinHash) {
      ok = await verifyPin(pin, player.pinHash);
    } else {
      // No PIN set — same dummy verify so latency is constant.
      await verifyPin(pin, FAKE_HASH);
      ok = false;
    }
  } else {
    ok = await consumeCode(player.id, code!);
  }

  if (!ok) {
    const updatedEvents = appendEvent(player.recoveryEvents, {
      event: 'recovery-failed',
      at: new Date().toISOString(),
      reason: pin ? 'wrong_pin' : 'wrong_code',
    });
    await container.items.upsert({ ...player, recoveryEvents: updatedEvents });
    return FAIL();
  }

  const newDeleteToken = randomBytes(16).toString('hex');
  const updatedEvents = appendEvent(player.recoveryEvents, {
    event: pin ? 'recovered-via-pin' : 'recovered-via-code',
    at: new Date().toISOString(),
  });
  await container.items.upsert({
    ...player,
    deleteToken: newDeleteToken,
    recoveryEvents: updatedEvents,
  });

  return NextResponse.json({ deleteToken: newDeleteToken });
}
