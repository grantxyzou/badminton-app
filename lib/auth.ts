import { createHash, timingSafeEqual } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';

const COOKIE_NAME = 'admin_session';

function expectedValue(): string {
  const pin = process.env.ADMIN_PIN ?? '';
  return createHash('sha256').update(`badminton-admin:${pin}`).digest('hex');
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

export function isAdminAuthed(req: NextRequest): boolean {
  const cookie = req.cookies.get(COOKIE_NAME)?.value;
  const expected = expectedValue();
  if (!cookie || !process.env.ADMIN_PIN) return false;
  try {
    return timingSafeEqual(Buffer.from(cookie, 'hex'), Buffer.from(expected, 'hex'));
  } catch {
    return false;
  }
}

export function unauthorized(): NextResponse {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}
