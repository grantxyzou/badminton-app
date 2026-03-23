import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';
import { setAdminCookie, clearAdminCookie, isAdminAuthed, getAdminPin, unauthorized } from '@/lib/auth';
import { checkRateLimit, getClientIp } from '@/lib/rateLimit';

// Check if already authenticated
export async function GET(req: NextRequest) {
  return NextResponse.json({ authed: isAdminAuthed(req) });
}

// Verify PIN and set admin cookie
export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  if (!ip) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  if (!checkRateLimit(`admin:${ip}`, 5, 15 * 60 * 1000)) {
    return NextResponse.json({ error: 'Too many attempts. Try again later.' }, { status: 429 });
  }

  try {
    const { pin } = await req.json();
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
