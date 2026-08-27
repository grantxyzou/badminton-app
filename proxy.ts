import { NextResponse, type NextRequest } from 'next/server';
import { match } from '@formatjs/intl-localematcher';

const SUPPORTED_LOCALES = ['en', 'zh-CN'] as const;
const DEFAULT_LOCALE = 'en';
const COOKIE_NAME = 'NEXT_LOCALE';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // 1 year

/**
 * Sign in with Apple verifies domain ownership by fetching a token file from
 * the DOMAIN ROOT:
 *
 *   https://bpm.grantzou.com/.well-known/apple-developer-domain-association.txt
 *
 * `basePath: '/bpm'` puts everything in `public/` under `/bpm/...`, so Next
 * 404s that path. A `rewrites()` entry with `basePath: false` looks like the
 * fix and is not — Next rejects it at boot, because escaping the basePath makes
 * the destination external too and it then demands an absolute URL.
 *
 * The proxy runs BEFORE routing and sees the raw pathname, so it can answer
 * the request directly. The token comes from an env var rather than the
 * filesystem for two reasons: this layer has no reliable fs access, and an env
 * var can be set in Azure App Settings without a redeploy — which matters when
 * Apple's console wants the file live before it will verify.
 */
const APPLE_ASSOCIATION_PATH = '/.well-known/apple-developer-domain-association.txt';

function appleDomainAssociation(req: NextRequest): NextResponse | null {
  // Check the RAW url too: with a basePath configured, `nextUrl.pathname` may
  // or may not carry the prefix for a request that never matched a route.
  const raw = new URL(req.url).pathname;
  if (raw !== APPLE_ASSOCIATION_PATH && req.nextUrl.pathname !== APPLE_ASSOCIATION_PATH) {
    return null;
  }
  const token = process.env.APPLE_DOMAIN_ASSOCIATION;
  // Unset means "not doing Apple here" — fall through to a normal 404 rather
  // than serving an empty file, which Apple would reject anyway and which
  // would hide the misconfiguration.
  if (!token) return null;
  return new NextResponse(token, {
    status: 200,
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'public, max-age=300',
    },
  });
}

export function proxy(req: NextRequest): NextResponse {
  const apple = appleDomainAssociation(req);
  if (apple) return apple;

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

// Run on all user-visible paths; skip API routes, Next internals, and static
// files. `.well-known` is deliberately NOT excluded — the Apple domain
// association above is answered from here.
export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'],
};
