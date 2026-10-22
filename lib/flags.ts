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
  | 'NEXT_PUBLIC_FLAG_GEAR_RECOMMENDER'
  | 'NEXT_PUBLIC_FLAG_STRINGING'
  | 'NEXT_PUBLIC_FLAG_NATIVE_MIGRATE'
  | 'NEXT_PUBLIC_FLAG_MULTI_GROUP'
  | 'NEXT_PUBLIC_FLAG_RACKET_FIT'
  | 'NEXT_PUBLIC_FLAG_PAYMENTS_AUTO'
  | 'NEXT_PUBLIC_FLAG_STORE_CREDIT'
  | 'NEXT_PUBLIC_FLAG_LEDGER_MIRROR';

interface FlagMeta {
  description: string;
  owner: string;
  /**
   * ISO `YYYY-MM-DD`, or one of the documented exemptions in
   * `__tests__/flags.test.ts`.
   *
   * IT MUST BE A DATE, and that is not pedantry. Eleven flags used to say
   * "after X is promoted to stable + lived-in for 2 weeks" — a condition that
   * became impossible on 2026-08-25 when the second deployment was deleted and
   * there stopped being a promotion event. They sat un-retireable for months
   * because nobody can notice that a sentence has quietly become false, whereas
   * anybody can notice a date in the past.
   */
  plannedRemoval: string;
  /** Anything the removal needs that a date cannot carry — a follow-up to do
   *  at the same time, or the reasoning behind the decision. */
  note?: string;
}

export const FLAGS: Record<FlagName, FlagMeta> = {
  NEXT_PUBLIC_FLAG_DESIGN_PREVIEW: {
    description: 'Exposes the /design preview route with the formalized design-system specimen cards, logo candidates, font pairings, and background variants. Off on bpm-stable; on for bpm-next + dev.',
    owner: 'grant',
    plannedRemoval: 'never',
    note: 'Deliberately dateless. This gates the /design preview route — developer tooling, not a staged feature, so there is no ship moment to count two weeks from. It retires when the route does.',
  },
  NEXT_PUBLIC_FLAG_NATIVE_MIGRATE: {
    description:
      'The one-time link that carries a signed-in PWA identity into the native (App Store / Play) shell — docs/plans/native-shell.md WP5. Gates two SERVER-side credential-minting routes (POST /api/auth/migrate/{start,claim}), the "Move to the app" Profile row and the native "Enter code" row. lib/authMigration.ts: link code + 6-digit short code as sibling docs in `authmigration` (PK /id), TTL 5 min, single use, point reads only. The claim re-mints deleteToken because DELETE /api/players never accepts member_session. Held off until the store listings existed; ON since 2026-10-07, when both were live.',
    owner: 'grant',
    plannedRemoval: '2026-12-01',
    note: 'Dated ~8 weeks after the intended store launch. Retire once the installed-PWA base has moved: the row and both routes go, the container is dropped.',
  },
  NEXT_PUBLIC_FLAG_MULTI_GROUP: {
    description:
      'Several clubs in the one deployment (docs/plans/multi-group.md) — the explicit Stage-2 choice, made 2026-09-07 so strangers who install the store app have somewhere to go. Read SERVER-SIDE: off, every request resolves to groupId "bpm" and nothing observable changes; on, the cookie claim plus a membership check decide. Phase 0 ships no behaviour at all — only lib/groupScope.ts (the container classification), the mock store\'s @groupId filter, and the additive types — so the flag is registered before anything reads it.',
    owner: 'grant',
    plannedRemoval: '2026-12-15',
    note: 'About two weeks after the intended Phase 5 cutover. Retiring it means deleting the "resolve to bpm" branch AND flipping TOLERATE_UNSTAMPED off in lib/groupScope.ts (only after the migrate-groups status read shows zero unstamped rows for a week), not just removing the switch.',
  },
  NEXT_PUBLIC_FLAG_STRINGING: {
    description:
      'The stringing service (design "Stringing", Aug 2026). Stage 1 is the BENCH only: the stringingJobs container plus the admin-side job list, job detail and intake form. Gates the /api/stringing/* routes server-side as well as the UI, because the price a stringer charges is admin-only data and a client flag cannot protect it. The player side landed too: the Home card, the request sheet, and the admin-controlled shop sign. It is behind this flag TRANSITIVELY rather than directly -- StringingCard never calls isFlagOn; it reads GET /api/stringing/shop, which 404s when the flag is off, which the card treats as UNKNOWN and renders as the "Coming soon" state. That indirection is load-bearing: tidying up the 404 handling in that card would silently un-gate the feature. Turning this off hides the bench and 404s the routes; no player-visible surface changes either way.',
    owner: 'grant',
    plannedRemoval: '2026-11-15',
  },
  NEXT_PUBLIC_FLAG_GEAR_RECOMMENDER: {
    description: 'Skill-scored equipment recommendations: the racket engine (lib/racketRecommend.ts) AND the string pairing engine (lib/stringPair.ts), both reached through GET /api/recommend. On for bpm-next, off on bpm-stable, which falls back to the coarse stage-derived racket pick. Renamed from NEXT_PUBLIC_FLAG_RACKET_RECOMMENDER when string pairing landed and the old name stopped describing what it gates.',
    owner: 'grant',
    plannedRemoval: '2026-11-19',
  },
  NEXT_PUBLIC_FLAG_RACKET_FIT: {
    description: 'The racket FIT engine (lib/racketFit.ts) — a distance model against a target spec anchored on the member\'s current racket and their fit answers — in place of the seven skill-proxy scorers in lib/racketRecommend.ts, on the racket branch of GET /api/recommend. Off → that branch is unchanged byte-for-byte. Phase 2 of docs/plans/racket-fit-engine.md.',
    owner: 'grant',
    plannedRemoval: '2026-10-23',
    note: 'Retiring this flag means deleting the OFF branch: recommendRackets, its seven scorers and lib/recommend.ts\'s stage-derived fallback (Phase 4 of the plan), plus the transitional English renderer lib/fitReasonText.ts once the client reads reason KEYS. Pull GEAR_RECOMMENDER forward at the same time — it will have no off branch left.',
  },
  NEXT_PUBLIC_FLAG_LEDGER_MIRROR: {
    description:
      'Phase 2 of docs/plans/payments.md, stage 1: every charge and payment ALSO writes an append-only `ledger` entry beside the fields the app reads (Player.paid, owedAmount, StringingJob.paidAt stay the truth). Read SERVER-side by lib/ledgerMirror.ts; off, the mirror is a no-op and the backfill route 404s. Nothing visible changes either way.',
    owner: 'grant',
    plannedRemoval: '2026-12-05',
    note: 'Retire once the reconcile (stage 2) has run clean for four weeks and stage 4 (ledger as truth) is planned — the off branch is only the no-op.',
  },
  NEXT_PUBLIC_FLAG_STORE_CREDIT: {
    description:
      'Store credit and gift cards (docs/plans/payments.md, the first slice of the Phase 2 ledger): admins give credit and mint single-use gift codes; members redeem codes and "Pay with credit" from the Home balance. Read SERVER-side by /api/credit/* and /api/admin/credit, /api/admin/giftcards; off, those 404 and the UI hides.',
    owner: 'grant',
    plannedRemoval: '2026-11-21',
    note: 'Retire together with NEXT_PUBLIC_FLAG_PAYMENTS_AUTO after the 2026-11-07 review.',
  },
  NEXT_PUBLIC_FLAG_PAYMENTS_AUTO: {
    description:
      'E-transfer auto-detection (docs/plans/payments.md, Phase 1): the admin\'s Apps Script forwards Interac emails to POST /api/payments/etransfer, which marks matched rows paid and queues the rest; the "I\'ve sent it" button; and the soft hold (2+ unpaid settled sessions → sign-up lands on the waitlist). Read SERVER-side by every payments route and by the hold in POST /api/players; off, those routes 404 and sign-up is unchanged.',
    owner: 'grant',
    plannedRemoval: '2026-11-21',
    note: 'On in production since 2026-10-03 (Grant). Ship date + 2 weeks is not enough here: the kill criterion reads four weeks of matches (Review on 2026-11-07 in the plan). Retiring it deletes the 404 guards and the hold\'s off branch.',
  },
};

