/**
 * One-shot sessionStorage marker: "open the stringing request with this
 * tension". The String tension card's "Get it strung at 24 lb" row writes it
 * and switches to the Stringing tab, and `StringingCard` consumes it once the
 * shop is known to be open, so the member lands on the request form with the
 * number already set (Stats canvas, 2026-10-20). Same shape as
 * `lib/profileView.ts`; anything outside the form's own stepper range is not
 * a tension and is dropped. Storage can throw (private mode, blocked site data);
 * then the row still lands on Stringing, one tap short.
 */
import { TENSION_MAX_LB, TENSION_MIN_LB } from './stringing';

export const STRINGING_INTENT_KEY = 'badminton_stringing_intent';

export function requestStringingAt(lbs: number): void {
  try {
    sessionStorage.setItem(STRINGING_INTENT_KEY, String(Math.round(lbs)));
  } catch {
    /* storage unavailable: the tab switch still happens */
  }
}

/** Is a request waiting? Read without clearing, so the tab can show the form. */
export function hasStringingIntent(): boolean {
  try {
    return sessionStorage.getItem(STRINGING_INTENT_KEY) !== null;
  } catch {
    return false;
  }
}

/** Reads and clears the marker, so a later visit opens on the card. */
export function takeStringingIntent(): number | null {
  try {
    const raw = sessionStorage.getItem(STRINGING_INTENT_KEY);
    sessionStorage.removeItem(STRINGING_INTENT_KEY);
    const n = raw === null ? NaN : Number(raw);
    return Number.isInteger(n) && n >= TENSION_MIN_LB && n <= TENSION_MAX_LB ? n : null;
  } catch {
    return null;
  }
}
