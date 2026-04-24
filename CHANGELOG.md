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

### Added

- **BPM design-system preview route** at `/bpm/design` — flag-gated behind `NEXT_PUBLIC_FLAG_DESIGN_PREVIEW` (off on stable, on for `bpm-next` + dev). Sub-pages: `/tokens`, `/components`, `/logo` (3 candidates × 4 contexts; user's chat pick C+D marked), `/fonts` (locked Space Grotesk + JetBrains Mono spec), `/backgrounds` (6 directions), `/perf` (re-tiered audit). Not linked from `BottomNav`.
- **Design-system bundle v2** under `docs/design-system/` — `README.md`, `BUNDLE.md`, `SKILL.md`, `colors_and_type.css`, `aurora-bg.css`, `26-perf-audit.html`. Brand SVGs under `public/brand/`.

### Changed — phone-heating fixes

- **Live background replaced with the tempo-field dot grid** (`app/globals.css`, `.court-bg`). Extends the new wordmark's tempo-dot motif across the full viewport as a single static `radial-gradient` pattern with a center-focused edge-fade mask. **Zero animation, zero `backdrop-filter`, zero `will-change`** — the compositor stamps the pattern once and caches it forever. Replaces the fast-compositor aurora (which itself replaced the original `filter: blur()` + `mix-blend-mode` aurora). Light mode uses a darker, lower-opacity green so the dots register without dominating the cream page. `prefers-reduced-transparency` drops the pattern entirely for iOS Low Power Mode.
- The three `.aurora-blob-*` elements in `app/layout.tsx` are now `display: none` — kept in the DOM so a future background variant can revive them without touching the layout.
- **Reduced-motion pauses GPU animations** (`app/globals.css`): `.aurora-blob-*`, `.wave-bar`, `.shimmer-line`, `.splash-shuttle`, `.splash` get `animation: none` + `will-change: auto`. Previously the blanket rule only collapsed durations, keeping compositor layers alive.
- **GlassPhysics skips touch devices** (`components/GlassPhysics.tsx`) — short-circuits when `(hover: none)` matches.
- **DatePicker scroll is RAF-coalesced** (`components/DatePicker.tsx`) — `getBoundingClientRect()` runs once per frame.
- **Splash failsafe** (`app/globals.css`) — CSS keyframe fades splash at ~5s if hydration stalls silently.

### Decisions

- **Type system locked and adopted live (bundle v3 — three roles)**:
  - **Space Grotesk** — display / headlines (self-hosted variable TTF, weight 300–700). Drives `.bpm-h1 / h2 / h3`, the HomeTab page header, splash title, and `<BpmWordmark />`. New negative letter-spacing tuned per size (-0.02em / -0.015em / -0.01em).
  - **IBM Plex Sans** — body / UI (self-hosted variable TTF with width 85–100% × weight 100–700 + genuine italic variant). `var(--font-sans)` now leads with IBM Plex, so every `<body>` surface — HomeTab cards, PlayersTab list, AdminTab forms — picks it up automatically.
  - **JetBrains Mono** — data moments (PINs, costs, timestamps, build SHA). Loaded from Google Fonts.
  Self-hosted fonts live at `app/fonts/*.ttf` and load via `next/font/local` so first paint never blocks on the Google Fonts CDN and the app works on restricted networks. New `--font-display` CSS token added. `/design/fonts` reflects the three-role lock.
- **"bpm." wordmark adopted** in the HomeTab page header and the splash: the chat-picked "C+D merge" — four tempo dots crescendoing into the period — rendered from the new `<BpmWordmark />` component. Tempo dots inherit `var(--accent)` so they auto-tint for light/dark themes.

### Changed — icon webfont + render perf

- **Material Icons → Material Symbols Rounded (subsetted)** (`app/layout.tsx`, `app/globals.css`). Payload drops from ~100 KB (full Material Icons) to ~15–20 KB (35-glyph subset via the `icon_names` query param). Call-site API unchanged — the `.material-icons` class stays as the 57-usage idiom but the class definition now points at Material Symbols Rounded with the rounded-weight-balanced axis settings (`'opsz' 24, 'wght' 400, 'FILL' 0, 'GRAD' 0`). Matches the design-spec rule "Rounded only — never mix weights."
- **Memoization pass** on the HomeTab subtree: `CostCard`, `PrevPaymentReminder`, `WelcomeCard`, `ReleaseNotesTrigger`, and `BpmWordmark` wrapped with `React.memo`; `dismissOnboarding` and `openReleaseSheet` handlers converted to `useCallback` in `HomeTab` so the memoized children no longer re-render on every name-input keystroke. `SkillsRadar` chart data wrapped in `useMemo` so recharts' `<RadarChart>` bails on parent ticks that don't change scores.

### Tests

- `__tests__/design-preview-route.test.ts` — flag registration, default-off, strict `"true"` match, six-entry subpage list, "Type system" label, `BottomNav` isolation.
