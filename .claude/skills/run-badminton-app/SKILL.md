---
name: run-badminton-app
description: Run, launch, start, build, test, or screenshot the BPM Badminton app — boot the dev server offline (mock store, no Cosmos), drive a real sign-up flow, and capture a screenshot. Use when asked to run the app, see a change in the browser, smoke-test, or verify the UI locally.
---

# Run BPM Badminton

Next.js 16 (Turbopack) mobile-first web app served under the **`/bpm`** basePath.
It runs fully **offline** against an in-memory mock store when `COSMOS_CONNECTION_STRING`
is unset — no database, no prod data. The driver is
[`smoke.sh`](smoke.sh): it boots the server, proves mock mode, drives a real
API sign-up, and screenshots Home. `curl` is the reliable way to drive/observe
the data layer; headless Chrome captures the UI.

All paths below are relative to the repo root (`<unit>/`). Verified on macOS,
Node 20.19, Chrome 14x headless.

## Prerequisites

- **Node 20+** and npm (`node -v` → v20.19.6 here).
- A Chromium-family browser for screenshots — already present on macOS at
  `/Applications/Google Chrome.app/...`; on Linux install one:
  `sudo apt-get install -y chromium-browser` (the driver auto-detects it).

## Setup

```bash
npm install
```

No `.env.local` is needed for the offline path — the driver passes the required
env inline, and **omitting `COSMOS_CONNECTION_STRING` selects the mock store.**
(For a persistent config you can also `cp .env.local.example .env.local`; it now
includes `NEXT_PUBLIC_BASE_PATH=/bpm` — see Gotchas for why that var matters.)

## Run (agent path) — the driver

```bash
bash .claude/skills/run-badminton-app/smoke.sh
```

Boots the dev server on `:3100` in mock mode, then asserts, in order:
`mock store confirmed` → `POST /api/players -> 201` → `roster contains Viktor`
→ writes `/tmp/bpm-shots/home.png`. Prints `SMOKE OK` and stops the server.

- `PORT=3200 bash …/smoke.sh` — use another port (3000 is often taken).
- `KEEP=1 bash …/smoke.sh` — leave the server running for further poking; it
  prints the pid + URL to kill later.
- `OUT=/some/dir bash …/smoke.sh` — change where the screenshot lands.

## Run (just launch, for interactive work)

The driver wraps this exact command — run it directly to keep the server up.
**The `NEXT_PUBLIC_BASE_PATH=/bpm` prefix is mandatory** (see Gotchas):

```bash
NEXT_PUBLIC_BASE_PATH=/bpm COSMOS_CONNECTION_STRING= \
SEED_DEV_SCENARIO=fresh-thursday SEED_DEV_ADMIN=Grant:1130 \
  npm run dev -- --port 3100
```

App at **http://localhost:3100/bpm**. The seed creates a signup-open session
(Fri Jun 5, 11820 Horseshoe Way), 6 invite-list members (Lin has PIN 2468),
a racket catalog, and skill snapshots — all in memory.

⚠️ **This command sets NO feature flags**, so flag-gated UI (Command Center,
Ledger, Nav Rail, Settle, Value Hub, the Skill-assessment spine, Kudos, Insight
Cards) is **dark** — the app looks "behind" bpm-next even though the code is
identical. To match bpm-next, use the next-mode launch below instead.

## Run as bpm-next (all flags on)

bpm-next builds with `NEXT_PUBLIC_ENV=next` and all 13 `NEXT_PUBLIC_FLAG_*` on.
Two npm scripts replicate that locally (flag list kept in sync with
`.github/workflows/deploy-next.yml`):

```bash
PORT=3100 npm run dev:next:mock   # ★ all vnext features + OFFLINE mock store + seed (safe)
PORT=3100 npm run dev:next        # all vnext features against the REAL DB in .env.local (mutates prod!)
```

