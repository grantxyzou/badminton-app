import { NextResponse, type NextRequest } from 'next/server';
import { match } from '@formatjs/intl-localematcher';

const SUPPORTED_LOCALES = ['en', 'zh-CN'] as const;
const DEFAULT_LOCALE = 'en';
const COOKIE_NAME = 'NEXT_LOCALE';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // 1 year

/**
 * Three files that Apple and Google fetch from the DOMAIN ROOT:
 *
 *   /.well-known/apple-developer-domain-association.txt  (Sign in with Apple)
 *   /.well-known/apple-app-site-association               (iOS universal links)
 *   /.well-known/assetlinks.json                          (Android App Links)
 *
 * `basePath: '/bpm'` puts everything in `public/` under `/bpm/...`, so Next
 * 404s those paths. A `rewrites()` entry with `basePath: false` looks like the
 * fix and is not on its own — Next rejects it at boot, because escaping the
 * basePath makes the destination external too and it then demands an absolute
 * URL. next.config.js carries the absolute-URL form, which proxies the root
 * request back into `/bpm/.well-known/...`, and THIS layer answers it.
 *
 * The proxy runs BEFORE routing and sees the raw pathname, so it can answer
 * the request directly. Bodies come from env vars rather than the filesystem
 * for two reasons: this layer has no reliable fs access, and an env var can be
 * set in Azure App Settings without a redeploy — which matters when a console
 * wants the file live before it will verify. It also keeps the Apple team id
 * and the Play App Signing fingerprint out of git.
 *
 * The two JSON files are PARSED before they are served. Apple's CDN and
 * Google's verifier both fail silently on malformed JSON — the links just never
 * verify — whereas a 404 is something `curl -sI` shows in one line.
 */
const WELL_KNOWN: ReadonlyArray<{
  path: string;
  env: string;
  contentType: string;
  json: boolean;
}> = [
  {
    path: '/.well-known/apple-developer-domain-association.txt',
    env: 'APPLE_DOMAIN_ASSOCIATION',
    contentType: 'text/plain; charset=utf-8',
    json: false,
  },
  {
    // No extension, and Apple requires `application/json` — a text/plain AASA
    // is rejected by the CDN with no error surfaced to the developer.
    path: '/.well-known/apple-app-site-association',
    env: 'APPLE_APP_SITE_ASSOCIATION',
    contentType: 'application/json',
    json: true,
  },
  {
    path: '/.well-known/assetlinks.json',
    env: 'ANDROID_ASSET_LINKS',
    contentType: 'application/json',
    json: true,
  },
];

function wellKnown(req: NextRequest): NextResponse | null {
  // Check the RAW url too: with a basePath configured, `nextUrl.pathname` may
  // or may not carry the prefix for a request that never matched a route.
  const raw = new URL(req.url).pathname;
  const entry = WELL_KNOWN.find((e) => raw === e.path || req.nextUrl.pathname === e.path);
  if (!entry) return null;

  const body = process.env[entry.env];
  // Unset means "not doing this here" — fall through to a normal 404 rather
  // than serving an empty file, which the verifier would reject anyway and
  // which would hide the misconfiguration.
  if (!body) return null;

  if (entry.json) {
    try {
      JSON.parse(body);
    } catch {
      // Same posture as unset: a visible 404 beats a 200 that verifies nothing.
      console.error(`[well-known] ${entry.env} is not valid JSON; not serving ${entry.path}`);
      return null;
    }
  }

  return new NextResponse(body, {
    status: 200,
    headers: {
      'content-type': entry.contentType,
      'cache-control': 'public, max-age=300',
    },
  });
}

export function proxy(req: NextRequest): NextResponse {
  const known = wellKnown(req);
  if (known) return known;

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
// files. `.well-known` is deliberately NOT excluded — the three association
// files above are answered from here.
export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'],
};
