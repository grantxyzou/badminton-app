---
paths:
  - "components/home/ShuttleBurst.tsx"
  - "lib/shuttleBurst.ts"
  - "components/HomeTab.tsx"
  - "__tests__/shuttle-burst.test.ts"
  - "__tests__/components/ShuttleBurst.test.tsx"
---

# The sign-up shuttle burst

<!-- Moved word for word from `.claude/rules/design-system.md` on 2026-11-09, to keep that file under the 40k limit `__tests__/docs-canary.test.ts` enforces; it concerns only these files, so it loads only with them. Its one lesson for every animation (no motion inside a View Transition) stays in `.claude/rules/motion.md`. -->

- **Burst** — `<ShuttleBurst>` (`components/home/ShuttleBurst.tsx`, `docs/plans/signup-shuttle-burst.md`, Grant's ask 2026-09-28): fourteen brand baddicons fly off the "Sign up for this week" button at random sizes when the server CONFIRMS a non-waitlist sign-up (`applySignup`, beside `tapSuccess`; never on the tap, never on a waitlist join). **The motion is a shuttle's, from the physics** (2026-09-28 pass; sources in the plan): a popper cone UP (±75°), a drag-killed launch (hard ease-out, 50–150 px) to an apex at `LAUNCH_FRACTION` (30 %) of the flight, then a near-vertical fall at terminal speed (ease-in then LINEAR, 180–300 px, ≤22 px drift), 1.0–1.4 s with staggered starts. Two keyframes, never one: `shuttle-flight` on a wrapper flies the PATH, `shuttle-attitude` on the `<img>` inside holds the ORIENTATION — cork aimed along the launch from frame one, turned nose-down through the apex the short way round, rocking 6–14° on the way down. `NOSE_DEG` (161°) is where the ARTWORK's cork points; re-measure it if the baddicons are redrawn. Geometry is `lib/shuttleBurst.ts` (pure, injectable rng; its test pins the keyframe boundary to `LAUNCH_FRACTION`), the layer is fixed, portaled and `pointer-events: none`, and reduced motion mounts nothing. No overshoot: `--ease-out-quart`, so `baddicon-pop` stays the one `--ease-spring` site. **It fires from `withViewTransition`'s `onFinished`, never inside the morph**: Safari paints a View Transition from STATIC snapshots (Chromium paints named groups live), so anything animating in the new DOM during a transition is invisible on iPhone — the first cut shipped and nobody on iOS saw it. Verify a transition change in Playwright's WebKit too, not Chromium alone. **The haptic tap fires in that same `launch` callback**, never on the server's answer (that was a whole morph before anything flew); `primeHaptics()` starts the plugin's download when the request starts, and the lead shuttle's delay is always 0, so buzz and first movement are one moment.
