'use client';

import { shareTextOrCopy, type ShareTextOutcome } from '@/lib/shareText';
import { APP_NAME } from '@/lib/brand';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

/**
 * "Sign-ups are open — here's the link", in ONE place.
 *
 * It was in two: `AdvanceSessionForm` and `NextSessionCard` each built the same
 * sentence and shared it their own way. That is the arrangement this repo has
 * been bitten by before — a rule added to a shared function is worthless if a
 * caller reimplemented it — and it had already cost two real differences:
 *
 *   - the club name was a hardcoded string in four places, which stops
 *     being true the moment a second club exists;
 *   - `NextSessionCard` called `navigator.share` by hand and never marked the
 *     external excursion, so iOS evicting the PWA while that sheet was open
 *     returned the admin to Home mid-task. CLAUDE.md states the rule plainly:
 *     any new `navigator.share` must mark. Going through `shareTextOrCopy`
 *     makes that structural rather than remembered — it marks on both the
 *     native and the web branch, and falls back to the clipboard.
 *
 * THE LINK IS THE PLAIN APP ADDRESS — no invite. It used to carry the club's
 * invite so the chat could forward it to a newcomer; invites are one-time now
 * (docs/plans/one-time-invites.md), and a one-time link in a group chat is
 * used up by the first tap. A newcomer gets their own link from the admin's
 * Invite card. Everyone this message reaches is already a member.
 */
export interface SignupShareInput {
  /** The club's name. Falls back to the deployment's own name. */
  groupName?: string | null;
  /** The session's ISO datetime, for the "(Thursday, Sep 18)" aside. */
  datetime?: string | null;
}

/**
 * The fallback when the caller knows of no club — a non-admin, or the flag off.
 *
 * The PRODUCT's name, not a club's, and that is the honest answer rather than a
 * convenient one: if we cannot say which club this session belongs to, naming
 * some particular club would be a guess, and naming the app is simply true.
 */
const DEFAULT_CLUB = APP_NAME;

export function buildSignupShare(input: SignupShareInput): { title: string; text: string; url: string } {
  const club = input.groupName?.trim() || DEFAULT_CLUB;
  const url = typeof window === 'undefined' ? BASE : `${window.location.origin}${BASE}`;

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
