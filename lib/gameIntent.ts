/**
 * One-shot sessionStorage marker: "open Add a game with this score". The
 * score widget's Save game opens the app on `bpm://open?tab=skills&game=21-18`
 * (lib/widgetBridge.ts), `HomeShell` parks the score here and lands on Stats,
 * and `YourRecordCard` takes it once it is on screen with a session to log
 * into, opening the logger at the partner step with the score already set
 * (docs/plans/native-widgets.md, "Keeping score from the widget"). Same shape
 * as `lib/stringingIntent.ts`. A score that is not two whole numbers inside
 * the game's cap is dropped, never half-applied.
 */
import { gameParam, parseGameParam, type Score } from './scoreRules';

export const GAME_INTENT_KEY = 'badminton_game_intent';

export function requestGameLog(score: Score): void {
  try {
    sessionStorage.setItem(GAME_INTENT_KEY, gameParam(score));
  } catch {
    /* storage unavailable: the tab switch still happens, one tap short */
  }
}

export function hasGameIntent(): boolean {
  try {
    return parseGameParam(sessionStorage.getItem(GAME_INTENT_KEY)) !== null;
  } catch {
    return false;
  }
}

/** Reads and clears the marker. `a` is the side the phone's holder was on. */
export function takeGameIntent(): Score | null {
  try {
    const raw = sessionStorage.getItem(GAME_INTENT_KEY);
    sessionStorage.removeItem(GAME_INTENT_KEY);
    return parseGameParam(raw);
  } catch {
    return null;
  }
}
