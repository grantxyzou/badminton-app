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
/** The marker for "open the form at its own default tension" — the app icon's
 *  long-press "Request stringing" (lib/appShortcuts.ts), which knows no number. */
const OPEN_FORM = 'open';

export function requestStringingAt(lbs: number): void {
  try {
    sessionStorage.setItem(STRINGING_INTENT_KEY, String(Math.round(lbs)));
  } catch {
    /* storage unavailable: the tab switch still happens */
  }
}

/** Open the request form with no tension chosen. */
export function requestStringing(): void {
  try {
    sessionStorage.setItem(STRINGING_INTENT_KEY, OPEN_FORM);
  } catch {
    /* storage unavailable: the tab switch still happens */
  }
}

/** Open the request form with this string already picked — a string's page,
 *  "Restring with this string" (docs/plans/stringing-canvas-redesign.md).
 *  Stored as JSON so it can never be read as a tension.
 *
 *  `racketId` is the racket the strings map was matched to when the string
 *  was chosen (a bag item id, docs/plans/map-racket-choice.md): the verdict
 *  the member just read was for THAT racket, so the request opens on it. */
export function requestStringingWith(stringLabel: string, racketId?: string | null): void {
  try {
    sessionStorage.setItem(STRINGING_INTENT_KEY, JSON.stringify({ string: stringLabel, ...(racketId ? { racket: racketId } : null) }));
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

/** Reads and clears the marker, so a later visit opens on the card. `'open'`
 *  means open the form at its default; a number, at that tension; `{ string }`,
 *  with that string picked, and `racket` (a bag item id) with that racket. */
export function takeStringingIntent(): number | 'open' | { string: string; racket?: string } | null {
  try {
    const raw = sessionStorage.getItem(STRINGING_INTENT_KEY);
    sessionStorage.removeItem(STRINGING_INTENT_KEY);
    if (raw === OPEN_FORM) return OPEN_FORM;
    if (raw?.startsWith('{')) {
      const parsed: unknown = JSON.parse(raw);
      const label = parsed && typeof parsed === 'object' ? (parsed as { string?: unknown }).string : null;
      if (typeof label !== 'string' || !label.trim() || label.length > 80) return null;
      const racket = (parsed as { racket?: unknown }).racket;
      // A bag item id: matched against the member's own kit, never trusted.
      return typeof racket === 'string' && racket && racket.length <= 120 ? { string: label, racket } : { string: label };
    }
    const n = raw === null ? NaN : Number(raw);
    return Number.isInteger(n) && n >= TENSION_MIN_LB && n <= TENSION_MAX_LB ? n : null;
  } catch {
    return null;
  }
}
