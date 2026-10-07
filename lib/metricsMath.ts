/**
 * The club metrics, as pure arithmetic over rows already read
 * (docs/plans/usage-metrics.md). `lib/metrics.ts` does the reads and calls
 * `computeClubMetrics`; the admin Metrics page and the weekly report both go
 * through it, so they cannot disagree.
 *
 * TOTALS ONLY. Nothing returned here carries a name or an id: the output is
 * counts, rates and durations. Rows arrive with names because the older
 * `players` rows have no `memberId`, and the name is the only way to know two
 * rows are one person — it is used as a key and never leaves this file.
 *
 * A rate whose denominator is zero is `null`, never `0`. "Nobody joined, so
 * nobody activated" is not a 0% activation rate, and a page that drew it as
 * one would be the lying empty state with a percent sign.
 */

export interface MetricsSession {
  id: string;
  datetime: string;
  maxPlayers: number;
  signupOpenedAt?: string;
  settledAt?: string;
}

export interface MetricsPlayer {
  sessionId: string;
  name: string;
  memberId?: string;
  timestamp?: string;
  waitlisted?: boolean;
  removed?: boolean;
  cancelledBySelf?: boolean;
  paid?: boolean;
  paidAt?: string;
  writtenOff?: boolean;
}

export interface MetricsRosterEntry {
  memberId: string;
  name: string;
  /** When this person joined the club — membership date, else account date. */
  joinedAt?: string;
}

export interface MetricsInput {
  now: Date;
  /** How many recent sessions the per-session table covers. */
  sessionsShown: number;
  /** Every session of the group with a datetime, any order. */
  sessions: MetricsSession[];
  /** Player rows for those sessions. */
  players: MetricsPlayer[];
  roster: MetricsRosterEntry[];
  /** `raterMemberId` + `createdAt` of each kudos given in the group. */
  kudos: Array<{ raterMemberId: string; createdAt: string }>;
  /** `memberId` + `createdAt` of each stringing job in the group. */
  stringingJobs: Array<{ memberId: string; createdAt: string }>;
  /** `memberId` of each push subscription doc (any device). */
  pushSubscriptions: Array<{ memberId: string }>;
}

export interface SessionMetrics {
  /** `YYYY-MM-DD`, the session's local date as stored. */
  date: string;
  capacity: number;
  confirmed: number;
  waitlisted: number;
  /** Rows the player removed themselves. */
  cancelledBySelf: number;
  /** confirmed / capacity, capped at 1; null when capacity is 0. */
  fillRate: number | null;
  /** Minutes from sign-ups opening to the median sign-up; null when the open time was not recorded. */
  medianSignupMinutes: number | null;
  /** Minutes from sign-ups opening until the last spot went; null if it never filled or the open time is unknown. */
  minutesToFill: number | null;
}

export interface CohortRow {
  /** `YYYY-MM`: the month of each person's first session. */
  cohort: string;
  size: number;
  /** Share of the cohort who played in month +1, +2, +3; null for a month not yet over. */
  returned: Array<number | null>;
}

export interface ClubMetrics {
  generatedAt: string;
  rosterSize: number;
  /** Distinct people with a confirmed spot in the last 4 sessions, and in the 4 before. */
  activeMembers: { last4: number; previous4: number };
  sessions: SessionMetrics[];
  newMembers: {
    /** Joined in the last 90 days. */
    joined90d: number;
    /** Of those (joined at least 14 days ago), how many signed up within 14 days of joining. */
    activationEligible: number;
    activated14d: number;
    activationRate: number | null;
  };
  retention: CohortRow[];
  features: {
    /** Distinct roster members who gave kudos / requested stringing in the last 28 days, and who have push on. */
    kudosGivers28d: number;
    stringingRequesters28d: number;
    pushEnabled: number;
    kudosShare: number | null;
    stringingShare: number | null;
    pushShare: number | null;
  };
  payments: {
    /** Settled lines in the shown sessions (confirmed, not covered). */
    settledLines: number;
    paidLines: number;
    paidRate: number | null;
    /** Paid lines whose payment time is known — `paidAt` is newer than most paid rows. */
    timedLines: number;
    medianDaysToPay: number | null;
    paidWithin7dRate: number | null;
  };
}

