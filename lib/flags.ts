/**
 * Feature flags for staged rollout between `bpm-next` (preview) and `bpm-stable`
 * (friend-facing). Flags are read from `NEXT_PUBLIC_FLAG_*` env vars and baked
 * at build time, so changing a flag requires a redeploy (same as any
 * `NEXT_PUBLIC_*` var — see CLAUDE.md).
 *
 * Convention: `NEXT_PUBLIC_FLAG_<STAGE>_<FEATURE>` (e.g. `NEXT_PUBLIC_FLAG_RECOVERY`).
 *
 * Retirement rule: every flag entry below has a `plannedRemoval` date. Two
 * weeks after a stage promotes and is stable, delete the flag and its `off`
 * branch. Prevents permanent tech debt.
 *
 * Server vs client: this helper works in both contexts. For flags that change
 * API response shape or DB writes, prefer reading on the server only — client
 * flag flips can't protect the database.
 */

export type FlagName =
  | 'NEXT_PUBLIC_FLAG_DESIGN_PREVIEW'
  | 'NEXT_PUBLIC_FLAG_COMMAND_CENTER'
  | 'NEXT_PUBLIC_FLAG_SETTLE'
  | 'NEXT_PUBLIC_FLAG_LEDGER'
  | 'NEXT_PUBLIC_FLAG_VALUE_HUB_SLICE'
  | 'NEXT_PUBLIC_FLAG_NAV_RAIL'
  | 'NEXT_PUBLIC_FLAG_SKILL_ASSESS'
  | 'NEXT_PUBLIC_FLAG_SKILL_LEVEL'
  | 'NEXT_PUBLIC_FLAG_SKILL_CALIBRATION'
  | 'NEXT_PUBLIC_FLAG_SKILL_SMOOTHING'
  | 'NEXT_PUBLIC_FLAG_SKILL_DRILLS'
  | 'NEXT_PUBLIC_FLAG_KUDOS'
  | 'NEXT_PUBLIC_FLAG_INSIGHT_CARDS'
  | 'NEXT_PUBLIC_FLAG_GEAR_RECOMMENDER'
  | 'NEXT_PUBLIC_FLAG_STATS_V2';

interface FlagMeta {
  description: string;
  owner: string;
  plannedRemoval: string;
}

