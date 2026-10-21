# Launch screen

**Track:** native shell / store launch — the first screen a store download shows
**Status:** in-flight
**Review on:** 2026-10-28 — since 2026-10-21 a signed-in launch plays the shot and waits for Home again (now to preload, `docs/plans/tab-keep-alive.md`): has anyone said opening the app feels slower, or that it opens complete?

## Problem

The cold-start splash was a generic ring spinner over "BPM Badminton / Weekly
sessions", followed by a separate signed-out Welcome that shared nothing with it.
Grant commissioned a design handoff (`design_handoff_launch_screen/`, outside the
repo): the app icon's shot trajectory IS the loader, and it resolves into the
Welcome lockup without a swap. No member has complained about the old splash;
this is a brand and first-impression change ahead of the store listing.

## Kill criterion

Members notice the launch for its slowness rather than its look. It already
failed this once, before shipping: the first cut held a signed-in member for
~3.4s, the code review got that to ~1.5s, and Grant's answer to "is 1.5s
acceptable?" was "its done loading faster than 1.5s". So a signed-in launch now
leaves at hydration — measured locally (WebKit, warm dev server) the splash
starts fading ~0.1s after the page arrives, the same as the old splash. The
shot loops only for as long as the page actually takes.

## Non-goals

- The rejected `stacked` lockup variant from the handoff.
- Sound or a landing haptic (the handoff floats the haptic; not built).
- The DS red error banner for a failed load: the splash has no fetch of its own
  to fail. The server has already decided the page before the splash sees it.

## Decisions

- **The session signal is the server-rendered DOM, not a client store.**
  `app/page.tsx` already decides signed-in vs signed-out on the server. The
  splash reads `[data-signed-out-welcome]` (SignedOutShell's Welcome) at
  hydration, then again when the final shot starts, because a view can leave
  Welcome right after hydration. No marker (Home, `/legal`, `/design`,
  `/migrate`) means leave at once. A store that the shells announced into would have been a second
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
- **Only Welcome gets a final shot** — REVERSED 2026-10-21, see the next
  bullet. The handoff routes a signed-in launch to Home at W, after a final
  shot. Built that way first, it was a wait over a page that was already ready,
  so it was cut (see the kill criterion): signed in, the loop was a real loader
  and nothing more. On Welcome the final shot IS the screen, so it stays. This
  and the shot-takeover bullet are the places the build departs from the
  handoff's letter.
- **A signed-in launch plays the final shot again, and the wait now buys
  something** (2026-10-21). Grant: "at app start up can we let the full
  animation play end to end at least once and use that time to preload so the
  app when first land seems complete and fast?" The 2026-10-03 cut had made the
  splash leave at hydration, which showed Home's skeletons instead. Now the shot
  plays (the in-flight one is still adopted), and once it lands the screen waits
  for Home to finish (`appSettled` in `lib/appSettled.ts`: no visible
  `.shimmer-line` in the tab on screen) for at most `APP_SETTLE_WAIT_MS` (2.5 s)
  more. Meanwhile `HomeShell` opens the other tabs hidden behind it
  (`docs/plans/tab-keep-alive.md`). Measured on a local production build, phone
  profile (150 ms latency, 4x CPU): page at 0.5 s, Home complete at 2.05 s, the
  other tabs open at 2.1 s, splash gone at 2.3 s onto a Home with no skeleton
  showing. A reload still skips it.
- **The shot in flight BECOMES the final shot** (`shotTakeover`). The handoff
  says to wait for the current shot's trail to clear and then play the final
  one. But a loading shot and the final shot are the same frames until the
  wordmark starts to arrive (pinned by a test), so when the page resolves
  mid-flight the shot already in the air is simply kept. Nothing is
  interrupted, which is what the handoff's rule protects, and nobody waits out
  an extra shot for a page that is ready. A shot that has already landed is
  still waited out.
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
