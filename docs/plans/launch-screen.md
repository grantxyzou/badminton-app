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
locally (WebKit, warm dev server), a signed-in member reaches Home at ~1.5s on
a cold navigation, against ~0.15s with the old splash; a reload costs ~0.1s.
The first cut measured ~3.4s, because it waited out the shot in flight and then
played a second one, and replayed all of it on the reload after every sign-in;
the code review removed both (see Decisions). What is left is the final shot
itself, `WELCOME_AT_MS`. If that still shows up in feedback, it is the number
to cut for signed-in members.

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
  `lib/launchMotion.ts` (which also emits the rules that run them, so the
  loop's period has one home). After hydration, JS drives the resolve shot from the
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
- **The shot in flight BECOMES the final shot** (`shotTakeover`). The handoff
  says to wait for the current shot's trail to clear and then play the final
  one. But a loading shot and the final shot are the same frames until the
  wordmark starts to arrive (pinned by a test), so when the page resolves
  mid-flight the shot already in the air is simply kept. Nothing is
  interrupted, which is what the handoff's rule protects, and nobody waits out
  an extra shot for a page that is ready. A shot that has already landed is
  still waited out. This is the one place the build departs from the handoff's
  letter.
- **A reload is not a cold start.** Signing in reloads, and so do the error
  boundaries. The splash leaves at once on `navigation.type === 'reload'`.
  Untested on a device: whether iOS reports a restored, evicted PWA as a
  reload. If it does, that relaunch shows the loop and skips the final shot.
- **The splash takes taps while it is up.** The old one left at hydration, so
  `pointer-events: none` cost nothing. This one covers a live page for the
  length of a shot, and a tap passed through pressed buttons nobody could see.
- **Landings step aside, from one list.** `lib/landingParams.ts` names the URL
  parameters that carry a toast or a sheet; a canary classifies every
  parameter either shell reads. The verdict is read once at render, because
  the shells strip those parameters in their own effects.
- **The effect survives React's dev double-run.** Both "which shot did I
  adopt" and "did I already leave" live in refs. Found in a browser, twice:
  the shuttle snapped back to launch, and a landing's splash came back.

## Shape

| Piece | File |
|---|---|
| Motion model, keyframe generator | `lib/launchMotion.ts` |
| Lockup artwork (splash + Welcome) | `components/launch/LaunchArt.tsx` |
| Splash controller | `components/launch/LaunchScreen.tsx` |
| Landing-URL list | `lib/landingParams.ts` |
| Mount, pre-paint script, loop CSS | `app/layout.tsx` |
| Geometry, colour, states | `app/globals.css` → "Launch screen" |
| Welcome | `components/onboarding/SignedOutShell.tsx` → `WelcomeView` |
| Shuttle cutout | `public/brand/launch/shuttle.png` |
