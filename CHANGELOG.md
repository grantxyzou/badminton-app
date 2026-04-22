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

## Unreleased — `bpm-next` only

*Items here live on `main` behind feature flags. They ship to stable when the next tag is cut.*

### Added

- Feature flag scaffold (`lib/flags.ts`)
- Preview banner for the `bpm-next` environment
