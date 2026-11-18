# REVIEW.md — what a review of this repo is accountable for

Read by the Claude Code Review workflow (`.github/workflows/claude-code-review.yml`) on every PR, and by anyone reviewing by hand. It is a policy, not a second copy of the rules — `CLAUDE.md` is the source; this file says which rules a reviewer must check and how to rank what it finds.

## Rank findings by what they cost in production

Every merge to `main` deploys. There is no staging, no soak, no second deployment. So:

1. **Blocks merge** — data loss, a Security Rule broken, a lying UI state, a schema change that would break rollback.
2. **Fix before merge** — a convention that has a canary (say why the canary didn't catch it), a hook bypassed, a test that cannot fail.
3. **Note** — everything else. One real finding beats ten nits; do not pad.

## Always check

**Security Rules** (`CLAUDE.md` § Security Rules — all twelve). The ones PRs actually break:
- `deleteToken` or `pinHash` in ANY response body. Every new route that returns a player or member strips both — `pinHash: _ph` is the pattern to search for.
- Order in a handler: rate-limit → auth → body parsing → DB. A **mutating** admin route uses `await isAdminAuthedWithMember(req)`; the sync `isAdminAuthed` on a write is a finding.
- A name-keyed write that changes one member's data must be bound to that member's `member_session` cookie or admin (rule 12). Name-only is impersonation — names are enumerable.
- `timingSafeEqual` for every secret comparison; `randomBytes` for every id.

**Money** (`.claude/rules/money.md`; Grant, 2026-11-18: "guard the money code"). `__tests__/money-guard-canary.test.ts` catches the shapes; a reviewer catches the meaning:
- A write to `Player.paid` / `paidAmount` / `owedAmount` or `StringingJob.paidAt` goes through `scope.replace` and decides again on `undefined`. An `upsert` there overwrites a payment that landed in between.
- Nothing pays a line without a person looking unless the line is SETTLED, the amount matches exactly, and exactly one person is the candidate. "Close enough" is a review row, never a payment.
- An un-pay voids through the mirror; nothing edits or deletes a ledger entry, and every new ledger id is derived from what it records.
- What a member sees owed comes from `computeOwed` / `classifyOwed`, never a second calculation.
- No amount in a push body.
- A redelivered or resent Stripe event must change nothing it already did, days later too: Stripe's idempotency keys last 24 hours.

**Security invariants from the 2026-11-17 scan** (`.claude/rules/security.md`; 32 findings, every HIGH in sign-in, money or admin powers). Flag a PR that:
- Uses `verifyLiveAccountAuth` / `readLiveAccountSession` for a route that acts INSIDE a club. That check lets someone in no club through; the member check (`verifyLiveMemberAuth`, `requireGroupMember`) is the default.
- Keys a write, a gate or a history read on a NAME (a cookie's `name`, a roster name) where a `memberId` exists. Names are self-chosen and released on rename.
- Lets an admin set, clear or reset another member's PIN, or let them in, without `onBehalfRefusal`. Or signs the admin's phone in as that member.
- Compares a PIN before `claimPinAttempt` counts it, or answers a name nobody holds faster or differently than a real one (`FAKE_HASH`, `padMissingAccount`).
- Treats the email confirmation link as proof of the mailbox (`mailboxProven` is set only by a sign-in through the address).
- Auto-pays money on a name anyone can set (a roster name or the memo) instead of a remembered alias.
- Gives a deployment-wide power to "an admin of BPM" instead of `isOperator`.
- Indexes a plain `{}` with member-supplied text (`__proto__`).
`__tests__/security-invariants.test.ts` catches the shapes it can read; say so when a finding is one it cannot.

**Lying empty states.** `catch { setX([]) }` renders "no data yet" for "the backend is broken". Every fetch consumer must distinguish load-failed (`ErrorState`) from loaded-empty (`EmptyState`). Same family: a probe that failed or is pending rendered as a confirmed negative — tri-state it.

**Session pointer and partition keys.** `getActiveSessionId()` always; a bare `SESSION_ID` or `'current-session'` is a finding. `container.item(id, partitionKeyValue)` — the second argument is the PK **value**; the mock store ignores it, so a wrong one only fails in production.

**Schema is additive-and-optional only.** A removed or renamed field in `lib/types.ts` breaks the build a rollback lands on. The hook only warns; the reviewer decides whether the removal was deliberate.

**Flags.** A new flag is registered in `lib/flags.ts` with a real `plannedRemoval` date AND present in **both** `deploy-next.yml` and `pr-ci.yml`. Read through `isFlagOn`, never `process.env` directly.

**Tests that cannot fail.** A mock that copies the code's own assumption tests nothing — the game logger read `d?.players` from an endpoint that returns a bare array, and its test mocked the same wrong shape, so nobody could log a game and the suite stayed green. For any new test of a server contract ask: what real response would make this red?

**i18n.** A new `t('key')` must resolve in the namespace its `useTranslations()` declared, in both locales — next-intl throws on a miss, so this is a crashed screen. `scripts/check-i18n-keys.mjs` is the authority; if the PR adds a new top-level namespace, the author needed a dev-server restart to have seen it work.

**Visible changes were looked at.** jsdom applies no stylesheet, so a green suite is not evidence for layout. A PR that changes anything visible should say how it was verified — `verify-ui`, a phone, a screenshot that is NOT a `?tab=` headless capture (those reliably show Home).

## Do not flag

- The ESLint **warning** count. The baseline is ~357 warnings / 0 errors and the warning count drifts by design; only a new **error** is a regression.
- Inline styles using `var(--token)` — that is the sanctioned form, including the `var(--accent, #22c55e)` fallback.
- Commit message style, file organisation, "consider extracting" — unless it hides one of the findings above.
- Anything `CLAUDE.md` records as a deliberate trade (push-only service worker with no `fetch` handler, no offline PWA, `remainingByPurchase` being misleading under pooled usage, the dormant stats preview-name, …). Read the relevant section before calling it a bug.