const DAY = 86_400_000;
const norm = (s: string) => s.trim().toLowerCase();
const ratio = (n: number, d: number): number | null => (d > 0 ? n / d : null);

export function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

const ms = (iso: string | undefined): number | null => {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
};

const monthKey = (iso: string) => iso.slice(0, 7);
const addMonths = (key: string, k: number): string => {
  const [y, m] = key.split('-').map(Number);
  const idx = y * 12 + (m - 1) + k;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}`;
};

/** A confirmed spot: on the list, not waitlisted, not removed. */
const isConfirmed = (p: MetricsPlayer) => p.removed !== true && p.waitlisted !== true;

export function computeClubMetrics(input: MetricsInput): ClubMetrics {
  const now = input.now.getTime();

  // One key per person: their member id, or for a legacy row without one the
  // roster member holding that name, or else the bare name.
  const idByName = new Map<string, string>();
  for (const r of input.roster) idByName.set(norm(r.name), r.memberId);
  const personKey = (p: MetricsPlayer): string =>
    p.memberId ?? idByName.get(norm(p.name)) ?? `name:${norm(p.name)}`;

  const past = input.sessions
    .filter((s) => (ms(s.datetime) ?? Infinity) <= now)
    .sort((a, b) => a.datetime.localeCompare(b.datetime));
  const bySession = new Map<string, MetricsPlayer[]>();
  for (const p of input.players) {
    const list = bySession.get(p.sessionId);
    if (list) list.push(p);
    else bySession.set(p.sessionId, [p]);
  }
  const rowsOf = (id: string) => bySession.get(id) ?? [];

  // --- Active members ------------------------------------------------------
  const attendees = (ss: MetricsSession[]) => {
    const set = new Set<string>();
    for (const s of ss) for (const p of rowsOf(s.id)) if (isConfirmed(p)) set.add(personKey(p));
    return set.size;
  };
  const activeMembers = {
    last4: attendees(past.slice(-4)),
    previous4: attendees(past.slice(-8, -4)),
  };

  // --- Per-session table ---------------------------------------------------
  const shown = past.slice(-input.sessionsShown);
  const sessions: SessionMetrics[] = shown.map((s) => {
    const rows = rowsOf(s.id);
    const confirmed = rows.filter(isConfirmed).length;
    const opened = ms(s.signupOpenedAt);
    let medianSignupMinutes: number | null = null;
    let minutesToFill: number | null = null;
    if (opened !== null) {
      // Every row that signed up after the open, cancelled or not: speed is
      // about the tap, and a later cancel does not make the tap slower.
      const offsets = rows
        .map((p) => ms(p.timestamp))
        .filter((t): t is number => t !== null && t >= opened)
        .map((t) => (t - opened) / 60_000)
        .sort((a, b) => a - b);
      medianSignupMinutes = median(offsets);
      if (s.maxPlayers > 0 && offsets.length >= s.maxPlayers) {
        minutesToFill = offsets[s.maxPlayers - 1];
      }
    }
    return {
      date: s.datetime.slice(0, 10),
      capacity: s.maxPlayers,
      confirmed,
      waitlisted: rows.filter((p) => p.removed !== true && p.waitlisted === true).length,
      cancelledBySelf: rows.filter((p) => p.removed === true && p.cancelledBySelf === true).length,
      fillRate: s.maxPlayers > 0 ? Math.min(1, confirmed / s.maxPlayers) : null,
      medianSignupMinutes,
      minutesToFill,
    };
  });

  // --- First appearance per person ----------------------------------------
  // Over ALL past sessions, not the shown ones: "new" means new to the club.
  const firstSignup = new Map<string, number>(); // any sign-up row, by its own timestamp
  const monthsPlayed = new Map<string, Set<string>>(); // confirmed, by session month
  for (const s of past) {
    const month = monthKey(s.datetime);
    for (const p of rowsOf(s.id)) {
      const key = personKey(p);
      const t = ms(p.timestamp) ?? ms(s.datetime);
      if (t !== null && t < (firstSignup.get(key) ?? Infinity)) firstSignup.set(key, t);
      if (isConfirmed(p)) {
        const set = monthsPlayed.get(key) ?? new Set<string>();
        set.add(month);
        monthsPlayed.set(key, set);
      }
    }
  }

  // --- New members and activation -----------------------------------------
  let joined90d = 0;
  let activationEligible = 0;
  let activated14d = 0;
  for (const r of input.roster) {
    const joined = ms(r.joinedAt);
    if (joined === null || joined > now || now - joined > 90 * DAY) continue;
    joined90d += 1;
    if (now - joined < 14 * DAY) continue; // too new to judge
    activationEligible += 1;
    const first = firstSignup.get(r.memberId);
    if (first !== undefined && first - joined <= 14 * DAY) activated14d += 1;
  }

  // --- Monthly retention cohorts -------------------------------------------
  const thisMonth = monthKey(input.now.toISOString());
  const cohorts = new Map<string, string[]>();
  for (const [key, months] of monthsPlayed) {
    const first = [...months].sort()[0];
    const list = cohorts.get(first) ?? [];
    list.push(key);
    cohorts.set(first, list);
  }
  const retention: CohortRow[] = [...cohorts.keys()]
    .sort()
    .filter((c) => c < thisMonth) // the current month's cohort has nothing to return to yet
    .slice(-6)
    .map((cohort) => {
      const people = cohorts.get(cohort)!;
      const returned = [1, 2, 3].map((k) => {
        const target = addMonths(cohort, k);
        // A month still in progress would read low by construction.
        if (target >= thisMonth) return null;
        const n = people.filter((key) => monthsPlayed.get(key)!.has(target)).length;
        return n / people.length;
      });
      return { cohort, size: people.length, returned };
    });

  // --- Feature adoption ----------------------------------------------------
  const rosterIds = new Set(input.roster.map((r) => r.memberId));
  const within28 = (iso: string) => {
    const t = ms(iso);
    return t !== null && t <= now && now - t <= 28 * DAY;
  };
  const distinct = (ids: string[]) => new Set(ids.filter((id) => rosterIds.has(id))).size;
  const kudosGivers28d = distinct(input.kudos.filter((k) => within28(k.createdAt)).map((k) => k.raterMemberId));
  const stringingRequesters28d = distinct(
    input.stringingJobs.filter((j) => within28(j.createdAt)).map((j) => j.memberId),
  );
  const pushEnabled = distinct(input.pushSubscriptions.map((p) => p.memberId));
  const rosterSize = input.roster.length;

  // --- Payments over the shown sessions -----------------------------------
  let settledLines = 0;
  let paidLines = 0;
  const daysToPay: number[] = [];
  for (const s of shown) {
    const settledAt = ms(s.settledAt);
    if (settledAt === null) continue;
    for (const p of rowsOf(s.id)) {
      if (!isConfirmed(p) || p.writtenOff === true) continue;
      settledLines += 1;
      if (p.paid !== true) continue;
      paidLines += 1;
      const paidAt = ms(p.paidAt);
      // Paid before the bill was frozen counts as same-day, not negative.
      if (paidAt !== null) daysToPay.push(Math.max(0, (paidAt - settledAt) / DAY));
    }
  }

  return {
    generatedAt: input.now.toISOString(),
    rosterSize,
    activeMembers,
    sessions,
    newMembers: {
      joined90d,
      activationEligible,
      activated14d,
      activationRate: ratio(activated14d, activationEligible),
    },
    retention,
    features: {
      kudosGivers28d,
      stringingRequesters28d,
      pushEnabled,
      kudosShare: ratio(kudosGivers28d, rosterSize),
      stringingShare: ratio(stringingRequesters28d, rosterSize),
      pushShare: ratio(pushEnabled, rosterSize),
    },
    payments: {
      settledLines,
      paidLines,
      paidRate: ratio(paidLines, settledLines),
      timedLines: daysToPay.length,
      medianDaysToPay: median(daysToPay),
      paidWithin7dRate: ratio(daysToPay.filter((d) => d <= 7).length, daysToPay.length),
    },
  };
}
