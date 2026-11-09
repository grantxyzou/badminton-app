---
paths:
  - "components/stats/**"
  - "components/SkillsTab.tsx"
  - "app/api/stats/**"
  - "lib/useActiveName.ts"
  - "lib/clubBands.ts"
  - "lib/useInsight.ts"
  - "lib/insightSignals.ts"
  - "lib/statsPrivacy.ts"
  - "lib/useStatsPrivacy.ts"
  - "__tests__/stats-*.test.ts"
  - "__tests__/active-name-canary.test.ts"
  - "__tests__/components/Stats*.test.tsx"
---

# Stats tab

<!-- Moved word for word from the root CLAUDE.md on 2026-11-09 (step 2 of the trim), to keep the always-loaded file short. -->

Bottom-nav "Stats" (formerly "Skills"; `nav.skills` i18n key kept for backcompat). One layout for everyone — there is no admin variant. `SkillsTab` resolves an active name, renders `StatsSignedOut` when there isn't one, and otherwise hands four slots to `StatsV2Shell`, in the order **You · Equipment · Play · Learn** (Equipment second since 2026-10-19, Grant's call on the Stats canvas): **You** (AI greeting, `SkillTrendCard` + `DimensionBars`, `WhereYouSitCard`, kudos received), **Play** (`YourRecordCard`, `WhoYouPlayWithCard`, give-kudos), **Learn** (`LearnRegister` — weekly focus + two drills), **Gear** (`GearRegister` — the "Set-up" card with Racket and Strings lines (its flag `NEXT_PUBLIC_FLAG_GEAR_SETUP` retired 2026-10-14 with the older pick rail plus "Your kit" off-branch), whose "Your fit" and "About this racket" open full pages with a Claude-worded verdict (flags `NEXT_PUBLIC_FLAG_GEAR_PAGES` and `NEXT_PUBLIC_FLAG_FIT_VERDICT` retired 2026-10-19, ON branches kept; "Your fit" carries the one "Clear my fit answers" the privacy policy promises); `NEXT_PUBLIC_FLAG_VALUE_HUB_SLICE`, which once gated the whole register and six API routes, retired 2026-09-28 with its twelve off-branches; see `components/stats/CLAUDE.md` for the single-owner `useGear` rule the register is built around). `OverviewStrip` sits above the register switch and stays put across all four.

- **Nothing counts sessions you missed.** Stage 8 (2026-08-20) deleted the v1 arrangement outright: `StatsPlaceholder`, `StreakSummaryCard`, `AttendanceCardLive`, `AttendanceSessionStrip`, `GameStatTiles`, `LevelCard`, `DrillsCard`, `GameLoggerCard`/`Sheet`, the admin `SkillsRadar` and `RadarSkeleton` — plus the `recharts` dependency they were the only consumer of. This is a product decision, not deferred work. **`GET /api/stats/attendance` still exists and is legitimate**, but nothing on Stats renders it, and `/api/stats/insight` is no longer given attendance counts or streaks at all (see its `Snapshot` comment) so the AI copy cannot reintroduce the guilt through the greeting. **A background insight request costs nothing for someone who does not read it** (2026-11-05): Home's pre-warm and the Stats tab preloading off screen send `warm=1`, and the route writes a new read only for someone with a `stats_open` in the last 30 days, answering 204 otherwise so `useInsight` asks again once Stats is on screen; an EMPTY read is cached (`InsightDoc.empty`) instead of re-asking the model on every open.
- **Active-name chain** — real identity (`badminton_identity`) → `badminton_stats_preview_name` → signed-out state. **`lib/useActiveName.ts` is the single owner**; every consumer calls `useActiveName()` and `__tests__/active-name-canary.test.ts` fails the build if the chain is re-derived anywhere else (it had been copy-pasted into five modules, four of which had stopped subscribing to identity changes). **The preview-name step is DORMANT: nothing in the app writes that key** — the picker that did left in Stage 8, so today the chain is effectively identity → signed-out. The mechanism and its tests are kept for the day admin-browses-someone-else's-stats returns; don't document it as a live path, and don't assume a preview name can occur. If it ever returns, the key stays separate from `badminton_identity` and is NEVER written into it — that would mint a fake `deleteToken` and break self-cancel.
- **"Your skills" is you against yourself; "Where you sit" is you against the club** (Stats canvas, 2026-10-20). No club figure appears in `SkillTrendCard` or `DimensionBars`: the median and the club's middle half per side (`dimensionSpread`, additive in `lib/clubBands.ts`) are drawn only in `WhereYouSitCard`'s By side panel, and only once the comparison is revealed — a dot against the club IS a comparison. The phase names are plain club words (Beginner → Competitive); the stored `Phase` keys did not change. A card switches the Stats register through `useOpenStatsRegister()` (`components/stats/statsTakeover.ts`), as Work on next does to reach Learn.
- **Club comparison is consent-gated.** `useStatsPrivacy` + `ClubConsentSheet` ask once on first run, and closing the sheet (✕, Escape, swipe, back) saves "Keep it private", so it never returns and the choice lives in Profile → Stats & privacy (Grant, 2026-11-02: it blocked the tab bar); `isComparisonRevealed()` requires BOTH a stored `clubComparison` preference AND a non-null `promptedAt` — the stored preference alone is not consent. Both comparison-dependent cards are keyed on the answer so saying yes remounts them and they re-read the bands endpoint without a reload.
