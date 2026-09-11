'use client';

import { shareTextOrCopy, type ShareTextOutcome } from '@/lib/shareText';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

/**
 * "Sign-ups are open — here's the link", in ONE place.
 *
 * It was in two: `AdvanceSessionForm` and `NextSessionCard` each built the same
 * sentence and shared it their own way. That is the arrangement this repo has
 * been bitten by before — a rule added to a shared function is worthless if a
 * caller reimplemented it — and it had already cost two real differences:
 *
 *   - the club name was the string 'BPM Badminton' in four places, which stops
 *     being true the moment a second club exists;
 *   - `NextSessionCard` called `navigator.share` by hand and never marked the
 *     external excursion, so iOS evicting the PWA while that sheet was open
 *     returned the admin to Home mid-task. CLAUDE.md states the rule plainly:
 *     any new `navigator.share` must mark. Going through `shareTextOrCopy`
 *     makes that structural rather than remembered — it marks on both the
 *     native and the web branch, and falls back to the clipboard.
 *
 * THE LINK CARRIES THE INVITE when the club has one. That is what makes this
 * message work for a stranger as well as a member: the club chat forwards it to
 * someone who has never opened the app, and they land on the join step for THAT
 * club instead of a generic front door. A member tapping it is already on the
 * roster and joining is idempotent, so one link serves both.
 */
export interface SignupShareInput {
  /** The club's name. Falls back to the deployment's own name. */
  groupName?: string | null;
  /** From `useInviteLink()`. Absent for a non-admin, or with the flag off. */
  inviteUrl?: string | null;
  /** The session's ISO datetime, for the "(Thursday, Sep 18)" aside. */
  datetime?: string | null;
}

/** The deployment's name, until `lib/brand.ts` lands in Phase 4. */
const DEFAULT_CLUB = 'BPM Badminton';

export function buildSignupShare(input: SignupShareInput): { title: string; text: string; url: string } {
  const club = input.groupName?.trim() || DEFAULT_CLUB;
  const url = input.inviteUrl || (typeof window === 'undefined' ? BASE : `${window.location.origin}${BASE}`);

  let dateLabel = '';
  if (input.datetime) {
    // `new Date('nonsense')` does NOT throw — it yields an Invalid Date, and
    // `toLocaleDateString` on one returns the STRING "Invalid Date". A try/catch
    // here catches nothing and ships "(Invalid Date)" into a message the admin
    // is about to paste into a group chat. Check the time value instead; same
    // rule as `toValidIso` in the session route.
    const when = new Date(input.datetime);
    if (!Number.isNaN(when.getTime())) {
      dateLabel = ` (${when.toLocaleDateString(undefined, {
        weekday: 'long',
        month: 'short',
        day: 'numeric',
      })})`;
    }
  }

  return {
    title: club,
    text: `🏸 ${club} — next session sign-up is open${dateLabel}! Tap to sign up: ${url}`,
    url,
  };
}

/** Build it and hand it to the one share path. */
export function shareSignup(input: SignupShareInput): Promise<ShareTextOutcome> {
  return shareTextOrCopy(buildSignupShare(input));
}
