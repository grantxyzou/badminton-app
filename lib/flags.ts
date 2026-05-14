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
  | 'NEXT_PUBLIC_FLAG_VALUE_HUB_SLICE';

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
    description: 'Slice-0 of the Value-Hub plan (`/root/.claude/plans/system-reminder-you-re-running-in-fizzy-river.md`): a thin end-to-end vertical of equipment catalog (rackets only, seeded ~15 models), one-tap "What\'s your racket?" on Profile, a 30s post-session game-result logger, a single deterministic recommendation card, and the partner-frequency Stats card. Gates the player-facing UI surfaces; the backend containers (`equipmentCatalog`, `playerGear`, `gameResults`) are bootstrapped lazily via `ensureContainer` regardless, so they exist before the flag flips on. On for bpm-next + dev once landed; off on bpm-stable until the 4-week kill-criterion gate clears.',
    owner: 'grant',
    plannedRemoval: 'after Slice-0 kill-criterion gate decides — either promoted to stable + lived-in 2 weeks, or torn down and the flag deleted along with the player-facing UI',
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
