import { NextResponse, type NextRequest } from 'next/server';
import { match } from '@formatjs/intl-localematcher';

const SUPPORTED_LOCALES = ['en', 'zh-CN'] as const;
const DEFAULT_LOCALE = 'en';
const COOKIE_NAME = 'NEXT_LOCALE';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // 1 year

export function middleware(req: NextRequest): NextResponse {
  if (req.cookies.get(COOKIE_NAME)) {
    return NextResponse.next();
  }

  const accept = req.headers.get('accept-language') ?? '';
  let locale: string = DEFAULT_LOCALE;
  try {
    const preferred = accept
      .split(',')
      .map((s) => s.split(';')[0]!.trim())
      .filter(Boolean);
    if (preferred.length > 0) {
      locale = match(preferred, SUPPORTED_LOCALES as unknown as string[], DEFAULT_LOCALE);
    }
  } catch {
    locale = DEFAULT_LOCALE;
  }

  const res = NextResponse.next();
  res.cookies.set({
    name: COOKIE_NAME,
    value: locale,
    path: '/bpm',
    maxAge: COOKIE_MAX_AGE,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
  });
  return res;
}

// Run on all user-visible paths; skip API routes, Next internals, and static files.
export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'],
};
