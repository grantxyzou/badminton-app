# Gotchas — the burns behind the rules

Moved out of `CLAUDE.md` → Gotchas on 2026-10-11, verbatim. Each entry here produced a one-line rule that stays in `CLAUDE.md`; this is the record of what it cost, kept because a rule with no story is one people argue with. Dates are 2026 unless stated. Some sentences describe code that has since moved on (the 2026-05 sign-in flow, for one) — they are history, not current behaviour.


## Auth — the adaptive Home sign-up form (the members-only OFF path)

- **Sign up** = register for the active session via HomeTab. **With `NEXT_PUBLIC_FLAG_MEMBERS_ONLY` on, everything in this bullet is the flag-OFF path**: the server takes the name from the signed-in account and refuses anyone without one (security rule 13). The sign-up card is an **adaptive form** driven by `useMemberProbe(name)` from `lib/useHasPin.ts` (debounced GET `/api/members/me?name=X`):
  - `anon` mode (probe returned null OR member doesn't exist): name input only → POST `/api/players` `{name}`.
  - `sign-in` mode (member with PIN): name + PIN input + "Forgot your PIN?" link → two-step submit (POST `/recover` to verify PIN, then POST `/api/players` to register for session). Sign-in here AUTO-REGISTERS for the active session because the button label "I'm in this week" makes the intent unambiguous. (Differs from Profile sign-in, which does not auto-register.)
  - `create` mode (member exists, no PIN yet, **and this device holds their `member_session`**): name + Create PIN + Confirm PIN → POST `/api/players` `{name, pin}` (member gets PIN AND session signup in one call). **A no-PIN member on a device WITHOUT their session gets `anon` mode instead** (2026-09-13 flow audit): `create` used to show there too, and the server refuses a first PIN without a session (`account_claim_needs_approval`), so the name-only sign-up regulars rely on failed on every new phone.
  Submit handler in `components/HomeTab.tsx` `handleSignUp` branches by mode.

## Rules and what they cost

- **Auth cross-call assumption** (lesson from commit `fa7544a`, 2026-05-14): when a client stitches two server calls into one user-visible action, the server has no way to know they're related. The v1.4 unified Home sign-in flow called `/api/players/recover` then `/api/players` and assumed the first verified the user for the second — but /recover doesn't grant any auth cookie, so the second was anonymous and 401'd. **Rule**: every server-mutating call must carry its own credential (admin cookie OR explicit body.pin verified against `member.pinHash`). Don't trust "the previous call just succeeded." Regression test at `__tests__/players-signup-with-pin.test.ts`.
- **A per-task review scoped to its own diff cannot see cross-file breakage.**
Twice in one branch a change invalidated assertions living in files the task
never touched (a catalog count, then lint errors), and both got through a
clean task review. Run the FULL `npm test` **and** `npm run lint` between
tasks, not only at the end — the repo baseline is 0 lint errors, so a
regression there is unambiguous.
- **Backticks inside a double-quoted `git commit -m` are command
substitution.** `` `seeded: true` `` was executed by the shell and replaced
with empty output, silently deleting the phrase it was explaining. Same
family as the heredoc `!` hazard. Use `git commit -F -` with a **quoted**
heredoc (`<<'MSG'`) — the quotes stop all expansion.
- **Catalog seeding REFRESHES, it does not only fill.** `ensureCatalogSeeded`
originally upserted only ids that were ABSENT — right for a catalog that
grows, wrong for one whose rows change SHAPE. When the v2 import added
normalized attributes to 39 rows that already existed in Cosmos, the JSON
file gained them and the database never did: `isScorable` then silently
skipped **50 of 71 rackets in production** while every local test passed,
because in dev the JSON file IS the catalog. It now refreshes a row when it
is missing OR its seed-owned fields differ, guarded two ways — only rows
marked `seeded: true` are touched (a deploy must never revert an
admin-authored row), and the comparison **sorts keys** (Cosmos doesn't
guarantee key order, and a plain `JSON.stringify` would call every row stale
and rewrite the whole catalog on every cold start). Any future data whose
shape changes needs the same treatment.
- **A cache that reads before it checks saves nothing.** `lib/levelStore.ts`'s group-calibration memo scanned the group's whole `gameResults` and all of `assessments` on every call to compute a change signature and only THEN consulted its 30 s cache — the cache saved the fold's CPU and none of the reads that were the cost. Since 2026-09-28 the TTL is checked first, and the two writers (`POST /api/games`, `POST /api/assessments`) call `invalidateGroupCalibration` so a new game shows on the next load. The same day `lib/sharedRead.ts` gained `sharedFetch` (one request per path while IN FLIGHT, each caller its own `Response` clone, no freshness tail because these callers refetch after a write) for the Home and admin-landing duplicates, and `/api/players/unpaid` went player-first (`lib/owedRows.ts`) instead of reading every session and every player row on every Home mount.
- **A rule added to a shared function is worthless if a caller reimplemented it.** `app/api/session/advance/route.ts` kept its OWN inline copy of the three settings-drift comparisons instead of calling `detectSettingsDrift` — and that is the path that stamps `anomaliesAtAdvance`. So a `deadline_changed` check added to `lib/anomalies.ts` would not have reached the code that actually runs at advance time. The 2026-09-03 session closed sign-ups a day early with only `max_players_changed` recorded against it for exactly this reason. Same family as the ten copy-pasted member resolvers `lib/memberResolve.ts` exists to prevent: when told "we already check that", check WHERE.
- **A recorded value nobody compares is not a check.** `PrevSessionSnapshot.deadlineOffsetHours` had been written at every advance and displayed by `SetupPage` since it was introduced, and nothing ever compared it — so a deadline that moved a full day was invisible while `maxPlayers` going 11→12 raised a warning. `detectSettingsDrift` now flags `deadline_changed` past a 6-hour tolerance; the tolerance is not zero because a session crossing a DST boundary moves its wall-clock offset by exactly an hour through nobody's decision, and a warning that fires twice a year for something nobody did is one people learn to dismiss unread.

## Automation hooks — the bug class behind each

- **Automation hooks** (`.claude/settings.json` + `scripts/`): SEVEN now, each tied to a bug class this repo actually hit.
- `check-flag-sync.mjs` (PostToolUse) — a flag in `lib/flags.ts` missing from `deploy-next.yml` is silently off forever, because `NEXT_PUBLIC_*` is baked at build time. Cost us `NEXT_PUBLIC_FLAG_SETTLE` for two weeks (that flag has since retired; the lesson has not).
- `check-i18n-keys.mjs` (PostToolUse **and a CI step** since 2026-09-06) — resolves every `t('...')` against the namespace its `useTranslations()` declared, in both locales. **next-intl does NOT throw on a missing key** — it renders the key path via `getMessageFallback`, and `i18n/request.ts` deep-merges English under every locale, so a missing `zh-CN` key falls back rather than failing. This file and the script both claimed it throws; the real symptom is `profile.settings.privacyPolicy` printed on screen where a label should be, which nothing fails on and everyone scrolls past. Three blocks landed under the wrong parent on 2026-08-27 and stayed green all three times. `__tests__/i18n/canary-strings.test.tsx` checks a hand-maintained list of ~12 keys and is structurally incapable of catching a new one. **The genuine i18n CRASH risk is `t.raw()` + `.map()`** — `t.raw` returns `undefined` on a miss and the cast hides it; go through `rawList()` in `lib/rawList.ts`. Runs in 50ms.
- `check-lint-errors.mjs` (PostToolUse) — ERRORS only on the edited file; the 371-warning baseline would be noise. Catches what tests and tsc cannot, e.g. deleting a component stranding the imports it was the last consumer of.
- `check-schema-additive.mjs` (PostToolUse) — warns (never blocks) when a field leaves `lib/types.ts`. A rollback runs older code against the same live DB.
- `block-tab-screenshot.mjs` (PreToolUse on Bash) — refuses a headless screenshot of a `?tab=` URL or one using `--virtual-time-budget`. Both produce a real, plausible image of the WRONG screen; documenting the trap did not stop it recurring.
- `block-secret-commit.mjs` (PreToolUse on Bash) — on any `git commit`, refuses if the STAGED diff carries a credential shape (Cosmos `AccountKey=`, `sk-ant-`, GitHub tokens, a PEM header, a `SESSION_SECRET`/`VAPID_PRIVATE_KEY`/`*_CONNECTION_STRING` assignment) or stages an env file / `*.bak` / `*.orig`. The `.env.local.bak` leak was the one recorded burn without a hook; `*.bak` in `.gitignore` fixed one spelling of it. Deliberately narrow — no entropy scan, because a gate that flares on `package-lock.json` gets muted.
- `check-plan-reviews.mjs` (SessionStart) — reports plan docs past a `**Review on:** YYYY-MM-DD` header. The flag-retirement mechanism generalised: `docs/plans/value-hub-slice-0.md` carried an honest kill criterion and went unread for ~9 weeks, by which time three of the four tracks it gated had shipped anyway. A criterion with no scheduled read is a note, not a gate. A plan with NO review line is fine — most are finished records — so the field stays meaningful rather than ceremonial. Reports, never blocks.
- `.claude/hooks/session-start.sh` (SessionStart) runs `check-flag-sync.mjs` once, so overdue flags and workflow drift are in front of you before the first edit; silent when there is nothing to say. It used to announce "soaking on bpm-next" and the `bpm confirm` list — both concepts were retired in Aug 2026 and the hook kept announcing them for weeks. Per-project settings still use gitignored `.claude/<name>.local.md` files; templates in `docs/automation/`.
- **The eight `scripts/` checks are tested** in `__tests__/hooks/scripts.test.ts`, each against a throwaway fixture tree (a temp git repo for the schema check, a temp project for i18n and flag-sync, a real-but-deleted fixture file for lint). They are the policy layer, and a regression there is silent by construction — a hook that stops firing looks exactly like a clean edit.

## Clauses trimmed from live bullets

- **PIN is opt-in.** `ForcePinModal` was removed in commit 2026-05-07 (was already unmounted; deleted with no consumers).
- — Profile sign-in does NOT auto-register for a session (commit 6046755, 2026-05-07).
- HomeTab's old "Already a player?" link + standalone RecoverySheet card (#89) were removed 2026-05-12 in favor of the adaptive form above.
- ; was 8h pre-v1.3, bumped to match `badminton_identity` localStorage longevity.
- — find the live list with `grep -rl '<BottomSheet' components app`, don't trust a written one: this sentence used to name eleven and had missed twenty, then said ~31 with 48 in the tree.
- (this bullet used to say `app/page.tsx`, which stopped being true when the client boundary moved)
- This bullet previously claimed "Home / Skills / Admin keep the 3-blob aurora", which was wrong for two of the three.
- — and by 2026-09-28 a fourth HAD grown, in `CommandCenter.openReceipt`, and only settle honoured a resplit cover
- A first cut of `purgeMember` used `@v` throughout, so every query matched the whole container and the purge deleted both kudos rows instead of the one received — type-clean, and it would have passed a less specific test.
