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

/**
 * Two request-level guards for every mutating `/api/*` call, in the one place
 * that sees every request before a handler does (the 2026-09-28 audit, S9
 * and S10). Both are DEFENCE IN DEPTH — no handler relies on them.
 *
 *  - BODY SIZE. No handler capped its body; every per-field cap ran after
 *    `req.json()` had already read the lot. A declared `content-length` over
 *    `MAX_BODY_BYTES` is refused with 413 before any read. The largest real
 *    body here is a report (2,000 chars) or a Claude prompt; 256 KiB is a
 *    ceiling on abuse, not a budget. A chunked body declares no length and
 *    passes this check — the per-route rate limits bound that case.
 *  - CROSS-SITE WRITES. The session cookies are SameSite=Lax (OAuth callbacks
 *    need it), which is what stops a cross-site form from carrying them — one
 *    setting, no second line. A `Sec-Fetch-Site: cross-site` mutation, or an
 *    `Origin` whose host is not the request's own, is refused with 403. The
 *    one legitimate cross-site POST is Apple's `form_post` callback, which
 *    arrives from appleid.apple.com by design and proves itself with the
 *    state cookie instead. A browser that sends neither header (old, or a
 *    non-browser client) is let through: this is the second line, not the
 *    first. GET/HEAD/OPTIONS are never touched.
 */
const MAX_BODY_BYTES = 256 * 1024;
const CROSS_SITE_WRITE_ALLOWED = new Set(['/api/auth/apple/callback']);
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function apiPath(req: NextRequest): string | null {
  // As with `.well-known`: the basePath may or may not be on the raw URL.
  const raw = new URL(req.url).pathname.replace(/^\/bpm(?=\/)/, '');
  const p = req.nextUrl.pathname.startsWith('/api/') ? req.nextUrl.pathname : raw;
  return p.startsWith('/api/') ? p : null;
}

export function apiGuards(req: NextRequest): NextResponse | null {
  const path = apiPath(req);
  if (!path || SAFE_METHODS.has(req.method.toUpperCase())) return null;

  const declared = Number(req.headers.get('content-length') ?? '');
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    return NextResponse.json({ error: 'payload_too_large' }, { status: 413 });
  }

  if (!CROSS_SITE_WRITE_ALLOWED.has(path)) {
    if (req.headers.get('sec-fetch-site') === 'cross-site') {
      return NextResponse.json({ error: 'cross_site_request' }, { status: 403 });
    }
    const origin = req.headers.get('origin');
    if (origin !== null) {
      let originHost: string | null = null;
      try {
        originHost = new URL(origin).host;
      } catch {
        originHost = null; // `null`, or unparseable: not this origin
      }
      if (!originHost || originHost !== req.headers.get('host')) {
        return NextResponse.json({ error: 'cross_site_request' }, { status: 403 });
      }
    }
  }
  return null;
}

export function proxy(req: NextRequest): NextResponse {
  const known = wellKnown(req);
  if (known) return known;

  if (apiPath(req) !== null) {
    // API responses never carry the locale cookie; the guards are all that
    // runs here.
    return apiGuards(req) ?? NextResponse.next();
  }

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

// Run on all user-visible paths AND the API (for `apiGuards`); skip Next
// internals and static files. `.well-known` is deliberately NOT excluded —
// the three association files above are answered from here.
export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
