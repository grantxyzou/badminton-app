# BPM — Ranked Roadmap & Idea Index

**Generated:** 2026-10-07 (scheduled review) · **Sources:** `ROADMAP.md`, `docs/plans/*`, `docs/superpowers/*`, all 38 open GitHub issues, 4 open PRs.
**This file is the ranked view; `ROADMAP.md` stays the locked strategy block + index; GitHub issues stay the live tracker.** Nothing here is a new idea — every row points at where it already lives, so nothing is tracked in two places. When an item ships, tick it in its GitHub issue and drop it here on the next review.

How the ranking works (highest first): (1) **blocks the store / multi-group launch**, (2) **overdue or date-bound** (plan review, flag retirement), (3) **protects money, data or sign-in**, (4) **cheap and unblocks other work**, (5) everything else by user value, (6) parked. The ROADMAP **Change Rule** still applies: an item that names no track is parked, not started.

---

## Roadmap (phases)

| Phase | Window | Goal | Exit signal |
|---|---|---|---|
| **A. Clear the decks** | now → ~10-15 | Answer overdue reviews, record the Slice-0 verdict, make CI deterministic, refresh stale docs | #519 dates moved, #400 closed, #540 fixed, ROADMAP current |
| **B. Store + multi-group launch** | now → ~11-15 | Decisions → TestFlight/App Review → Play 14-day closed test → flag on → leak-watch week | Apps in review; `MULTI_GROUP` on with a clean `[group-leak]` week |
| **C. Harden** | Oct → Nov | Sign-in/security findings, 503-vs-401, restore drill, E2E, real-DB settle test | #531 + #535 boxes ticked |
| **D. Money + engagement** | Nov | E-transfer 70% match read (11-07), reminders rollout, notifications phase 2, fit-test outcome | #523/#524 phase gates decided |
| **E. Polish + debt** | rolling | Flag retirements, design-system migration, code health, speed, motion | Flag backlog empty; warnings trending down |
| **F. Parked** | not scheduled | Reach (Value-Hub Track 4), SaaS, paid placement, etc. | Needs a fresh dated kill criterion first |

---

## Rank order

Ranks are global (1 = do first). `Issue` is the tracker; `Where it lives` is the doc of record.

### Tier 0 — Now (overdue, blocking, or costing deploys)

