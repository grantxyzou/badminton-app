/**
 * How a club runs its week — one setting per rule, a STYLE that fills them in
 * (docs/plans/six-feathers-onboarding.md).
 *
 * BPM Core runs first come, first served and splits the court cost. Six
 * Feathers, the first club after it, runs a members-first list and keeps its
 * money outside the app. Rather than special-case a club, each rule is a
 * setting on `groups.settings.run`, and a style is only a named set of values
 * an admin can start from and then change.
 *
 * ABSENT MEANS BPM. A club with no `run` — BPM Core today, every club created
 * before this existed — reads exactly as `first_come`, so adding this changed
 * nothing for anyone. Every behaviour reads `clubRunOf`, never the raw field:
 * the same rule as `lateCancelHoursOf`, because a rule a caller re-derives is
 * a rule that drifts.
 *
 * A SETTING JOINS THE MODEL WHEN IT DOES SOMETHING. A style that wrote a value
 * nothing reads would be a switch that lies, so the presets carry only the
 * settings that have shipped. The plan lists the ones still to come.
 */

import { DEFAULT_MEMBERS_FIRST, isMembersFirst, sameMembersFirst, type MembersFirst } from './membersFirst';

export type ClubStyle = 'first_come' | 'members_first' | 'custom';

/** `'off'`: the organiser keeps the money outside the app — no bill, no "unpaid". */
export type ClubMoney = 'split' | 'off';

export interface ClubRun {
  style: ClubStyle;
  /** Spots per court; the session's cap is courts × this. `null` = the cap is typed by hand. */
  playersPerCourt: number | null;
  money: ClubMoney;
  /**
   * Members get first pick until this long before each session; then the
   * waitlist moves up (lib/membersFirst.ts). `null` = no window, the first
   * come, first served rule.
   */
  membersFirst: MembersFirst | null;
  /**
   * How many guests a member may bring to a session (docs/plans/plus-one.md,
   * docs/plans/six-feathers-guests.md). `0` = no guests. Replaces the
   * `guestsAllowed` switch, which still answers for a club that never set it
   * (on = 1) and is still written beside it for rollback.
   */
  guests: GuestCap;
}

export type GuestCap = 0 | 1 | 2;
export const GUESTS_MAX: GuestCap = 2;

export function isGuestCap(v: unknown): v is GuestCap {
  return v === 0 || v === 1 || v === 2;
}

/** The settings a style writes. `custom` has none: it is what any hand edit becomes. */
type ClubRunValues = Omit<ClubRun, 'style'>;

/**
 * A style's values. `guests: null` means the style leaves guests to the club:
 * "First come, first served" says nothing about them, so choosing it keeps
 * whatever the club has, and any number reads as that style.
 */
type StyleValues = Omit<ClubRunValues, 'guests'> & { guests: GuestCap | null };

export const CLUB_STYLES: Record<Exclude<ClubStyle, 'custom'>, { label: string; summary: string; values: StyleValues }> = {
  first_come: {
    label: 'First come, first served',
    summary: 'Everyone signs up each week; the court cost is split between the players.',
    values: { playersPerCourt: null, money: 'split', membersFirst: null, guests: null },
  },
  members_first: {
    label: 'Members first',
    summary: 'Members get first pick each week, 8 to a court, and can bring friends; the organiser collects the money outside the app.',
    values: { playersPerCourt: 8, money: 'off', membersFirst: DEFAULT_MEMBERS_FIRST, guests: 2 },
  },
};

export const PLAYERS_PER_COURT_MIN = 2;
export const PLAYERS_PER_COURT_MAX = 12;

const DEFAULT_RUN: ClubRun = { style: 'first_come', ...CLUB_STYLES.first_come.values, membersFirst: null, guests: 0 };

/** The old switch's answer, for a club whose `run` never named a number of guests. */
function legacyGuests(settings: { guestsAllowed?: unknown } | null | undefined): GuestCap {
  return settings?.guestsAllowed === true ? 1 : 0;
}

function isPlayersPerCourt(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= PLAYERS_PER_COURT_MIN && v <= PLAYERS_PER_COURT_MAX;
}

/**
 * The club's run settings with every gap filled in. A missing, partial or
 * corrupt value never throws and never invents a rule.
 *
 * A gap is filled from the club's own STYLE, not from BPM's: a club that chose
 * "Members first" before a setting existed gets that style's value for it when
 * it ships, because choosing a style is choosing how the club runs. A `custom`
 * club, or one with no style, falls back to how BPM runs. A stored value is
 * always kept over the style's.
 */
export function clubRunOf(settings: { run?: unknown; guestsAllowed?: unknown } | null | undefined): ClubRun {
  const raw = settings?.run;
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_RUN, guests: legacyGuests(settings) };
  const r = raw as Partial<Record<keyof ClubRun, unknown>>;
  const style: ClubStyle =
    r.style === 'first_come' || r.style === 'members_first' || r.style === 'custom' ? r.style : DEFAULT_RUN.style;
  const base = style === 'custom' ? CLUB_STYLES.first_come.values : CLUB_STYLES[style].values;
  return {
    style,
    playersPerCourt:
      r.playersPerCourt === null ? null : isPlayersPerCourt(r.playersPerCourt) ? r.playersPerCourt : base.playersPerCourt,
    money: r.money === 'off' || r.money === 'split' ? r.money : base.money,
    membersFirst:
      r.membersFirst === null ? null : isMembersFirst(r.membersFirst) ? { ...r.membersFirst } : base.membersFirst && { ...base.membersFirst },
    guests: isGuestCap(r.guests) ? r.guests : base.guests ?? legacyGuests(settings),
  };
}

