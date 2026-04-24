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

*Items here live on `main`. They ship to stable when the next tag is cut. Will promote as `bpm-stable-v1.1` — see PR #22 for the full commit.*

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
