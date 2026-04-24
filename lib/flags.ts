/**
 * Feature flags for staged rollout between `bpm-next` (preview) and `bpm-stable`
 * (friend-facing). Flags are read from `NEXT_PUBLIC_FLAG_*` env vars and baked
 * at build time, so changing a flag requires a redeploy (same as any
 * `NEXT_PUBLIC_*` var — see CLAUDE.md).
 *
 * Convention: `NEXT_PUBLIC_FLAG_<STAGE>_<FEATURE>` (e.g. `NEXT_PUBLIC_FLAG_STAGE0_NEW_NAV`).
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
  | 'NEXT_PUBLIC_FLAG_DEMO'
  | 'NEXT_PUBLIC_FLAG_STAGE0_NEW_NAV'
  | 'NEXT_PUBLIC_FLAG_DESIGN_PREVIEW';

interface FlagMeta {
  description: string;
  owner: string;
  plannedRemoval: string;
}

export const FLAGS: Record<FlagName, FlagMeta> = {
  NEXT_PUBLIC_FLAG_DEMO: {
    description: 'End-to-end promotion test flag. Delete after first successful promotion.',
    owner: 'grant',
    plannedRemoval: '2026-05-01',
  },
  NEXT_PUBLIC_FLAG_STAGE0_NEW_NAV: {
    description: 'Stage 0a: new bottom nav (Home · Games · Stats · You). Admin moves to overflow.',
    owner: 'grant',
    plannedRemoval: 'two weeks after Stage 0a promotes',
  },
  NEXT_PUBLIC_FLAG_DESIGN_PREVIEW: {
    description: 'Exposes the /design preview route with the formalized BPM design-system specimen cards, logo candidates, font pairings, and background variants. Off on bpm-stable; on for bpm-next + dev.',
    owner: 'grant',
    plannedRemoval: 'after design system decisions (logo / fonts / background) finalize',
  },
};

function readFlag(name: FlagName): string | undefined {
  switch (name) {
    case 'NEXT_PUBLIC_FLAG_DEMO':
      return process.env.NEXT_PUBLIC_FLAG_DEMO;
    case 'NEXT_PUBLIC_FLAG_STAGE0_NEW_NAV':
      return process.env.NEXT_PUBLIC_FLAG_STAGE0_NEW_NAV;
    case 'NEXT_PUBLIC_FLAG_DESIGN_PREVIEW':
      return process.env.NEXT_PUBLIC_FLAG_DESIGN_PREVIEW;
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
