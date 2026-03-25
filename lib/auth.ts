import { createHash, timingSafeEqual } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';

const COOKIE_NAME = 'admin_session';

function getPin(): string {
  const pin = process.env.ADMIN_PIN;
  if (!pin) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('ADMIN_PIN environment variable is not set');
    }
    console.warn('[dev] ADMIN_PIN not set — admin login will fail. Set ADMIN_PIN in .env.local');
    return '';
  }
  return pin;
}

function expectedValue(): string {
  return createHash('sha256').update(`badminton-admin:${getPin()}`).digest('hex');
}

export function setAdminCookie(res: NextResponse): void {
  res.cookies.set(COOKIE_NAME, expectedValue(), {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 60 * 60 * 8, // 8 hours
    path: '/',
  });
}

export function clearAdminCookie(res: NextResponse): void {
  res.cookies.set(COOKIE_NAME, '', {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 0,
    path: '/',
  });
}

export { getPin as getAdminPin };

export function isAdminAuthed(req: NextRequest): boolean {
  const cookie = req.cookies.get(COOKIE_NAME)?.value;
  const expected = expectedValue();
  if (!cookie) return false;
  try {
    const cookieBuf = Buffer.from(cookie, 'hex');
    const expectedBuf = Buffer.from(expected, 'hex');
    if (cookieBuf.length !== expectedBuf.length) {
      console.warn('[auth] Cookie length mismatch — possible tampering');
      return false;
    }
    return timingSafeEqual(cookieBuf, expectedBuf);
  } catch {
    console.warn('[auth] Cookie comparison failed — invalid format');
    return false;
  }
}

export function unauthorized(): NextResponse {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}
