/**
 * "Request sent", carried across the reload that follows an ask
 * (docs/plans/sign-in-redesign.md). Asking to join through a club's link
 * signs the phone in, and signing in reloads so the server decides what to
 * show. The waiting page then says "Request sent" (step 3 of 3) once, on the
 * far side of that reload, and "Your request is still pending" every time
 * after. sessionStorage: one tab, gone when it closes.
 */
const KEY = 'badminton_just_asked';
const FRESH_MS = 2 * 60_000;

export function markJustAsked(club: string): void {
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify({ club, at: Date.now() }));
  } catch {
    /* storage unavailable: the waiting page says "still pending", which is also true */
  }
}

/** Read once: the club asked of in the last two minutes, or null. */
export function consumeJustAsked(): string | null {
  try {
    const raw = window.sessionStorage.getItem(KEY);
    window.sessionStorage.removeItem(KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as { club?: unknown; at?: unknown };
    if (typeof v.club !== 'string' || typeof v.at !== 'number' || Date.now() - v.at > FRESH_MS) return null;
    return v.club;
  } catch {
    return null;
  }
}
