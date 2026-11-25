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
  | 'NEXT_PUBLIC_FLAG_STRINGING'
  | 'NEXT_PUBLIC_FLAG_NATIVE_MIGRATE'
  | 'NEXT_PUBLIC_FLAG_MULTI_GROUP'
  | 'NEXT_PUBLIC_FLAG_LEDGER_MIRROR'
  | 'NEXT_PUBLIC_FLAG_CARD_PAY'
  | 'NEXT_PUBLIC_FLAG_STRINGING_INVOICE'
  | 'NEXT_PUBLIC_FLAG_VOICE_SCORE';

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
      'Several clubs in the one deployment (docs/plans/multi-group.md) — the explicit Stage-2 choice, made 2026-09-07 so strangers who install the store app have somewhere to go. Read SERVER-SIDE: off, every request resolves to groupId "bpm" and nothing observable changes; on, the cookie claim plus a membership check decide. ON in production since 2026-10-22 (Phase 5), after the migrate-groups status read all zeros and mismatched 0; off is the whole rollback, since nothing is migrated that older code cannot read.',
    owner: 'grant',
    plannedRemoval: '2026-12-15',
    note: 'About two weeks after the intended Phase 5 cutover. Retiring it means deleting the "resolve to bpm" branch AND flipping TOLERATE_UNSTAMPED off in lib/groupScope.ts (only after a second club has run one session end to end and the migrate-groups status shows zero unstamped rows and zero recorded leaks), not just removing the switch.',
  },
  NEXT_PUBLIC_FLAG_STRINGING: {
    description:
      'The stringing service (design "Stringing", Aug 2026). Stage 1 is the BENCH only: the stringingJobs container plus the admin-side job list, job detail and intake form. Gates the /api/stringing/* routes server-side as well as the UI, because the price a stringer charges is admin-only data and a client flag cannot protect it. The player side landed too: the Home card, the request sheet, and the admin-controlled shop sign. It is behind this flag TRANSITIVELY rather than directly -- StringingCard never calls isFlagOn; it reads GET /api/stringing/shop, which 404s when the flag is off, which the card treats as UNKNOWN and renders as the "Coming soon" state. That indirection is load-bearing: tidying up the 404 handling in that card would silently un-gate the feature. Turning this off hides the bench and 404s the routes; no player-visible surface changes either way.',
    owner: 'grant',
    plannedRemoval: '2026-12-15',
    note: 'Kept past its 2026-11-15 date (Grant, 2026-11-16): it is the one app-wide kill switch for stringing, which takes money. Each club already turns stringing on or off itself (`run.stringing`, docs/plans/stringing-add-on.md), so retiring this loses only the switch for every club at once. Ask again on the new date.',
  },
  NEXT_PUBLIC_FLAG_LEDGER_MIRROR: {
    description:
      'Phase 2 of docs/plans/payments.md, stage 1: every charge and payment ALSO writes an append-only `ledger` entry beside the fields the app reads (Player.paid, owedAmount, StringingJob.paidAt stay the truth). Read SERVER-side by lib/ledgerMirror.ts; off, the mirror is a no-op and the backfill route 404s. Nothing visible changes either way.',
    owner: 'grant',
    plannedRemoval: '2026-12-05',
    note: 'Retire once the reconcile (stage 2) has run clean for four weeks and stage 4 (ledger as truth) is planned — the off branch is only the no-op.',
  },
  NEXT_PUBLIC_FLAG_CARD_PAY: {
    description:
      'Card payments (docs/plans/card-pay-prototype.md; docs/plans/payments.md Phase 3; ROADMAP non-goal lifted 2026-11-12). An organiser connects the club\'s own Stripe account (Connect, Accounts v2, direct charges), and a member pays their SETTLED session lines by card through Stripe Checkout; a signed webhook marks the rows paid (paidVia "card") and un-pays them when a refund made in Stripe says which. Read SERVER-side by /api/admin/card-pay and /api/payments/card/*, which 404 while it is off, and inert without STRIPE_SECRET_KEY. Turned on once the live key and webhook secret are in Azure App Settings.',
    owner: 'grant',
    plannedRemoval: '2026-12-17',
    note: 'Ship + 2 weeks, assuming live by about 2026-12-03 — move it if going live slips. Retiring it deletes the flag check only: the STRIPE_SECRET_KEY check stays, because removing the key is the fast off switch (no rebuild).',
  },
  NEXT_PUBLIC_FLAG_STRINGING_INVOICE: {
    description:
      'Send an invoice for a restring (docs/plans/stringing-invoice.md). On, a job made from then on is stamped billOn "invoice" and becomes money owed only when its stringer or an organiser sends the invoice (push without the amount, email with it, or a shared picture), with one reminder to the player at day 3 and one to the sender at day 7. Read SERVER-side at job creation; jobs made while it is off bill at Ready as before, and an invoiced job keeps its invoice if it goes off.',
    owner: 'grant',
    plannedRemoval: '2026-12-31',
    note: 'Ship + 2 weeks once on in production. Retiring it deletes the creation-time check only: billOn on a job is the record, not the flag.',
  },
  NEXT_PUBLIC_FLAG_VOICE_SCORE: {
    description:
      'Voice scoring on the courtside board, a proof of concept (docs/plans/voice-score.md): a Preview mic on Keep score that listens for the umpire\'s call ("eleven seven") and scores a rally only when the call is exactly one rally on from the board. Client-only: the browser\'s own recogniser, nothing stored or sent to our server. Hidden where the browser has no recogniser, and always in the store app. ON in production since 2026-11-13 (Grant), before legal.privacy says the browser sends the audio to its speech service: that sentence is still owed.',
    owner: 'grant',
    plannedRemoval: '2026-12-11',
    note: 'The plan\'s Review-on date. Keep it (retire the flag, delete the off branch) or kill it (delete the mic, lib/useVoiceScore.ts, lib/voiceScore.ts and put Permissions-Policy back to microphone=()).',
  },
};

function readFlag(name: FlagName): string | undefined {
  switch (name) {
    case 'NEXT_PUBLIC_FLAG_DESIGN_PREVIEW':
      return process.env.NEXT_PUBLIC_FLAG_DESIGN_PREVIEW;
    case 'NEXT_PUBLIC_FLAG_STRINGING':
      return process.env.NEXT_PUBLIC_FLAG_STRINGING;
    case 'NEXT_PUBLIC_FLAG_NATIVE_MIGRATE':
      return process.env.NEXT_PUBLIC_FLAG_NATIVE_MIGRATE;
    case 'NEXT_PUBLIC_FLAG_MULTI_GROUP':
      return process.env.NEXT_PUBLIC_FLAG_MULTI_GROUP;
    case 'NEXT_PUBLIC_FLAG_LEDGER_MIRROR':
      return process.env.NEXT_PUBLIC_FLAG_LEDGER_MIRROR;
    case 'NEXT_PUBLIC_FLAG_CARD_PAY':
      return process.env.NEXT_PUBLIC_FLAG_CARD_PAY;
    case 'NEXT_PUBLIC_FLAG_STRINGING_INVOICE':
      return process.env.NEXT_PUBLIC_FLAG_STRINGING_INVOICE;
    case 'NEXT_PUBLIC_FLAG_VOICE_SCORE':
      return process.env.NEXT_PUBLIC_FLAG_VOICE_SCORE;
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