- **`dev:next:mock`** is the one you almost always want: it prepends
  `COSMOS_CONNECTION_STRING=` (forces the mock store — wins over `.env.local`
  because Next doesn't override already-set `process.env`) + the `fresh-thursday`
  seed, then reuses `dev:next`. Fake data, every feature visible, zero prod risk.
- **`dev:next`** inherits `.env.local`'s real Cosmos connection — only use it
  when you deliberately want to see/edit live data.
- Flags read from `process.env` at runtime in `next dev`, so these take effect
  immediately (no rebuild). Keep the `dev:next` flag list aligned with
  `deploy-next.yml` when flags are added/retired — nothing auto-checks it.

## Drive it with curl (data layer — reliable)

```bash
B=http://localhost:3100/bpm
curl -s "$B/api/session"                              # active session JSON
curl -s -X POST "$B/api/players" \
  -H 'Content-Type: application/json' -H 'X-Client-IP: me' \
  -d '{"name":"Viktor"}'                              # sign up (201)
curl -s "$B/api/players"                              # roster — Viktor present
```

`X-Client-IP` gives each caller a distinct rate-limit bucket. Most routes live
under `/bpm/api/*`; deep-link UI tabs with `?tab=players|stats|admin` and `?dev`.

## Screenshot a tab (headless Chrome)

```bash
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
"$CHROME" --headless=new --disable-gpu --hide-scrollbars \
  --window-size=440,900 --virtual-time-budget=10000 \
  --screenshot=/tmp/bpm-shots/home.png "http://localhost:3100/bpm"
```

Reliable for Home and layout/styling. For **data-heavy tabs** (Sign-Ups, Stats)
headless `--virtual-time-budget` intermittently cuts off fetches and shows the
offline banner — verify that data with `curl`, or use a real-browser driver
(Playwright / the playwright MCP, which waits for network-idle) for a clean shot.

## Test

```bash
npm test          # vitest — 752 tests, mock store, no DB
```

## Gotchas

- **`NEXT_PUBLIC_BASE_PATH=/bpm` is mandatory and easy to miss.** `next.config.js`
  sets `basePath: '/bpm'` (server side) but does **not** export the env var, and
  `.env.local.example` omits it. Without it the client bundle fetches `/api/*`
  with no prefix → 404 → the whole app shows **"You're offline / Couldn't load"**
  even though the server is fine. This is the #1 way the app looks broken when it
  isn't. The dev log shows the tell: `GET /api/players 404` (no `/bpm`).
- **Mock vs prod is decided by one env var.** `if (process.env.COSMOS_CONNECTION_STRING)`
  → real Cosmos; else mock + dev seeds. The seed functions early-return under real
  Cosmos, so the log line `… Mock store only.` is your **proof** you're offline and
  safe. The driver hard-fails if it doesn't see it.
- **Headless Chrome ≠ real browser for fetches.** `--virtual-time-budget` advances
  the clock past `load` but can terminate in-flight fetches, cascading through the
  app's `reportFetchFailure` into a false offline state. curl is the source of truth
  for data; Playwright/real browsers render data tabs cleanly.
- **Port 3000 is often already bound** by another dev server — pass `--port`/`PORT=`.
- The app is **mobile-first**; screenshot at `~440×900` or it looks stretched.

## Troubleshooting

| Symptom | Fix |
|---|---|
| Every tab shows "You're offline / Couldn't load" | `NEXT_PUBLIC_BASE_PATH=/bpm` not set. Add the prefix to the launch command. |
| Driver prints `FAIL: not in mock mode` | A `COSMOS_CONNECTION_STRING` is set (shell or `.env.local`). Unset it / move `.env.local` aside to force the mock store. |
| `npm run dev` exits immediately / `EADDRINUSE` | Port taken. `PORT=3200 bash …/smoke.sh` or `--port 3200`. |
| `next build` fails fetching Google Fonts | Needs network at build time (self-hosted fonts still ping Google in build). Not a code error. |