export const FLAGS: Record<FlagName, FlagMeta> = {
  NEXT_PUBLIC_FLAG_DESIGN_PREVIEW: {
    description: 'Exposes the /design preview route with the formalized BPM design-system specimen cards, logo candidates, font pairings, and background variants. Off on bpm-stable; on for bpm-next + dev.',
    owner: 'grant',
    plannedRemoval: 'after design system decisions (logo / fonts / background) finalize',
  },
  NEXT_PUBLIC_FLAG_COMMAND_CENTER: {
    description: 'Replaces the AdminDashboard landing screen with the new card-based Command Center (anomaly feed, payment grid, recent sessions, etc.). On for bpm-next + dev once cards are populated; off on bpm-stable until promoted.',
    owner: 'grant',
    plannedRemoval: 'after command center is promoted to stable + lived-in for 2 weeks',
  },
  NEXT_PUBLIC_FLAG_SETTLE: {
    description: 'Surfaces the admin Settle action (lock cost) on Command Center. Backend POST/DELETE /api/session/settle is always available; this flag only gates the button + the read paths in ReceiptSheet/PaymentsCard that prefer session.settled over live recompute. On for bpm-next + dev; off on bpm-stable until promoted.',
    owner: 'grant',
    plannedRemoval: 'after settle is promoted to stable + lived-in for 2 weeks',
  },
  NEXT_PUBLIC_FLAG_LEDGER: {
    description: 'Surfaces the v1.5 ledger page + "Cover their $X" action on PaymentsCard. Backend PATCH writtenOff is always available; this flag only gates the UI entry points. On for bpm-next + dev once landed; off on bpm-stable until promoted.',
    owner: 'grant',
    plannedRemoval: 'after v1.5 is promoted to stable + lived-in for 2 weeks',
  },
  NEXT_PUBLIC_FLAG_VALUE_HUB_SLICE: {
    description: 'Slice-0 of the Value-Hub plan (`docs/plans/value-hub-slice-0.md`): a thin end-to-end vertical of equipment catalog (rackets only, seeded ~15 models), one-tap "What\'s your racket?" on Profile, a 30s post-session game-result logger, a single deterministic recommendation card, and the partner-frequency Stats card. Gates the player-facing UI surfaces; the backend containers (`equipmentCatalog`, `playerGear`, `gameResults`) are bootstrapped lazily via `ensureContainer` regardless, so they exist before the flag flips on. On for bpm-next + dev once landed; off on bpm-stable until the 4-week kill-criterion gate clears.',
    owner: 'grant',
    plannedRemoval: 'RETIRE. The gate was READ on 2026-08-25 (since=2026-08-16, the restarted clock) and it returned verdict: kill — recCard 3/12 repeat-tappers (0.25 vs 0.40), games 0/12 loggers (0.00 vs 0.30), racketSavers 3, cohort 12. BUT the criterion is no longer executable and must not be run as written: it says "revert everything else", and three of the four tracks it was meant to gate had ALREADY shipped (Insight: partner card, game logger, skill trend; Equipment: expanded past racket-only to strings, 71 rackets vs the planned ~15; Learning: drill library + AI coach). Only Track 4 (Reach) was never built. The fan-out decision was therefore made by SHIPPING, not by this gate — a written criterion with no scheduled read date is a note, not a gate. Reverting now would tear out months of merged, tested, live work on the strength of a tap rate. Read the numbers as product feedback instead: the rec card fails on REACH, not value (only 4 of 12 ever tapped it, but 3 of those 4 tapped more than once) — it is buried on the Gear register inside the Stats tab. The game logger is the genuinely weak one: 0 of 12 despite racketSavers:3 proving at least three members held valid member_session cookies and could have logged (POST /api/games and the gear writes require the same cookie), so this is real non-use rather than a blocked path — though it also carried two data-corrupting bugs (same player on both teams, invisible guests) for the whole measurement window, fixed 2026-08-25 in #274.',
  },
  NEXT_PUBLIC_FLAG_NAV_RAIL: {
    description: 'Replaces the floating glass-pill bottom nav with the full-width "Labeled Rail" (spec May 2026): edge-attached, capped to the max-w-lg content column, triple-signal active state, theme-aware. Purely presentational — same Tab ids / routing / i18n / aria. On for bpm-next + dev; off on bpm-stable (legacy .nav-glass) until promoted.',
    owner: 'grant',
    plannedRemoval: 'after the nav rail is promoted to stable + lived-in for 2 weeks (then delete the legacy .nav-glass branch + classes)',
  },
  NEXT_PUBLIC_FLAG_SKILL_ASSESS: {
    description: 'Self-assessment skill trend on Stats (docs/badminton-spec-md.md P0): a periodic anchor-card check-in across 14 skills / 3 dimensions, a then-vs-now radar trend, phase placement (incl. "The Switch"), and top strengths / work-on. Gates the player-facing check-in + trend UI and the /api/assessments routes. On for bpm-next + dev; off on bpm-stable until promoted.',
    owner: 'grant',
    plannedRemoval: 'after skill-assessment P0 is promoted to stable + lived-in for 2 weeks',
  },
  NEXT_PUBLIC_FLAG_SKILL_LEVEL: {
    description: 'Canonical skill level (Phase 1 of the skill-accuracy spine): one derived 1–5 level per member, computed on read by folding self-assessment snapshots (+ legacy Member.stage fallback). Surfaces a private "Your level" card on Stats and prepends the level to the AI insight. Read API is privacy-gated (member cookie / admin). On for bpm-next + dev; off on bpm-stable until promoted.',
    owner: 'grant',
    plannedRemoval: 'after the skill-level spine is promoted to stable + lived-in for 2 weeks',
  },
  NEXT_PUBLIC_FLAG_SKILL_CALIBRATION: {
    description: 'Game calibration (Phase 2 of the skill-accuracy spine): folds logged game results (Elo-lite, seeded by each player\'s self-assessment) into an observed level that silently sharpens the canonical level, and surfaces an opt-in, asymmetric "how your games compare" note on the level card. Requires the value-hub game logger to produce data. On for bpm-next + dev; off on bpm-stable until promoted.',
    owner: 'grant',
    plannedRemoval: 'after the calibration phase is promoted to stable + lived-in for 2 weeks',
  },
  NEXT_PUBLIC_FLAG_SKILL_SMOOTHING: {
    description: 'Progression stability (Phase 3 of the skill-accuracy spine): the canonical level\'s self component becomes a time-decayed EWMA (90-day half-life) of all check-ins instead of just the latest, and the phase is hysteresis-confirmed (promotion needs two consecutive qualifying check-ins or game corroboration; demotion has a sticky margin) so it stops swinging on one check-in. Surfaces an "on track for X — confirm next check-in" hint. On for bpm-next + dev; off on bpm-stable until promoted.',
    owner: 'grant',
    plannedRemoval: 'after the skill-accuracy spine is promoted to stable + lived-in for 2 weeks',
  },
  NEXT_PUBLIC_FLAG_SKILL_DRILLS: {
    description: 'Drill recommendations (skill-followups plan, Phase B): a deterministic engine maps the member\'s lowest-rated skills to concrete practice drills from a static library (band = the skill\'s own rating, rotated weekly by session). Surfaces a private DrillsCard on Stats and lets the AI insight name a real drill. Gated read API (member cookie / admin). On for bpm-next + dev; off on bpm-stable until promoted.',
    owner: 'grant',
    plannedRemoval: 'after drills are promoted to stable + lived-in for 2 weeks',
  },
  NEXT_PUBLIC_FLAG_KUDOS: {
    description: 'Kudos (skill-followups plan, Phase C): positive-only, post-game peer recognition that replaces the cut numeric peer rating. A small fixed set of tags, member-cookie-bound writes (rule 12) gated on co-play, and a private counts-only aggregate (member/admin). No level coupling in v1 — purely social. New `kudos` container (PK /recipientMemberId). On for bpm-next + dev; off on bpm-stable until promoted.',
    owner: 'grant',
    plannedRemoval: 'after kudos is promoted to stable + lived-in for 2 weeks',
  },
  NEXT_PUBLIC_FLAG_INSIGHT_CARDS: {
    description: 'Distributed AI insights: dissolves the standalone "Your read" card into a one-line plain-language greeting at the top of the Stats Summary plus a short, NON-OBVIOUS insight chip attached to each card (level, skill trend). Server-side the /api/stats/insight route switches from {recap, focus} to structured {greeting, level, trend} slices, grounded in deterministically-computed signals (lib/insightSignals.ts) and nullable per card. On for bpm-next + dev; off on bpm-stable (legacy StreakSummaryCard) until promoted.',
    owner: 'grant',
    plannedRemoval: 'after distributed insights are promoted to stable + lived-in for 2 weeks',
  },
  NEXT_PUBLIC_FLAG_GEAR_RECOMMENDER: {
    description: 'Skill-scored equipment recommendations: the racket engine (lib/racketRecommend.ts) AND the string pairing engine (lib/stringPair.ts), both reached through GET /api/recommend. On for bpm-next, off on bpm-stable, which falls back to the coarse stage-derived racket pick. Renamed from NEXT_PUBLIC_FLAG_RACKET_RECOMMENDER when string pairing landed and the old name stopped describing what it gates.',
    owner: 'grant',
    plannedRemoval: '2026-11-19',
  },
  NEXT_PUBLIC_FLAG_STATS_V2: {
    description: 'Stats tab v2: the three registers (Summary / Game stats / Equipment) became four (You / Play / Learn / Gear) with a persistent Level/Games/Kudos overview strip; the 14-axis recharts radar became three dimension bars with club-median ticks; everything that counts sessions you MISSED (streak hero, attendance card, recent-form dots) was removed by product decision; and club comparison became a real opt-out-able feature (bands only, one master switch, asked once on first run). INERT-ON since Stage 8 (2026-08-20): the v1 path was deleted outright, no UI reads this flag any more, and it is \'true\' in both remaining build configs (pr-ci, deploy-next — deploy-stable was deleted 2026-08-25). It now guards only the three v2-only API routes — /api/stats/club/bands, /api/stats/club/gear, /api/stats/drills/done. Turning it OFF no longer falls back to anything; it just 404s those routes and leaves the tab showing load errors. The only remaining move is retirement.',
    owner: 'grant',
    plannedRemoval: '2026-09-03 — two weeks after the Stage 8 flip (2026-08-20). Retirement is pure cleanup, not a decision: delete the FlagName entry, this record, the readFlag case, the three route guards, the flags.test.ts case, the flag-off-404 route tests, and the entry in all three workflows.',
  },
};

