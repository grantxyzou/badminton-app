# Offline Posture — Legible-Fail

## Context

The app is ~100% server-dependent (sign-ups, players, payments, admin all
need live data). There is no "offline mode" feature to build. The problem,
discovered reactively while fixing the admin gate, is that every
network-touching interaction breaks offline in its own mechanically
distinct way — four found so far:

1. Admin gate probe rejects → bounced to Home *(fixed: `fix/offline-admin-gate`)*
2. Card data fetch rejects → uncaught throw / crash *(BirdsPage fixed; boundary nets render-throws; ~16 cards deferred)*
3. Lazy admin chunk can't download → ChunkLoadError *(fixed: boundary detects + auto-reload on reconnect)*
4. `router.refresh()` for locale → RSC fetch dies → site breaks *(NOT fixed — the symptom that prompted this)*

Decision made: **Legible-fail.** Goal is not offline *function* — it's
offline *legibility*: the user always knows "I'm offline, that's why,"
never a white screen, broken site, or silent lie. One shared signal, one
consistent treatment, NOT per-component bespoke handling, NOT a PWA.

## Approach

A single connectivity source of truth, consumed in three ways: a
persistent banner, disabled network-mutating controls, and reads that show
last-known data behind the banner. The existing `AdminErrorBoundary` stays
as the crash safety net.

### 1. The primitive — `lib/useOnline.ts` + `OnlineProvider`

- Context provider mounted once at the app shell (`HomeShell`).
- Source: `navigator.onLine` initial value + `online` / `offline` window
  events.
- **Heartbeat (minimal):** `navigator.onLine` can lie (says online behind a
  captive portal / when the server is unreachable). Disambiguate *only when
  needed*: when any app `fetch` rejects, flip context to offline
  immediately and start a low-frequency reachability ping (HEAD
  `${BASE}/api/session`, ~15s) that clears offline on first success. No
  constant polling when things are healthy — battery/request-noise
  conscious. (Open question A below.)
- Exposes `useOnline(): boolean` and a `reportFetchFailure()` helper for
  fetch wrappers to nudge the signal.

### 2. Persistent banner (consolidate, don't duplicate)

- `HomeShell` currently has an ad-hoc `offline` state driven by the
  admin-gate probe (`fix/offline-admin-gate`). Replace that with
  `useOnline()` so the banner is app-wide and not coupled to admin
  probing. Same `<StatusBanner tone="warn">`, same placement.
- Net change: delete the local `offline`/`setOffline` wiring in
  `refreshAdminAccess`; keep "preserve last-known showAdmin on probe
  failure" (that logic is still correct and independent).

### 3. Network-mutating entry points — disable, don't execute-then-break

Gate these on `useOnline()` → disabled control + inline
"You're offline — reconnect to do this" (friend-voice, not "Error 503"):

- **`LanguageToggle`** — offline: render disabled, `aria-disabled`, title
  "Language switches when you're back online." Skip the `router.refresh()`
  entirely (the thing that breaks). (Cookie-write-now-refresh-later is
  rejected — adds hidden state; legible-fail favors honest disable.)
- **Sign-up submit** (`HomeTab` `handleSignUp`) — disable submit + inline
  note. Highest-traffic mutation.
- **Admin mutations** (Command Center save/PATCH/POST actions) — disable
  primary action buttons offline. Reads still render via boundary /
  per-card catch.
- **Self-cancel** (`PlayersTab.handleCancel`) — same treatment.

Scope discipline: wire the *high-traffic* mutations now (locale, sign-up,
admin save, self-cancel). Exhaustive coverage of every minor action is
explicitly NOT required — the boundary + banner make even an unhandled one
non-catastrophic.

### 4. Reads

Largely already correct once components don't crash (boundary + the
BirdsPage-style `catch`). The thorough per-card `loadError` pass for the
remaining ~16 Command Center cards is **explicitly deferred** (tracked
backlog, not this plan).

## Files

- **New:** `lib/useOnline.ts` (context + hook + provider + reachability ping)
- `components/HomeShell.tsx` — mount `OnlineProvider`; banner sourced from
  `useOnline()`; remove ad-hoc `offline` state
- `components/LanguageToggle.tsx` — disable offline, skip `router.refresh`
- `components/HomeTab.tsx` — `handleSignUp` submit gated on `useOnline()`
- `components/PlayersTab.tsx` — self-cancel gated
- Command Center primary mutation buttons — gated (enumerate during build)
- Reuse: `components/primitives/StatusBanner.tsx`, friend-voice copy

## Open questions (decide before/at build)

- **A. Heartbeat:** ship the minimal on-failure ping described above, or
  start with pure `navigator.onLine` + event listeners and add the ping
  only if the lying-online case actually bites? (Lean: minimal ping — the
  captive-portal lie is exactly the kind of "broken site" we're killing.)
- **B. Branch/PR shape:** land `fix/offline-admin-gate` as its own PR
  first (small, mostly verified), then this as a separate
  `feat/offline-legible-fail` off main that refactors the banner to the
  shared signal? Or fold both into one larger PR? (Lean: separate —
  admin-offline is independently shippable and verifiable.)

## Verification

- `useOnline` unit test: simulate `offline`/`online` events + a fetch
  failure → assert state transitions and ping-clear behavior.
- Manual, DevTools offline, against `SEED_DEV_SCENARIO=fresh-thursday`:
  - Banner appears on every tab when offline, clears on reconnect.
  - LanguageToggle disabled offline, no site break; re-enables online.
  - Sign-up / admin-save / self-cancel show disabled + inline note offline,
    work normally online.
  - Admin still doesn't bounce; boundary still nets a forced card crash.
- `npx tsc --noEmit` clean on non-test code; full `npm test` no regression.

## Out of scope (named, deferred)

- Per-card `loadError` pills for the ~16 remaining Command Center cards.
- PWA / service worker (real offline data) — milestone-sized, fights the
  dual-deploy chunk-hash model.
- Exhaustive gating of every minor network action.
