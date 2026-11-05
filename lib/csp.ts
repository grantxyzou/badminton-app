/**
 * The Content-Security-Policy, built in ONE place (audit, 2026-11-05).
 *
 * It lived in `next.config.js` as a static header with `script-src 'self'
 * 'unsafe-inline'`, which let ANY inline script run — the one rule that turns
 * an injected `<script>` into a working attack. `proxy.ts` now mints a fresh
 * NONCE per page request and sends this policy with it: the browser runs only
 * inline scripts carrying that nonce, and Next stamps it on its own (it reads
 * the nonce from the policy on the request), as `app/layout.tsx` does on the
 * launch screen's pre-paint script.
 *
 * `'unsafe-inline'` stays BESIDE the nonce on purpose: every browser that
 * understands nonces ignores it when one is present (CSP Level 2), and the
 * rare one that does not keeps working instead of going blank. Styles keep
 * `'unsafe-inline'`: React writes inline `style` attributes everywhere, and a
 * style cannot run code.
 */

/** The origin of `NEXT_PUBLIC_ASSET_BASE`, or '' when the pictures are served here (`lib/assetUrl.ts`). */
export function assetOrigin(base: string | undefined = process.env.NEXT_PUBLIC_ASSET_BASE): string {
  const trimmed = (base ?? '').trim();
  if (!trimmed) return '';
  try {
    return new URL(trimmed).origin;
  } catch {
    return '';
  }
}

export interface CspOptions {
  /** The per-request nonce; absent for a response with no page in it. */
  nonce?: string;
  /** `next dev` needs eval for fast refresh. */
  dev?: boolean;
  /** Override for tests; defaults to the build's `NEXT_PUBLIC_ASSET_BASE`. */
  assetBase?: string;
}

export function buildCsp({ nonce, dev = process.env.NODE_ENV === 'development', assetBase }: CspOptions = {}): string {
  const origin = assetOrigin(assetBase ?? process.env.NEXT_PUBLIC_ASSET_BASE);
  const script = dev
    ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'"
    : nonce
      ? `script-src 'self' 'nonce-${nonce}' 'unsafe-inline'`
      : "script-src 'self' 'unsafe-inline'";
  return [
    "default-src 'self'",
    script,
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self'",
    // The generated pictures' storage container, when the build names one
    // (`lib/assetUrl.ts`, docs/plans/asset-storage.md).
    `img-src 'self' data:${origin ? ` ${origin}` : ''}`,
    "connect-src 'self'",
    // The four the 2026-09-28 audit found missing. `frame-ancestors` is the CSP
    // form of X-Frame-Options DENY (XFO is ignored by a browser that honours
    // this); `base-uri` stops an injected <base> from redirecting every
    // relative URL; `object-src` shuts the plugin door; `form-action` keeps a
    // form from posting off-origin. Apple's form_post lands ON this origin from
    // Apple's page, which Apple's CSP governs, not this one.
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "object-src 'none'",
    "form-action 'self'",
  ].join('; ');
}

/** 128 random bits, base64 — a fresh one per page request. */
export function newNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}
