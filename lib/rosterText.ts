import { compareBySignup } from '@/lib/capacity';

/**
 * The session's list as plain text, ready to paste into a group chat
 * (docs/plans/six-feathers-onboarding.md).
 *
 * A club that runs its week in WhatsApp keeps ONE numbered list in the chat and
 * everyone edits a copy of it: Six Feathers reposted theirs about ninety times
 * in eighteen days, and a stale paste blanked people who were on it. With the
 * list in the app the chat can stay the broadcast while the app stays the one
 * copy — the admin posts this text, nobody edits it.
 *
 * The shape follows theirs on purpose: a header line, a numbered list with the
 * open spots as empty numbers (that is how the chat reads "how many left"), and
 * a numbered waiting list. Order is the order the app already ranks sign-ups
 * in (`compareBySignup`), so the text and the capacity check never disagree.
 *
 * English only, like every admin surface (CLAUDE.md, "admin surfaces are
 * English-only"). Pure: no I/O, no clock, no window.
 */
export interface RosterTextPlayer {
  id: string;
  name: string;
  timestamp?: string;
  waitlisted?: boolean;
  removed?: boolean;
}

export interface RosterTextInput {
  /** The club's name; the header leads with it when present. */
  groupName?: string | null;
  /** The session's ISO datetime. */
  datetime?: string | null;
  courts?: number | null;
  maxPlayers?: number | null;
  players: RosterTextPlayer[];
  /** IANA zone for the date. Absent = the device's own, as the fmt helpers do. */
  timeZone?: string;
  /** The app's address, closing the text: where to join or drop out instead of editing. */
  link?: string;
}

/**
 * Past this many spots the empty numbers stop being a picture of what is left
 * and become a wall to scroll past. A session over it lists who is in and says
 * how many spots remain instead.
 */
export const MAX_BLANK_SLOTS = 64;

function headerDate(iso: string | null | undefined, timeZone?: string): string {
  if (!iso) return '';
  const when = new Date(iso);
  // `new Date('nonsense')` does not throw; its time value is NaN (the same
  // trap `buildSignupShare` documents).
  if (Number.isNaN(when.getTime())) return '';
  const day = when.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone });
  const time = when.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone });
  return `${day}, ${time}`;
}

export function formatRosterText(input: RosterTextInput): string {
  const live = input.players.filter((p) => p.removed !== true);
  const confirmed = live.filter((p) => p.waitlisted !== true).sort(compareBySignup);
  const waiting = live.filter((p) => p.waitlisted === true).sort(compareBySignup);
  const cap = Math.max(0, Math.floor(input.maxPlayers ?? 0));

  const header = [
    `🏸 ${input.groupName?.trim() || 'Badminton'}`,
    headerDate(input.datetime, input.timeZone),
    (input.courts ?? 0) > 0 ? `${input.courts} ${input.courts === 1 ? 'court' : 'courts'}` : '',
  ]
    .filter(Boolean)
    .join(' · ');

  const lines: string[] = [header, ''];
  const showBlanks = cap > 0 && cap <= MAX_BLANK_SLOTS;
  const rows = showBlanks ? Math.max(cap, confirmed.length) : confirmed.length;
  for (let i = 0; i < rows; i++) {
    const p = confirmed[i];
    lines.push(p ? `${i + 1}. ${p.name.trim()}` : `${i + 1}.`);
  }
  if (!showBlanks && cap > confirmed.length) {
    const left = cap - confirmed.length;
    lines.push(`(${left} ${left === 1 ? 'spot' : 'spots'} left)`);
  }

  lines.push('', 'Waiting list');
  if (waiting.length === 0) lines.push('1.');
  waiting.forEach((p, i) => lines.push(`${i + 1}. ${p.name.trim()}`));

  if (input.link) lines.push('', `Join or drop out in the app: ${input.link}`);

  return lines.join('\n');
}
