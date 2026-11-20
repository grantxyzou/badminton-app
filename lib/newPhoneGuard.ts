import type { StoredAccessRequest } from '@/lib/accessRequest';
import type { Member } from '@/lib/types';

/**
 * HOW OFTEN A STRANGER CAN ASK "IS THIS YOU?" (docs/plans/sign-in-redesign.md,
 * step 3; security review, 2026-11-20).
 *
 * The number on the prompt makes a blind tap a one-in-three chance, not a
 * guard on its own: with no limit, someone who knows the name could keep the
 * prompt coming until one was tapped without reading. So the limit is per
 * PERSON, not per caller (addresses rotate, a sign-in cookie is reusable):
 *
 *   - one waiting ask at a time — a second sign-in cannot queue behind it;
 *   - at most `MAX_ASKS_PER_DAY` asks a day, so at most that many prompts;
 *   - after any "No, it's not me" or wrong number, none for a day.
 *
 * Asking again from the SAME new phone replaces its waiting ask (and counts).
 * A refusal stores and sends nothing, and answers like any other ask.
 *
 * AN ORGANIZER ASK IS NOT LIMITED BY ANY OF THAT (second review, 2026-11-20):
 * it prompts nobody's phone, and counting it let one stranger spend a
 * person's three asks every day and shut them out of the organizer too. It is
 * stored like any ask (two on one person cannot be approved; the organizer
 * clears them), and its PUSH to the organizers goes at most once a day per
 * person (`mayPushOrganizers`).
 */
export const MAX_ASKS_PER_DAY = 3;
export const NEW_PHONE_WINDOW_MS = 24 * 60 * 60 * 1000;

type Log = NonNullable<Member['newPhoneLog']>;

function recent(log: Member['newPhoneLog'], now: number): Log {
  return (Array.isArray(log) ? log : []).filter((e) => e && typeof e.at === 'number' && now - e.at < NEW_PHONE_WINDOW_MS);
}

/** May a new "Is this you?" ask be filed for this person now? */
export function mayAskNewPhone(
  log: Member['newPhoneLog'],
  open: StoredAccessRequest[],
  link: { provider: string; sub: string },
  now: number = Date.now(),
): boolean {
  const day = recent(log, now).filter((e) => !e.organizer);
  if (day.some((e) => e.stopped)) return false;
  if (day.length >= MAX_ASKS_PER_DAY) return false;
  // One at a time: another new phone's ask still waiting blocks this one.
  return !open.some(
    (r) => r.link && r.approvedAt === undefined && !(r.link.provider === link.provider && r.link.sub === link.sub),
  );
}

/** The log with this ask counted. */
export function noteAsked(log: Member['newPhoneLog'], now: number = Date.now()): Log {
  return [...recent(log, now), { at: now }];
}

/** May the organizers be pushed about an ask for this person? Once a day. */
export function mayPushOrganizers(log: Member['newPhoneLog'], now: number = Date.now()): boolean {
  return !recent(log, now).some((e) => e.organizer);
}

/** The log with an organizer push counted. */
export function noteOrganizersPushed(log: Member['newPhoneLog'], now: number = Date.now()): Log {
  return [...recent(log, now), { at: now, organizer: true }];
}

/** The log after "No, it's not me" or a wrong number: no new ask for a day. */
export function noteStopped(log: Member['newPhoneLog'], now: number = Date.now()): Log {
  return [...recent(log, now), { at: now, stopped: true }];
}