function readFlag(name: FlagName): string | undefined {
  switch (name) {
    case 'NEXT_PUBLIC_FLAG_DESIGN_PREVIEW':
      return process.env.NEXT_PUBLIC_FLAG_DESIGN_PREVIEW;
    case 'NEXT_PUBLIC_FLAG_GEAR_RECOMMENDER':
      return process.env.NEXT_PUBLIC_FLAG_GEAR_RECOMMENDER;
    case 'NEXT_PUBLIC_FLAG_STRINGING':
      return process.env.NEXT_PUBLIC_FLAG_STRINGING;
    case 'NEXT_PUBLIC_FLAG_NATIVE_MIGRATE':
      return process.env.NEXT_PUBLIC_FLAG_NATIVE_MIGRATE;
    case 'NEXT_PUBLIC_FLAG_MULTI_GROUP':
      return process.env.NEXT_PUBLIC_FLAG_MULTI_GROUP;
    case 'NEXT_PUBLIC_FLAG_RACKET_FIT':
      return process.env.NEXT_PUBLIC_FLAG_RACKET_FIT;
    case 'NEXT_PUBLIC_FLAG_PAYMENTS_AUTO':
      return process.env.NEXT_PUBLIC_FLAG_PAYMENTS_AUTO;
    case 'NEXT_PUBLIC_FLAG_STORE_CREDIT':
      return process.env.NEXT_PUBLIC_FLAG_STORE_CREDIT;
    case 'NEXT_PUBLIC_FLAG_LEDGER_MIRROR':
      return process.env.NEXT_PUBLIC_FLAG_LEDGER_MIRROR;
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
