# Launch screen

**Track:** native shell / store launch — the first screen a store download shows
**Status:** in-flight
**Review on:** 2026-10-24 — did any member say opening the app feels slower since the launch screen? If so, shorten `WELCOME_AT_MS` for signed-in members

## Problem

The cold-start splash was a generic ring spinner over "BPM Badminton / Weekly
sessions", followed by a separate signed-out Welcome that shared nothing with it.
Grant commissioned a design handoff (`design_handoff_launch_screen/`, outside the
repo): the app icon's shot trajectory IS the loader, and it resolves into the
Welcome lockup without a swap. No member has complained about the old splash;
this is a brand and first-impression change ahead of the store listing.

## Kill criterion

Members notice the launch for its slowness rather than its look. Measured
locally on a warm reload, a signed-in member reaches Home at ~3.4s, against
~0.15s with the old splash: the handoff waits for the shot in flight to land
(up to 2s), then plays a 1.4s final shot. If that cost shows up in feedback, the
signed-in path is the one to cut first.

## Non-goals

- The rejected `stacked` lockup variant from the handoff.
- Sound or a landing haptic (the handoff floats the haptic; not built).
- The DS red error banner for a failed load: the splash has no fetch of its own
  to fail. The server has already decided the page before the splash sees it.

## Decisions

- **The session signal is the server-rendered DOM, not a client store.**
  `app/page.tsx` already decides signed-in vs signed-out on the server. The
  splash reads `[data-signed-out-welcome]` (SignedOutShell's Welcome) or
  `[data-launch-app]` (HomeShell) at hydration, then again at the shot boundary,
  because `?join=`, `?reset=` and `?native=1` leave Welcome right after
  hydration. Neither marker (`/legal`, `/design`, `/migrate`) means leave at
  once. A store that the shells announced into would have been a second
  opinion about "signed in", and its effect would run after the splash's.
- **One motion model, two runtimes.** Before hydration no JS runs, so the
  loading shot loops as CSS keyframes, sampled at 50 stops from
  `lib/launchMotion.ts`. After hydration, JS drives the resolve shot from the
  same module. The stops replace CSS `linear()`, which needs Safari 17.2.
- **Welcome draws the same `LaunchArt`** at the same geometry. The splash then
  hands over at `WELCOME_HANDOFF_MS` (1.7s, once the lockup has fully landed),
  not at W (1.4s), so it crossfades into an identical picture. Button delays
  are recomputed so they still land at W+450 and W+600.
- **Scaled with a pre-paint inline script, not CSS.** A unitless scale from
  viewport units needs typed `calc()` division, which Safari lacks. The same
  script sets `data-theme` before first paint. Light-mode members used to see
  the whole dark splash, then a flash to cream.
- **Authed timing follows the handoff, behind one constant** (`WELCOME_AT_MS`).
  See the kill criterion.

## Shape

| Piece | File |
|---|---|
| Motion model, keyframe generator | `lib/launchMotion.ts` |
| Lockup artwork (splash + Welcome) | `components/launch/LaunchArt.tsx` |
| Splash controller | `components/launch/LaunchScreen.tsx` |
| Mount, pre-paint script, keyframes | `app/layout.tsx` |
| Geometry, colour, states | `app/globals.css` → "Launch screen" |
| Welcome | `components/onboarding/SignedOutShell.tsx` → `WelcomeView` |
| Shuttle cutout | `public/brand/launch/shuttle.png` |