| # | Item | Issue | Where it lives |
|---|---|---|---|
| 1 | Make `HomeTab.membersOnly` "Set a PIN" test deterministic — it already cost one deploy | [#540](https://github.com/grantxyzou/badminton-app/issues/540) | `__tests__/components/HomeTab.membersOnly.test.tsx` |
| 2 | Answer the plan reviews now due/overdue (arctic handoff 10-01, multi-group 10-05, AI governance 10-07, native shell 10-07) and move each date | [#519](https://github.com/grantxyzou/badminton-app/issues/519) | `docs/plans/oauth-handoff-gaps.md`, `multi-group.md`, `ai-governance-and-docs-accuracy.md`, `native-shell.md` |
| 3 | Record the Slice-0 verdict (read `GET /api/admin/slice0`, no `?since`; exclude the App Review account) and close | [#400](https://github.com/grantxyzou/badminton-app/issues/400) | `docs/plans/value-hub-slice-0.md`, `lib/flags.ts` |
| 4 | Decisions that block multi-group: product name, what a no-club person sees, privacy/terms wording, removed-member 30-day cutoff, join-link confirm step | [#520](https://github.com/grantxyzou/badminton-app/issues/520) | `docs/plans/multi-group.md`, `docs/superpowers/plans/2026-09-07-multi-group.md` |
| 5 | Store submission path: TestFlight build 4 → App Review with demo account; start Google Play closed test (12 testers × 14 days = the long pole) | [#521](https://github.com/grantxyzou/badminton-app/issues/521) | `native/README.md`, `docs/plans/native-shell.md` |
| 6 | Refresh stale docs: ROADMAP (this PR starts it), 3 two-deployment docs, CLAUDE.md flag claims, CHANGELOG "Unreleased", DESIGN.md §14 | [#536](https://github.com/grantxyzou/badminton-app/issues/536) | `docs/deployment-model.md`, `docs/azure.md`, `docs/OWNER-KB.md` |

### Tier 1 — Next 2–4 weeks (launch, dated, safety)

| # | Item | Issue | Where it lives |
|---|---|---|---|
| 7 | Flag retirements by date: GEAR_SETUP 10-12, AUTH_PROVIDERS 10-15, MEMBERS_ONLY 10-17, GEAR_PAGES/FIT_VERDICT 10-19, RACKET_FIT 10-23 (delete the **off-branches**, not just the switch) | [#518](https://github.com/grantxyzou/badminton-app/issues/518) | `lib/flags.ts`, CLAUDE.md "Retirement rule" |
| 8 | Real-phone checks: launch screen on installed iPhone, first Google/Apple sign-up, `native/README.md` device checklist, store-review walk | [#522](https://github.com/grantxyzou/badminton-app/issues/522) | `docs/plans/launch-screen.md`, `native/README.md` |
| 9 | Multi-group cutover (Phase 5): flag on → week without `[group-leak]` → strict mode; extend two-club leak tests; browser walk | [#529](https://github.com/grantxyzou/badminton-app/issues/529) | `docs/superpowers/plans/2026-09-07-multi-group.md`, `docs/superpowers/specs/2026-09-07-multi-group-design.md` |
| 10 | Sign-in/security: F15, F16, 31 endpoints answer 401 where 503 is right, easy-PIN list, demo account out of slice-0, arctic replacement | [#531](https://github.com/grantxyzou/badminton-app/issues/531) | `docs/plans/oauth-library-replacement.md`, `docs/plans/ai-governance-and-docs-accuracy.md` |
| 11 | Racket-fit outcome (≥5 expert-rated cases; else drop questionnaire, 10-19) + fit test cases + catalog data gaps | [#527](https://github.com/grantxyzou/badminton-app/issues/527) | `docs/plans/racket-fit-engine.md`, `docs/catalog-check-2026-09-14.md`, `scripts/dump-fit-cases.mjs` |
| 12 | E-transfer detection read (70% auto-match over 28 days, 11-07); payment-reminder rollout; unpaid-hold decision | [#523](https://github.com/grantxyzou/badminton-app/issues/523), [#521](https://github.com/grantxyzou/badminton-app/issues/521) | `docs/plans/payments.md`, `public/payments/apps-script.gs` |
| 13 | Remaining plan reviews 10-12 → 11-07 (set-up card, members-only lockout, mobile feel, motion, skill funnel, shuttle burst, launch screen, loading cascade, arctic, restring) | [#519](https://github.com/grantxyzou/badminton-app/issues/519) | `docs/plans/*` (each carries its `Review on:` line) |
| 14 | Dependabot PRs: #546 (prod deps ×12), #502 (undici security), #491 (dev deps ×7); iOS `Package.resolved` #489 | PRs [#546](https://github.com/grantxyzou/badminton-app/pull/546), [#502](https://github.com/grantxyzou/badminton-app/pull/502), [#491](https://github.com/grantxyzou/badminton-app/pull/491), [#489](https://github.com/grantxyzou/badminton-app/pull/489) | `.github/dependabot.yml` |

### Tier 2 — Next quarter (value + hardening)

| # | Item | Issue | Where it lives |
|---|---|---|---|
| 15 | Ops safety net: Cosmos restore drill, Playwright E2E smoke suite, real-Cosmos settle test, prove the PR-review bot still posts | [#535](https://github.com/grantxyzou/badminton-app/issues/535) (= [#84](https://github.com/grantxyzou/badminton-app/issues/84), [#83](https://github.com/grantxyzou/badminton-app/issues/83), [#82](https://github.com/grantxyzou/badminton-app/issues/82)) | `REVIEW.md`, `scripts/summarize-review-run.mjs` |
| 16 | Notifications phase 2: sign-ups closing, payment reminders push, per-type opt-out, waitlist-promotion push | [#524](https://github.com/grantxyzou/badminton-app/issues/524) | `docs/plans/push-notifications.md` |
| 17 | Payments phase 2/4: ledger, credit, gift cards, Wallet pass | [#523](https://github.com/grantxyzou/badminton-app/issues/523) | `docs/plans/payments.md`, `docs/superpowers/specs/2026-05-13-v1.5-ledger-design.md` |
| 18 | Stats/skill unbuilt pieces: re-rate prompt, game results → memberId, cost-trend card, For-you section | [#528](https://github.com/grantxyzou/badminton-app/issues/528) | `docs/plans/skill-leads-stats.md`, `docs/plans/2026-06-13-skill-followups.md` |
| 19 | Admin: load-error pills for remaining cards, Issues view, sign-up-opened offset TODO | [#532](https://github.com/grantxyzou/badminton-app/issues/532) (= [#98](https://github.com/grantxyzou/badminton-app/issues/98)) | `docs/plans/offline-legible-fail.md`, `app/api/session/advance/route.ts:37` |
| 20 | Native rebuild list (needs a store build): launch flash, splash hold, keyboard resize, back gestures, "get the app" nudge | [#530](https://github.com/grantxyzou/badminton-app/issues/530) | `docs/plans/mobile-fluidity.md`, `docs/plans/native-shell.md` |
| 21 | Equipment: admin catalog editor; shoes/shuttles rows need sourced data only | [#527](https://github.com/grantxyzou/badminton-app/issues/527) | `components/stats/CLAUDE.md` |
| 22 | Monitoring decision: Sentry enable/remove | [#85](https://github.com/grantxyzou/badminton-app/issues/85) | CLAUDE.md "Deployment" |

### Tier 3 — Rolling polish and debt

| # | Item | Issue | Where it lives |
|---|---|---|---|
| 23 | Speed: 96 KB of messages per page, keyboard hints, bundle measurement, JS target | [#526](https://github.com/grantxyzou/badminton-app/issues/526) | `docs/plans/mobile-fluidity.md` |
| 24 | Loading & motion deferred items | [#525](https://github.com/grantxyzou/badminton-app/issues/525) | `docs/plans/loading-cascade.md`, `docs/plans/motion-pass.md` |
| 25 | Design system: 36 legacy buttons, ~146 hex colours, type-scale gaps, inline-style sweep, aurora differentiation | [#533](https://github.com/grantxyzou/badminton-app/issues/533) (= [#75](https://github.com/grantxyzou/badminton-app/issues/75), [#78](https://github.com/grantxyzou/badminton-app/issues/78)) | `docs/plans/design-audit-remediation.md`, `DESIGN.md` |
| 26 | Code health: split HomeTab, drop individual-receipt path, `IsoDate` type, merge sheet trackers, 3× club-settings read | [#534](https://github.com/grantxyzou/badminton-app/issues/534) (= [#70](https://github.com/grantxyzou/badminton-app/issues/70), [#73](https://github.com/grantxyzou/badminton-app/issues/73), [#67](https://github.com/grantxyzou/badminton-app/issues/67)) | `docs/audit/README.md` |
| 27 | Stage-2 orgId playbook — now largely superseded by the multi-group build; close or fold into #529 | [#81](https://github.com/grantxyzou/badminton-app/issues/81) | `docs/saas-productization-findings.md`, `docs/plans/multi-group.md` |

### Tier 4 — Parked (not scheduled, deliberately)

| Item | Issue | Where it lives |
|---|---|---|
| ~21 parked ideas: Reach/affiliate, paid placement, peer ratings, kudos→level, bilingual announcements, scheduled announcements, club-for-others (billing, marketing site), photo backgrounds, offline mode, demo club, assistant tooling… | [#537](https://github.com/grantxyzou/badminton-app/issues/537) | `docs/plans/value-hub-slice-0.md`, `docs/user-research-simulation.md`, `docs/saas-productization-findings.md` |
| Value-Hub Slice-0 and Tracks 1–4 — Tracks 1–3 shipped in practice (see `lib/flags.ts` note on VALUE_HUB_SLICE); only Track 4 (Reach) remains gated. **Suggest closing #101–#104 and keeping #105 as the only live gate** — owner call. | [#101](https://github.com/grantxyzou/badminton-app/issues/101), [#102](https://github.com/grantxyzou/badminton-app/issues/102), [#103](https://github.com/grantxyzou/badminton-app/issues/103), [#104](https://github.com/grantxyzou/badminton-app/issues/104), [#105](https://github.com/grantxyzou/badminton-app/issues/105) | `docs/plans/value-hub-slice-0.md`, `docs/superpowers/plans/2026-05-22-value-hub-slice-0.md` |

**Coverage check:** all 38 open issues (#540, #537–#518, #400, #105–#101, #98, #85, #84, #83, #82, #81, #78, #75, #73, #70, #67) appear above, directly or as the child of an umbrella issue. The umbrella issues #518–#537 were filed from the 2026-10-06 backlog snapshot (https://claude.ai/artifact/7oJobvyJSTew4jbuMCu415).

---

## Documentation map

| What | Link |
|---|---|
| Strategy, North Star, Change Rule | [`ROADMAP.md`](../ROADMAP.md) |
| What shipped | [`CHANGELOG.md`](../CHANGELOG.md) |
| Architecture, conventions, gotchas | [`CLAUDE.md`](../CLAUDE.md) (+ [`components/stats/CLAUDE.md`](../components/stats/CLAUDE.md)) |
| Product brief / voice | [`PRODUCT.md`](../PRODUCT.md), [`docs/voice-and-tone.md`](voice-and-tone.md), [`docs/i18n-zh-style.md`](i18n-zh-style.md) |
| Roles & permissions | [`docs/roles.md`](roles.md) |
| Review policy / contributing | [`REVIEW.md`](../REVIEW.md), [`CONTRIBUTING.md`](../CONTRIBUTING.md) |
| Owner handbook / Azure / deploy | [`docs/OWNER-KB.md`](OWNER-KB.md), [`docs/azure.md`](azure.md), [`docs/deployment-model.md`](deployment-model.md), [`docs/auth-provider-setup.md`](auth-provider-setup.md) *(first three flagged stale in #536)* |
| Research & strategy memos | [`docs/saas-productization-findings.md`](saas-productization-findings.md), [`docs/user-research-simulation.md`](user-research-simulation.md), [`docs/catalog-check-2026-09-14.md`](catalog-check-2026-09-14.md), [`docs/badminton-spec-md.md`](badminton-spec-md.md) |
| Audits | [`docs/audit/`](audit/README.md) |
| Interactive roadmap explorer | [`docs/roadmap-explorer.html`](roadmap-explorer.html) |
| Font subsetting | [`docs/subset-fonts.md`](subset-fonts.md) |

### Plans (`docs/plans/`, intent → in-flight → shipped)

[`multi-group`](plans/multi-group.md) · [`members-only`](plans/members-only.md) · [`one-time-invites`](plans/one-time-invites.md) · [`payments`](plans/payments.md) · [`push-notifications`](plans/push-notifications.md) · [`native-shell`](plans/native-shell.md) · [`mobile-fluidity`](plans/mobile-fluidity.md) · [`oauth-handoff-gaps`](plans/oauth-handoff-gaps.md) · [`oauth-library-replacement`](plans/oauth-library-replacement.md) · [`ai-governance-and-docs-accuracy`](plans/ai-governance-and-docs-accuracy.md) · [`value-hub-slice-0`](plans/value-hub-slice-0.md) · [`skill-leads-stats`](plans/skill-leads-stats.md) · [`2026-06-13-skill-followups`](plans/2026-06-13-skill-followups.md) · [`racket-fit-engine`](plans/racket-fit-engine.md) · [`equipment-setup-card`](plans/equipment-setup-card.md) · [`restring-reach`](plans/restring-reach.md) · [`stringing-admin-controls`](plans/stringing-admin-controls.md) · [`launch-screen`](plans/launch-screen.md) · [`loading-cascade`](plans/loading-cascade.md) · [`motion-pass`](plans/motion-pass.md) · [`signup-shuttle-burst`](plans/signup-shuttle-burst.md) · [`visual-fields-direction`](plans/visual-fields-direction.md) · [`design-audit-remediation`](plans/design-audit-remediation.md) · [`offline-legible-fail`](plans/offline-legible-fail.md)

Specs → [`docs/superpowers/specs/`](superpowers/specs) · Implementation plans → [`docs/superpowers/plans/`](superpowers/plans).

### Templates

| Template | Path |
|---|---|
| New plan (Track / Problem / Kill criterion / Non-goals / Review on) | [`docs/plans/TEMPLATE.md`](plans/TEMPLATE.md) |
| Bug issue form | [`.github/ISSUE_TEMPLATE/bug.yml`](../.github/ISSUE_TEMPLATE/bug.yml) |
| Feature issue form | [`.github/ISSUE_TEMPLATE/feature.yml`](../.github/ISSUE_TEMPLATE/feature.yml) · [`config.yml`](../.github/ISSUE_TEMPLATE/config.yml) |
| Dependabot config | [`.github/dependabot.yml`](../.github/dependabot.yml) |

### Design system (`docs/design-system/`; `app/globals.css` is the live source of truth)

[README](design-system/README.md) · [SKILL](design-system/SKILL.md) · [`colors_and_type.css`](design-system/colors_and_type.css) *(reference only — never import)* · [Figma MCP rules](design-system/figma-mcp-rules.md) · [`figma-tokens.json`](figma-tokens.json) · [`DESIGN.md`](../DESIGN.md) · UI kit [`ui_kits/bpm-app`](design-system/ui_kits/bpm-app) · 28 specimen pages in [`preview/`](design-system/preview) (colours 01–04, type 05–07/25, radii/shadows/spacing/motion 08–11, buttons 12–13/27, surfaces 14, banners/pills 15–16/28, inputs/segments/nav 17–19, loader/logo/aurora/icons/background 20–24, perf audit 26) · Mocks [`docs/mocks/`](mocks) · Playgrounds [`docs/playgrounds/`](playgrounds)

### System assets

| Asset | Path |
|---|---|
| Fonts (Space Grotesk, IBM Plex Sans, JetBrains Mono, Material Symbols subset) | [`app/fonts/`](../app/fonts), originals in [`docs/design-system/fonts/`](design-system/fonts) |
| Brand marks (logo, shuttlecock, baddicons, launch art) | [`public/brand/`](../public/brand) · [`docs/design-system/assets/`](design-system/assets) |
| App / PWA icons | [`public/icons/`](../public/icons) · `scripts/gen-icons.mjs` |
| Racket images (catalog) | [`public/rackets/`](../public/rackets) · `scripts/render-racket-images.mjs` |
| Native icons & splash | [`native/assets/`](../native/assets) · [`native/README.md`](../native/README.md) · `ios/`, `android/` |
| E-transfer Gmail script | [`public/payments/apps-script.gs`](../public/payments/apps-script.gs) |
| Service worker (push-only) | [`public/sw.js`](../public/sw.js) |
| Catalog data & import scripts | [`scripts/data/`](../scripts/data), `scripts/import-*.mjs`, `scripts/seed-equipment-catalog.mjs` |
| Automation hooks | [`scripts/`](../scripts) (`check-*.mjs`, `block-*.mjs`) · [`.claude/`](../.claude) (skills: bpm-status, deploy-promotion, run-badminton-app, verify-ui) |
| CI / deploy | [`.github/workflows/`](../.github/workflows) (`pr-ci`, `deploy-next`, `claude-code-review`, `claude`) |
| Production | https://bpm.grantzou.com/bpm |

---

## Review cadence

Re-run this review each session: re-rank against the issue list, move finished rows out, and make sure any new idea lands in an umbrella issue (#518–#537) rather than only in a doc. Two plans carry review dates that fell due today — see #519 and the SessionStart hook output.
