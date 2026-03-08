import { createHash, timingSafeEqual } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';

const COOKIE_NAME = 'admin_session';

const DEV_PIN = '1234';

function getPin(): string {
  if (!process.env.ADMIN_PIN && process.env.NODE_ENV !== 'production') {
    console.warn('[dev] ADMIN_PIN not set — using default PIN: ' + DEV_PIN);
    return DEV_PIN;
  }
  return process.env.ADMIN_PIN ?? '';
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
  res.cookies.set(COOKIE_NAME, '', { maxAge: 0, path: '/' });
}

export { getPin as getAdminPin };

export function isAdminAuthed(req: NextRequest): boolean {
  const cookie = req.cookies.get(COOKIE_NAME)?.value;
  const expected = expectedValue();
  if (!cookie) return false;
  try {
    return timingSafeEqual(Buffer.from(cookie, 'hex'), Buffer.from(expected, 'hex'));
  } catch {
    return false;
  }
}

export function unauthorized(): NextResponse {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}
