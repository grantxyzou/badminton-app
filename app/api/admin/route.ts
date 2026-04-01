import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';
import { setAdminCookie, clearAdminCookie, isAdminAuthed, getAdminPin, unauthorized } from '@/lib/auth';
import { checkRateLimit, getClientIp } from '@/lib/rateLimit';
import { getContainer } from '@/lib/cosmos';

// Check if already authenticated
export async function GET(req: NextRequest) {
  return NextResponse.json({ authed: isAdminAuthed(req) });
}

// Verify PIN and set admin cookie
export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  if (!checkRateLimit(`admin:${ip}`, 5, 15 * 60 * 1000)) {
    return NextResponse.json({ error: 'Too many attempts. Try again later.' }, { status: 429 });
  }

  try {
    const body = await req.json();
    const pin = body.pin;
    const name = typeof body.name === 'string' ? body.name.trim().slice(0, 50) : '';
    if (typeof pin !== 'string' || pin.length === 0 || pin.length > 20) {
      return NextResponse.json({ error: 'Incorrect PIN' }, { status: 401 });
    }
    const adminPin = getAdminPin();
    const pinMatch =
      pin.length === adminPin.length &&
      timingSafeEqual(Buffer.from(pin), Buffer.from(adminPin));
    if (!pinMatch) {
      return NextResponse.json({ error: 'Incorrect PIN' }, { status: 401 });
    }

    // Auto-promote member to admin on successful PIN
    if (name) {
      try {
        const container = getContainer('members');
        const { resources } = await container.items
          .query({
            query: 'SELECT * FROM c WHERE LOWER(c.name) = LOWER(@name) AND c.active = true',
            parameters: [{ name: '@name', value: name }],
          })
          .fetchAll();
        if (resources.length > 0 && resources[0].role !== 'admin') {
          await container.items.upsert({ ...resources[0], role: 'admin' });
        }
      } catch {
        // Promotion failure shouldn't block login
      }
    }

    const res = NextResponse.json({ success: true });
    setAdminCookie(res);
    return res;
  } catch {
    return NextResponse.json({ error: 'Verification failed' }, { status: 500 });
  }
}

// Logout — clear admin cookie
export async function DELETE(req: NextRequest) {
  if (!isAdminAuthed(req)) return unauthorized();
  const res = NextResponse.json({ success: true });
  clearAdminCookie(res);
  return res;
}
