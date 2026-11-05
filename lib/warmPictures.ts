/**
 * The member's OWN pictures, fetched ahead of the screen that shows them
 * (Grant, 2026-11-05: "It takes a split second to load out the string asset
 * like the renders").
 *
 * The Equipment card draws the main racket's head and its string's packet,
 * but its register only mounts when it is opened, so the pictures started
 * downloading at the tap. The card remembers their addresses here (in this
 * phone's storage: catalog picture paths, nothing about the person), and the
 * shell fetches them at low priority while the other tabs open behind the
 * launch screen — so the first tap finds them in the browser's cache, decoded.
 *
 * Best-effort throughout: storage may be off, an address may 404; nothing
 * here can fail a screen.
 */
const KEY = 'bpm_own_pictures';
const MAX = 6;

export function rememberPictures(urls: Array<string | null | undefined>): void {
  const list = urls.filter((u): u is string => typeof u === 'string' && u.length > 0).slice(0, MAX);
  try {
    if (list.length) localStorage.setItem(KEY, JSON.stringify(list));
  } catch { /* storage off */ }
}

export function rememberedPictures(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((u) => typeof u === 'string').slice(0, MAX) : [];
  } catch {
    return [];
  }
}

/** Fetch and decode the remembered pictures, after everything else. */
export function warmRememberedPictures(): void {
  if (typeof window === 'undefined' || typeof Image === 'undefined') return;
  for (const src of rememberedPictures()) {
    const img = new Image();
    (img as HTMLImageElement & { fetchPriority?: string }).fetchPriority = 'low';
    img.decoding = 'async';
    img.src = src;
    img.decode?.().catch(() => {});
  }
}

/** Forget them (sign-out), so the next person on a shared phone starts clean. */
export function forgetPictures(): void {
  try { localStorage.removeItem(KEY); } catch { /* storage off */ }
}
