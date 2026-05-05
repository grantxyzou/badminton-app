# Changelog

All notable changes to the BPM Badminton app are tracked here.

This changelog tracks what ships to the **stable** friend-facing deployment. The `bpm-next` preview environment auto-deploys `main` and may contain in-progress work gated behind feature flags; those changes only appear below once promoted to stable via tag.

Format loosely follows [Keep a Changelog](https://keepachangelog.com/). Tag convention: `bpm-stable-vX.Y`.

---

## v1.0 — Pre-SaaS baseline (2026-04-18)

First tagged baseline of the stable production site, before the SaaS transformation begins.

### Highlights

- **Sign-ups** — invite-list gating, autocomplete, waitlist with admin-promote, soft delete + restore, self-cancel via `deleteToken`
- **Admin** — PIN-gated cookie auth, session editor, date-keyed session advance, paid/unpaid + e-transfer alias mapping, CSV export, session-scoped announcements with AI polish
- **Identity** — persistent `members` container, role-based admin visibility, consolidated `badminton_identity` localStorage
- **UI** — mobile-first 4-tab layout, light/dark theme, cold-start splash, `CostCard`, `PrevPaymentReminder`, `WelcomeCard`, release notes sheet, `BottomSheet` primitive, 30px page headers, 16px min body
- **Skills** — ACE Skills Matrix (7×6), `SkillsRadar` (recharts, solo/overlay), admin-only CRUD
- **i18n** — `next-intl` cookie-based zh-CN sweep (BottomNav, HomeTab, PlayersTab) + date/time localization via `useFormatter`
- **Cost** — multi-source bird usage with 0.5-tube increments, `null` cost-per-court, legacy `birdUsage` read-tolerance
- **Infra** — Azure App Service B1 at `/bpm` via GitHub Actions OIDC, Cosmos DB (7 containers), in-memory mock store for offline dev, security headers, rate limiting, 236 tests

---

## v1.0.1 — Timezone hotfix + two-deployment pipeline (2026-04-22)

Shipped as a hotfix via the new `deploy-stable.yml` manual-dispatch workflow. First end-to-end exercise of the tag-based promotion runbook documented in `docs/deployment-model.md`.

### Fixed

- **Session times rendered in UTC instead of Vancouver time** — the HomeTab WHEN card showed e.g. "Friday, April 24 · 03:00 AM" for a session stored as Apr 23 8:00 PM PDT. `next-intl`'s `useFormatter` defaults to UTC when no `timeZone` is set. Now configured to `America/Vancouver` on both server (`i18n/request.ts`) and client (`NextIntlClientProvider`). All player-facing datetime surfaces (HomeTab, PlayersTab, PrevPaymentReminder) corrected. (#19)

### Added (infrastructure, invisible to stable users)

- Two-deployment pipeline: `bpm-next` auto-deploys every push to `main`, `bpm-stable` deploys only on manual tag dispatch. Shared Cosmos DB, split workflows. (#13, #14, #15)
- Feature flag system with typed registry and `isFlagOn` helper. (#13)
- Preview banner (orange strip on `bpm-next` only, hidden on stable) showing git SHA and a mailto bug-report link pre-filled with URL + SHA + user agent. (#13, #16, #18)
- Deployment model runbook at `docs/deployment-model.md` with promotion + hotfix + rollback procedures. (#17)

### Notes

All infrastructure items above are behavioral no-ops on stable (PreviewBanner returns `null` when `NEXT_PUBLIC_ENV` is unset; CSS `--banner-offset` var defaults to 0). The only user-visible change for the friend group is the timezone fix.

---

## Unreleased — `bpm-next` only

*Items here live on `main`. They ship to stable when the next tag is cut.*

---

## v1.3 — Stats redesign + design system tier-2 + UI primitives (2026-05-05)

Shipped as `bpm-stable-v1.3`. Stats tab visual overhaul (Tempo Field dot-grid background + refractive glass cards), three new UI primitives sweeping ~25 duplicated bits across the app, the design system's two-tier surface model formalized, dark-mode AA contrast lift, and a 7-tap demo placeholder.

### Added — Stats tab visual overhaul

- **Tempo Field background** on the Stats tab — a 42px dot grid extending the BPM logo's tempo-dot motif, with a soft radial vignette mask so dots fade at the edges. Static (no animation), brand-green dots on dark theme, darker forest dots on cream. Dots-grid replaces the global aurora on Stats only; other tabs keep aurora / court / etc.
- **Refractive glass cards** on Stats — cards now bend the dot field beneath them rather than sitting as tinted overlays. Four independent levers: dispersion (blur radius), fray (chromatic aberration), frost (milkiness), depth (multi-layer box-shadow stack). Cards visibly float above the backdrop instead of laying flat.
- **Contextual identity callouts** — Stats tab adapts its copy and live cards based on whether you're identified, anonymous, or admin-browsing.

### Added — Stats Attendance card UX

- **Anonymous attendance card is now passive copy** — "Sign in or create an account to see personalized stats" replaces the previous Sign up / Sign in CTAs. The Stats tab is now a *consequence* of being signed in, not a gate to it.

### Added — Demo mode placeholder

- **7-tap title gesture opens a Demo overlay** — full-screen placeholder with X close button (also dismissible via Escape). Slot for a future guided product tour.

### Added — UI primitives

- **`<PageHeader>`** primitive — replaces 8 duplicated 30px `<h1>` headers across the app. Consistent typography, optional right-aligned action slot.
- **`<StatusBanner>`** primitive — replaces 7 duplicated success / warning / error banners with a single typed component.
- **`<ConfirmInline>`** primitive — replaces ad-hoc "are you sure?" inline UI in PlayersTab; foundation for the rest of the app.
- **`--ease-sheet` motion token** added (`cubic-bezier(0.16, 1, 0.3, 1)`) and wired through `<BottomSheet>` so all sheets share one slide-up curve. Token was in the design-system doc since v3 but only landed in `globals.css` now.

### Changed — design system: two-tier surface model

- **Surface adoption split**: `docs/design-system/preview/` is the frozen reference bundle (never imported), and `app/design/` is the live drift-proof preview. The runtime `app/globals.css` is the single source of truth for tokens. Documented as a hard rule to prevent the kind of cascade collisions that happened pre-v1.2.
- **Aurora docs synced** to current production values. The two visualizations now match.

### Changed — dark-mode contrast

- **AA contrast lift** on dark theme — text-secondary bumped from `0.6` → `0.7` and text-muted from `0.35` → `0.55` so glass-card content passes WCAG AA on the brightest aurora regions. Light mode untouched (already well-contrasted on cream).
- **Aurora reshape**: blob proportions and spread reworked to reduce the green-on-tan color-mix overlap in the upper-third of the viewport. Vertical wash + horizontal curtain + accent layout per `docs/design-system/preview/02-aurora.html`.

### Changed — Admin tab

- **Admin tab background** is now flat `var(--page-bg)` with the aurora hidden — admin reads as its own visual register without atmospheric chrome competing for attention.

### Fixed — deployment

- **Standalone bundle copies `public/`** — Next.js 16 standalone output drops the public directory by default; deploy workflows now `cp -r public/` into the bundle so brand assets, fonts, and changelog JSON ship to Azure correctly.
- **Brand asset loading** — missing or 404'd brand assets now load reliably across both deployments.
- **Canonical URL** sourced from `NEXT_PUBLIC_BASE_URL` env var (per-deployment) so Open Graph / canonical tags are correct on both bpm-next and bpm-stable.

### Fixed — admin

- **Release form Draft button** — repaired (was no-oping). Added inline explainer for the publish vs. draft distinction.

---

## v1.2 — UX polish: Stats tab + markdown announcements + bird inventory (2026-04-26)

Shipped as `bpm-stable-v1.2`. Bundles content-side polish (markdown announcements, editable release notes), the new Stats tab skeleton (Skills renamed and re-laid-out), and admin bird-inventory upgrades. Live attendance + design-stats preview are also in the cut but flag-gated and dark on stable.

### Added — announcements

- **Minimal markdown in announcements** — admins can now use `**bold**`, `*italic*`, `- list`, and `1. numbered` in the announcement textarea. Home tab renders formatted output via the tiny `lib/miniMarkdown.tsx` parser (JSX-only, no raw-HTML injection). Composer has Write / Preview tabs and 5 formatting buttons (B, I, UL, OL, paragraph break). Character cap raised 500 → 800 to account for markdown overhead.

### Added — release workflow

- **Released notes are editable** — pencil icon on each row in Admin → Releases opens the form pre-filled for that record; `PATCH /api/releases` preserves `publishedAt` / `env` / `publishedBy` and stamps `editedAt`. AI polish stays opt-in on edit (no surprise rewrites of already-shipped copy). Delete icon replaces the old text link.

### Added — Stats tab (Skills → Stats)

- **Bottom nav "Skills" renamed to "Stats"** (`bar_chart` icon; zh-CN: 数据). Existing SkillsRadar content stays available to admins via the bottom-most "Skill progression" live card.
- **Live Attendance card** gated behind `NEXT_PUBLIC_FLAG_STATS_ATTENDANCE`. Shows a GitHub-style heatmap (7 rows × N weeks) with 3M / 6M / 1Y zoom pills. Solid green = session attended, outlined = missed, empty = no session that day. Month labels along the top, Mon/Wed/Fri on the side.
- **Attendance streak hero** above the cards. Hidden when streak is zero. Personal-best flame gradient when `streak >= longestStreak && streak >= 3`, otherwise green tint with "Keep showing up."
- **Identity fallback** — when no `badminton_identity` exists (admin browsing, incognito, first-time visitor), the card shows a "View attendance for:" autocomplete input backed by the members list. Picked name saves to `badminton_stats_preview_name` (separate from real identity so it doesn't muddy self-cancel semantics).
- **Layout rework** — live content (attendance) full-width up top; remaining "Coming soon" cards collapse into a compact 2-column grid at the bottom under a "More coming" label. Admin's live Skill Progression card lands below the grid as its own full-width section.
- **API:** `GET /api/stats/attendance?name=X&weeks=N` — no auth (stats are player-facing). Case-insensitive name match. Excludes waitlisted + removed player rows. Returns `{ attended, streak, longestStreak, history[] }`. Weeks clamped to [1, 260].

### Added — `/design/stats` preview

- **Stats narrative playground** — new 7th sub-page on the `/design` preview route. Three narrative arcs: **Your season so far** (per-person, 7 cards), **The club pulse** (per-group / admin, 6 cards), **Anatomy of Thursday** (per-session recap, 5 cards). All cards mocked with fabricated data + inline SVG viz. Ends with a proposed ship-order section. Flag-gated like the rest of `/design/*`.

### Added — bird inventory

- **Hero card** on Admin → Birds: giant remaining-tubes number, runway weeks (`remaining / avgTubesPerSession`), avg/session, total used, brand count. Color tiers: red at 0, amber below 2 weeks, green at 3+.
- **Per-brand grouping** via `lib/birdBrand.ts::parseBirdName` (first whitespace-delimited token = brand, remainder = model). No schema migration — `BirdPurchase.name` stays a single string.
- **Assign-to-session flow** — `+` button on each purchase row opens `AssignUsageSheet` (BottomSheet primitive). Lists most-recent 10 sessions with current tubes-used for that purchase; admin can set 0.5-tube increments per session; Save batches `PATCH /api/session/bird-usage` calls. Hero runway recalculates on save.
- **API:** `PATCH /api/session/bird-usage` — admin-only. Upserts one purchase's usage into any session's `birdUsages` array (by `sessionId`). Unlike `PUT /api/session` which replaces the whole active-session doc, this targets archived sessions too. `tubes: 0` removes the entry.
- **New helpers in `lib/birdUsages.ts`**: `tubesUsedAcross(sessions)`, `avgTubesPerSession(sessions, window=8)`, `runwayWeeks(remaining, avg)`.

### Added — bug reporting

- **Preview banner bug link** now opens a picker menu (Bug / Feature idea / Private email) instead of the old mailto. Bug and Feature paths deep-link to GitHub Issues with URL + SHA + UA pre-filled via `?template=&url=&sha=&ua=` query string.
- **GitHub issue templates** in `.github/ISSUE_TEMPLATE/`: `bug.yml`, `feature.yml`, `config.yml` (blank issues disabled, private-email contact link). Fully usable once the repo flips to public.

### Infra

- `NEXT_PUBLIC_FLAG_STATS_ATTENDANCE` registered in `lib/flags.ts` (first Arc 1 live card; retires two weeks after full Arc 1 promotion).
- Material Symbols Rounded subset URL gains 17 new glyphs: `bar_chart`, `bolt`, `emoji_events`, `event`, `format_list_bulleted`, `format_list_numbered`, `groups`, `local_fire_department`, `paid`, `payments`, `radio_button_unchecked`, `receipt_long`, `star`, `subdirectory_arrow_left`, `trending_up`, `verified`, `visibility`. (~43 → ~60 glyphs; URL bundle still ~20 KB.)
- i18n: new `stats.{heading,subhead,comingSoon,progression,attendance,cost,partners}.*` keys in both `en.json` and `zh-CN.json`; `nav.skills` value updated ("Coming Soon" → "Stats" / "即将推出" → "数据").

### Fixed

- **`stats.cost.subtitle` rendered with a stray `$`** in the compact "Coming soon" Cost card on the Stats tab. Rewrote the i18n string to drop the `$` glyph (the placeholder cost surface is purely illustrative and the literal currency symbol read as a typo). (#27)

### Tests

- 316 passing, up from 251. New suites: `miniMarkdown`, `announcements`, `releases` PATCH, `birdBrand`, `birdUsages.helpers`, `session-bird-usage`, `stats-attendance`, `StatsPlaceholder`.

---

## v1.1 — Design system v3 + release automation (2026-04-24)

Shipped as `bpm-stable-v1.1`. First promotion to bundle live-surface visual changes (type trio, icons, backgrounds) alongside infra (release automation, env-stamped releases).

### Added — release workflow automation

- **Release form auto-fills from CHANGELOG.md** — `scripts/extract-unreleased.mjs` runs as a `prebuild` hook, parses the `## Unreleased` section, writes `public/changelog-unreleased.json`. The admin Release Form fetches that JSON on mount and pre-fills version (next minor bump from the highest existing tag) + raw notes (verbatim Unreleased bullets). Admin no longer types the raw notes — just reviews, runs AI polish, publishes. A "↻ from CHANGELOG" button next to the raw-notes field re-pulls if needed.
- **Per-environment releases** — `app/api/releases/route.ts` now stamps `env: 'next' | 'stable' | 'dev'` on every record at POST time via `getEnv()`. GET filters by the current env (with legacy-null backcompat, so existing v1.0/v1.0.1 entries stay visible on both). Releases published on `bpm-next` no longer leak to `bpm-stable` through the shared Cosmos DB.

### Added

- **Design system v3 bundle** mirrored at `docs/design-system/` — 43 files (tokens, 28 specimen HTMLs, UI-kit JSX references, 3 self-hosted variable fonts). Single canonical reference.
- **Hidden preview route** at `/bpm/design` — 7 sub-pages (tokens, components, logo, fonts, backgrounds, perf, index). Flag-gated behind `NEXT_PUBLIC_FLAG_DESIGN_PREVIEW` (404 on stable, visible on `bpm-next` + dev). Not linked from `BottomNav`.
- **`<BpmWordmark />`** tempo-dot logo component (displayed on `/design/logo` preview).
- **`<ShuttleIcon />`** brand shuttlecock SVG — replaces `sports_tennis` in empty states.

### Changed — visible on live surfaces

- **Type trio adopted live** — Space Grotesk (display / headlines), IBM Plex Sans (body / UI, leads `var(--font-sans)`), JetBrains Mono (data: PINs, costs, timestamps, code). Self-hosted variable TTFs in `app/fonts/` via `next/font/local`; system fonts remain as metric-matched fallbacks so first paint never waits on the network.
- **Icons** — Material Icons → Material Symbols Rounded, subsetted to ~43 glyphs via `icon_names=` query param (~100 KB → ~20 KB). `.material-icons` class aliased so 57 call-sites stay unchanged.
- **Backgrounds** — `02 Aurora` (3-blob slate-blue + court-green + warm-yellow, fast-compositor path) on Home/Skills/Admin; `03 Court` (real badminton-doubles proportions at 100:220 viewBox, aspect-locked via `aspect-ratio` + `background-size: contain`) on Sign-Ups only. Wired via `html[data-tab=...]` attribute from an `activeTab` `useEffect` in `app/page.tsx`.
- **Canonical component alignment** — Status banners radius 12, padding 12×14, new `.status-banner-red`; pills 11px/600/0.04em/line-height 1 bare-class shape; glass-card radius 24→**16** (was violating corner-radii ladder) + saturate 140→**180%**; BottomNav inline-flex pill (not full-width stretch), 20px icons, FILL-axis active glyph, 9.5px labels.

### Perf

- GlassPhysics short-circuits on `(hover:none)` touch devices.
- DatePicker scroll handler RAF-coalesced (one `getBoundingClientRect` per frame, not per scroll event).
- Splash 5.4s CSS-keyframe failsafe + `<HydrationMark />` moved to **root layout** (was only on `/`, leaving non-index routes stuck on the splash).
- `React.memo` on `CostCard`, `PrevPaymentReminder`, `WelcomeCard`, `ReleaseNotesTrigger`, `BpmWordmark`; `useCallback` for HomeTab handlers; `useMemo` for SkillsRadar chartData.
- `prefers-reduced-transparency` kill-switch on aurora animation (iOS Low Power Mode).

### A11y

- All 38 form fields across `/design/components`, SkillsTab, and admin surfaces now have `id` + `name` + `autoComplete` (silences Chrome DevTools "no id/name" warning).
- Touch targets bumped to **44×44 minimum** on DatePicker month chevrons, AdminDashboard logout, AdminDashboard person_remove.
- Light-mode legibility audit — theme-adaptive `--sev-*-text` tokens; pill waitlist/admin/red now have light-mode overrides; `--pill-unpaid-text` alpha 35→72% for AA contrast. **Removed `docs/design-system/colors_and_type.css` import from the design layout** — it was shadowing `globals.css`'s `[data-theme="light"]` overrides via cascade source-order.

### Infra

- `NEXT_PUBLIC_FLAG_DESIGN_PREVIEW` registered in `lib/flags.ts`.
- Tests: 251 passing (added 5 for the preview-route flag + nav isolation).