/** Start from a style: its values, in full. */
export function applyStyle(style: Exclude<ClubStyle, 'custom'>, current?: Pick<ClubRun, 'guests'>): ClubRun {
  const values = CLUB_STYLES[style].values;
  return {
    style,
    ...values,
    membersFirst: values.membersFirst && { ...values.membersFirst },
    guests: values.guests ?? current?.guests ?? 0,
  };
}

/**
 * Change one setting. The result names the style its values match, so
 * choosing "Members first" and then changing 8 to 6 reads as `custom`, and
 * changing it back reads as "Members first" again.
 */
export function withSetting<K extends keyof ClubRunValues>(run: ClubRun, key: K, value: ClubRunValues[K]): ClubRun {
  const values: ClubRunValues = {
    playersPerCourt: run.playersPerCourt,
    money: run.money,
    membersFirst: run.membersFirst,
    guests: run.guests,
    [key]: value,
  };
  return { style: styleOf(values), ...values };
}

/** The style whose values these are, or `custom`. */
export function styleOf(values: ClubRunValues): ClubStyle {
  for (const [name, preset] of Object.entries(CLUB_STYLES) as [Exclude<ClubStyle, 'custom'>, (typeof CLUB_STYLES)[keyof typeof CLUB_STYLES]][]) {
    if (
      preset.values.playersPerCourt === values.playersPerCourt &&
      preset.values.money === values.money &&
      sameMembersFirst(preset.values.membersFirst, values.membersFirst) &&
      (preset.values.guests === null || preset.values.guests === values.guests)
    ) {
      return name;
    }
  }
  return 'custom';
}

/**
 * What the admin settings route will store, or `null` to refuse. `current` is
 * the club's stored window and guest number, each kept when the request does
 * not name it. The whole
 * object, every field valid — a partial write is refused rather than merged,
 * so a stored `run` is always complete. The STYLE is never taken from the
 * request: it is worked out from the values (`styleOf`), so a stored "Members
 * first" always means the values are that style's.
 */
export function parseClubRun(
  value: unknown,
  current: { membersFirst?: MembersFirst | null; guests?: GuestCap } = {},
): ClubRun | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  const known = new Set(['style', 'playersPerCourt', 'money', 'membersFirst', 'guests']);
  if (Object.keys(v).some((k) => !known.has(k))) return null;
  if (!(v.playersPerCourt === null || isPlayersPerCourt(v.playersPerCourt))) return null;
  if (!(v.money === 'split' || v.money === 'off')) return null;
  // ABSENT keeps the stored window (`current`): a phone still running the
  // screen from before the setting must not switch a club's window off by
  // saving its money switch. `null` is the explicit "no window".
  const membersFirst = v.membersFirst === undefined ? current.membersFirst ?? null : v.membersFirst;
  if (membersFirst !== null && !isMembersFirst(membersFirst)) return null;
  // The same for guests: absent keeps what the club has.
  const guests = v.guests === undefined ? current.guests ?? 0 : v.guests;
  if (!isGuestCap(guests)) return null;
  const values: ClubRunValues = {
    playersPerCourt: v.playersPerCourt,
    money: v.money,
    membersFirst: membersFirst === null ? null : { daysBefore: membersFirst.daysBefore, time: membersFirst.time },
    guests,
  };
  return { style: styleOf(values), ...values };
}

/**
 * The session cap a court count implies, or `null` when the club types its cap
 * by hand. Clamped to the 1–100 the session routes accept.
 */
export function capacityForCourts(courts: number | null, run: ClubRun): number | null {
  if (run.playersPerCourt === null || courts === null || !Number.isFinite(courts) || courts < 1) return null;
  return Math.min(100, Math.max(1, Math.floor(courts) * run.playersPerCourt));
}

/**
 * How many players a court holds this session (docs/plans/waitlist-court-line.md):
 * the club's own `playersPerCourt` when it sets one, else the session's cap
 * divided by its courts when that comes out even (BPM Core: 12 ÷ 2 = 6). A cap
 * that does not divide — 13 on 2 courts — answers `null`: the line says nothing
 * rather than guess what a court is.
 */
export function playersPerCourtFor(
  session: { courts?: number | null; maxPlayers?: number | null } | null | undefined,
  run: ClubRun,
): number | null {
  if (run.playersPerCourt !== null) return run.playersPerCourt;
  const courts = session?.courts;
  const cap = session?.maxPlayers;
  if (!courts || !cap || !Number.isInteger(courts) || !Number.isInteger(cap) || courts < 1) return null;
  return cap % courts === 0 && cap / courts > 0 ? cap / courts : null;
}

export interface CourtLine {
  /** Players one court holds. */
  perCourt: number;
  /** People on the waitlist who would move up (held-for-unpaid rows excluded). */
  waiting: number;
  /** How many more would make a court's worth; 0 once there are enough. */
  more: number;
}

/**
 * How close the waitlist is to another court's worth, or `null` when a court
 * cannot be worked out. Only rows that would actually move up count: a removed
 * row has left, and a held-for-unpaid row is never promoted.
 */
export function courtLine(
  session: { courts?: number | null; maxPlayers?: number | null } | null | undefined,
  run: ClubRun,
  rows: ReadonlyArray<{ waitlisted?: boolean; removed?: boolean; heldForUnpaid?: boolean }>,
): CourtLine | null {
  const perCourt = playersPerCourtFor(session, run);
  if (perCourt === null) return null;
  const waiting = rows.filter((r) => r.waitlisted === true && r.removed !== true && r.heldForUnpaid !== true).length;
  return { perCourt, waiting, more: Math.max(0, perCourt - waiting) };
}
