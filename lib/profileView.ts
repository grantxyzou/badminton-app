/**
 * One-shot sessionStorage marker: "open this Profile sub-screen when Profile
 * mounts". A Stats card's "turn this off" link writes it and switches tab, and
 * `ProfileTab` consumes it, so the member lands on Stats & privacy rather than
 * at the top of Profile looking for the switch. Same shape as `OFFER_PIN_KEY`
 * (`lib/offerPin.ts`). Storage can throw (private mode, blocked site data), and
 * then the link still lands on Profile, one tap short.
 */
export const PROFILE_VIEW_KEY = 'badminton_profile_view';

export type ProfileView = 'stats-privacy';

export function requestProfileView(view: ProfileView): void {
  try {
    sessionStorage.setItem(PROFILE_VIEW_KEY, view);
  } catch {
    /* storage unavailable: the tab switch still happens */
  }
}

/** Reads and clears the marker, so a later visit to Profile opens at the top. */
export function takeProfileView(): ProfileView | null {
  try {
    const v = sessionStorage.getItem(PROFILE_VIEW_KEY);
    sessionStorage.removeItem(PROFILE_VIEW_KEY);
    return v === 'stats-privacy' ? v : null;
  } catch {
    return null;
  }
}
