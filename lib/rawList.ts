/**
 * `t.raw()` returns `undefined` for a missing key and there is no type error to
 * warn you: the `as Section[]` cast that used to sit at every call site made
 * TypeScript agree with an assumption nothing checked, and the next line
 * `.map()`s it. That is a full-screen crash on the pages App Review reads, and
 * `scripts/check-i18n-keys.mjs` is structurally blind to `t.raw` — CLAUDE.md
 * says so at the point it describes the legal namespace.
 *
 * `i18n/request.ts` deep-merges English under every locale, so a missing
 * zh-CN key falls back rather than vanishing; this guards the case where the
 * key is absent from BOTH, or where `deepMerge` handed back a shape nobody
 * expected.
 *
 * Returning `[]` is deliberate. A legal page missing one section is a
 * documentation bug; a legal page that will not render at all is a compliance
 * one, and the store consoles link straight to these URLs.
 */
export function rawList<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}
