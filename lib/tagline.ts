/**
 * The line under the logo, a different one per visit (Grant, 2026-11-23: "Give
 * me a list", and the B·P·M lines he kept: "Badminton, pretty much.", "…pure
 * magic." and the rest, in `signedOut.taglines`).
 *
 * ONE line per page load, picked on the SERVER from a value both server
 * renders of that load share: the request's CSP nonce (`proxy.ts`, fresh per
 * page request). The splash (`app/layout.tsx`) and Welcome (`SignedOutShell`,
 * via `app/page.tsx`) are drawn as the same pixels, and the splash fades off
 * Welcome, so the two must name the same line; a client-side random pick would
 * also differ between the server HTML and hydration. Picked by hash, not
 * stored: nothing about it needs to survive the visit.
 *
 * No seed (a request the proxy did not see) is the first line, every time.
 */
export function pickTagline(lines: readonly string[], seed: string | null | undefined): string {
  if (lines.length === 0) return '';
  if (!seed) return lines[0];
  // FNV-1a: small, even enough over a base64 nonce, no crypto needed to choose a slogan.
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return lines[(h >>> 0) % lines.length];
}
