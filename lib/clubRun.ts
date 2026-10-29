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

export type ClubStyle = 'first_come' | 'members_first' | 'custom';

/** `'off'`: the organiser keeps the money outside the app — no bill, no "unpaid". */
export type ClubMoney = 'split' | 'off';

export interface ClubRun {
  style: ClubStyle;
  /** Spots per court; the session's cap is courts × this. `null` = the cap is typed by hand. */
  playersPerCourt: number | null;
  money: ClubMoney;
}

/** The settings a style writes. `custom` has none: it is what any hand edit becomes. */
type ClubRunValues = Omit<ClubRun, 'style'>;

export const CLUB_STYLES: Record<Exclude<ClubStyle, 'custom'>, { label: string; summary: string; values: ClubRunValues }> = {
  first_come: {
    label: 'First come, first served',
    summary: 'Everyone signs up each week; the court cost is split between the players.',
    values: { playersPerCourt: null, money: 'split' },
  },
  members_first: {
    label: 'Members first',
    summary: 'A regular list of members, 8 to a court; the organiser collects the money outside the app.',
    values: { playersPerCourt: 8, money: 'off' },
  },
};

export const PLAYERS_PER_COURT_MIN = 2;
export const PLAYERS_PER_COURT_MAX = 12;

const DEFAULT_RUN: ClubRun = { style: 'first_come', ...CLUB_STYLES.first_come.values };

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
export function clubRunOf(settings: { run?: unknown } | null | undefined): ClubRun {
  const raw = settings?.run;
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_RUN };
  const r = raw as Partial<Record<keyof ClubRun, unknown>>;
  const style: ClubStyle =
    r.style === 'first_come' || r.style === 'members_first' || r.style === 'custom' ? r.style : DEFAULT_RUN.style;
  const base = style === 'custom' ? CLUB_STYLES.first_come.values : CLUB_STYLES[style].values;
  return {
    style,
    playersPerCourt:
      r.playersPerCourt === null ? null : isPlayersPerCourt(r.playersPerCourt) ? r.playersPerCourt : base.playersPerCourt,
    money: r.money === 'off' || r.money === 'split' ? r.money : base.money,
  };
}

/** Start from a style: its values, in full. */
export function applyStyle(style: Exclude<ClubStyle, 'custom'>): ClubRun {
  return { style, ...CLUB_STYLES[style].values };
}

/**
 * Change one setting. The result names the style its values match, so
 * choosing "Members first" and then changing 8 to 6 reads as `custom`, and
 * changing it back reads as "Members first" again.
 */
export function withSetting<K extends keyof ClubRunValues>(run: ClubRun, key: K, value: ClubRunValues[K]): ClubRun {
  const values: ClubRunValues = { playersPerCourt: run.playersPerCourt, money: run.money, [key]: value };
  return { style: styleOf(values), ...values };
}

/** The style whose values these are, or `custom`. */
export function styleOf(values: ClubRunValues): ClubStyle {
  for (const [name, preset] of Object.entries(CLUB_STYLES) as [Exclude<ClubStyle, 'custom'>, (typeof CLUB_STYLES)[keyof typeof CLUB_STYLES]][]) {
    if (preset.values.playersPerCourt === values.playersPerCourt && preset.values.money === values.money) return name;
  }
  return 'custom';
}

/**
 * What the admin settings route will store, or `null` to refuse. The whole
 * object, every field valid — a partial write is refused rather than merged,
 * so a stored `run` is always complete. The STYLE is never taken from the
 * request: it is worked out from the values (`styleOf`), so a stored "Members
 * first" always means the values are that style's.
 */
export function parseClubRun(value: unknown): ClubRun | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  const known = new Set(['style', 'playersPerCourt', 'money']);
  if (Object.keys(v).some((k) => !known.has(k))) return null;
  if (!(v.playersPerCourt === null || isPlayersPerCourt(v.playersPerCourt))) return null;
  if (!(v.money === 'split' || v.money === 'off')) return null;
  const values: ClubRunValues = { playersPerCourt: v.playersPerCourt, money: v.money };
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