function readFlag(name: FlagName): string | undefined {
  switch (name) {
    case 'NEXT_PUBLIC_FLAG_DESIGN_PREVIEW':
      return process.env.NEXT_PUBLIC_FLAG_DESIGN_PREVIEW;
    case 'NEXT_PUBLIC_FLAG_COMMAND_CENTER':
      return process.env.NEXT_PUBLIC_FLAG_COMMAND_CENTER;
    case 'NEXT_PUBLIC_FLAG_SETTLE':
      return process.env.NEXT_PUBLIC_FLAG_SETTLE;
    case 'NEXT_PUBLIC_FLAG_LEDGER':
      return process.env.NEXT_PUBLIC_FLAG_LEDGER;
    case 'NEXT_PUBLIC_FLAG_VALUE_HUB_SLICE':
      return process.env.NEXT_PUBLIC_FLAG_VALUE_HUB_SLICE;
    case 'NEXT_PUBLIC_FLAG_NAV_RAIL':
      return process.env.NEXT_PUBLIC_FLAG_NAV_RAIL;
    case 'NEXT_PUBLIC_FLAG_SKILL_ASSESS':
      return process.env.NEXT_PUBLIC_FLAG_SKILL_ASSESS;
    case 'NEXT_PUBLIC_FLAG_SKILL_LEVEL':
      return process.env.NEXT_PUBLIC_FLAG_SKILL_LEVEL;
    case 'NEXT_PUBLIC_FLAG_SKILL_CALIBRATION':
      return process.env.NEXT_PUBLIC_FLAG_SKILL_CALIBRATION;
    case 'NEXT_PUBLIC_FLAG_SKILL_SMOOTHING':
      return process.env.NEXT_PUBLIC_FLAG_SKILL_SMOOTHING;
    case 'NEXT_PUBLIC_FLAG_SKILL_DRILLS':
      return process.env.NEXT_PUBLIC_FLAG_SKILL_DRILLS;
    case 'NEXT_PUBLIC_FLAG_KUDOS':
      return process.env.NEXT_PUBLIC_FLAG_KUDOS;
    case 'NEXT_PUBLIC_FLAG_INSIGHT_CARDS':
      return process.env.NEXT_PUBLIC_FLAG_INSIGHT_CARDS;
    case 'NEXT_PUBLIC_FLAG_GEAR_RECOMMENDER':
      return process.env.NEXT_PUBLIC_FLAG_GEAR_RECOMMENDER;
    case 'NEXT_PUBLIC_FLAG_STATS_V2':
      return process.env.NEXT_PUBLIC_FLAG_STATS_V2;
    default: {
      // Exhaustiveness guard. Adding a flag to `FlagName` without adding its
      // `case` above used to be silently legal — `readFlag` just returned
      // `undefined`, so `isFlagOn` read `false` and the feature was off
      // everywhere, forever, with no error at build or test time. The `FLAGS`
      // record is compiler-enforced via `Record<FlagName, …>`; this makes the
      // switch enforced too, so the two can no longer drift.
      const unhandled: never = name;
      return unhandled;
    }
  }
}

export function isFlagOn(name: FlagName): boolean {
  return readFlag(name) === 'true';
}

export type EnvName = 'stable' | 'next' | 'dev';

export function getEnv(): EnvName {
  const raw = process.env.NEXT_PUBLIC_ENV;
  if (raw === 'stable' || raw === 'next') return raw;
  return 'dev';
}

export function isPreviewEnv(): boolean {
  return getEnv() === 'next';
}
