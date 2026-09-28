# Sign-up shuttle burst

**Track:** design-system standardization program (PRODUCT.md → Design Principle #5, "the details are the product"); requested directly by the owner on 2026-09-28
**Status:** in-flight
**Review on:** 2026-10-19 — after three Thursdays: has anyone said it is annoying, and has anyone said it is the reason they noticed the sign-up landed?

## Problem

Grant, 2026-09-28: "When people sign up for the week and you make a bunch of little small confetti like animation when they click on sign up, using the shuttles? Size the. Direction should be random."

No player has reported anything. The moment already has a haptic tap (native shell only), a banner that pops in, and a View Transition that morphs the button into the banner — but on the web, where most members are, the confirmation is a colour change and a line of text. The request is for the sign-up landing to feel like something happened.

## Kill criterion

This failed if any of the following is true a month in:
- it fires on anything other than a CONFIRMED, non-waitlist sign-up (a 201 with a roster row) — never on tap, never on a waitlist join, never on cancel or on any admin action;
- it plays for someone who asked for reduced motion;
- a tap under a falling shuttle is swallowed (the layer must be `pointer-events: none`);
- a screenshot pass at a phone viewport shows it fighting the banner's own entrance or the View Transition morph;
- more than one member says it is annoying. Delight spent weekly is a tax; the burst is about a second and does not repeat until next week's sign-up.

## Non-goals

- No burst on the waitlist path, on cancel, on admin sign-ups made on someone's behalf, or on Profile sign-in.
- No sound. No new `--ease-spring` site: `baddicon-pop` stays the one sanctioned overshoot (PRODUCT.md #2); the flight eases out with `--ease-out-quart`.
- No animation library, no canvas. Fourteen `<img>` pieces driven by two keyframes (path and attitude) and per-piece CSS custom properties.
- Not a generic confetti primitive. One consumer, one moment.

## Decisions

- **Shuttles, not paper.** The three brand baddicons (`public/brand/baddicon-{pink,yello,green}.svg`), the same set `PinInput` cycles per typed digit, so the burst reads as the PIN field's icons flying off the button.
- **Random size AND direction, per the request** — each piece gets its own angle (over the full circle in the first cut; an upward cone since the physics pass below), distance, size (12–26 px), rotation and duration, from `lib/shuttleBurst.ts`'s `burstPieces(count, rng)`. The rng is injectable so a test can pin every value; `Math.random` is fine here because nothing is an identifier (the `randomBytes` rule is for ids).
- **Fired from the server's answer, not the tap.** `applySignup` in HomeTab runs only after a 201; the burst is set there, beside `tapSuccess()`, with the submit button's rect captured BEFORE the commit replaces it with the banner. An optimistic burst on a refused sign-up would be a celebration of nothing.
- **A fixed, portaled layer.** `position: fixed; inset: 0; pointer-events: none`, portaled to `body` so no card's `transform` or `backdrop-filter` becomes its containing block (the documented trap). It centres on the button's viewport coordinates, which is what `getBoundingClientRect` gives.
- **Reduced motion renders nothing.** The global rule would collapse the keyframe to its end frame (opacity 0) anyway, but the component checks `matchMedia` and mounts no pieces at all — fourteen images fetched for a frame nobody sees is waste.
- **Self-clearing.** The layer unmounts on a timer just past the longest piece; the pieces keep their end frame (`fill-mode: forwards`, opacity 0) until then, so nothing snaps back to the origin.
- **Fired AFTER the morph, not inside it** (2026-09-28, the same day, from Grant's "I don't see the confetti" on his iPhone). The first cut set the burst in the same commit as the button-to-banner View Transition. Two problems, found only in a browser: unnamed, the layer sat in the root snapshot UNDER the card's named group, so only pieces outside the card showed (Chromium screenshot: three of fourteen). Named into the transition, Chromium painted the group live and it looked right — but WebKit paints every snapshot STATIC, so on Safari the whole flight ran behind a frozen picture of the old page and the layer had unmounted before the picture came down. Nobody on an iPhone ever saw it. `withViewTransition` gained an `onFinished` and the burst is fired from it (immediately when no transition runs). Cost: it starts ~250 ms after the tap under a morph, which reads as "the banner lands, then the shuttles fly" — arguably better. Verified in Playwright's WebKit as well as Chromium this time; a change to a transition is not verified until it has been looked at in both engines.
- **The motion is a shuttle's, not a spark's** (physics pass, 2026-09-28, from Grant's "this animation doesn't feel very confetti nor badminton shuttlecock — look up the physics of confetti and shuttlecock and apply that"). The first cut flew each piece in a straight line to a random point on the full circle and faded it, which reads as neither. What the physics says, and what each fact became:
  - A shuttlecock's drag rises with the square of its speed, so it sheds a smash's ~240 km/h to near its terminal speed of ~6.8 m/s in about 0.6 s, then falls almost vertically at a steady pace — a "skewed parabola", long on the way out and steep on the way down (Cohen et al., "The aerodynamic wall", and the shuttlecock aerodynamics literature at worldbadminton.com; the terminal-speed and decay figures are the ones every source agrees on). → Two phases at a fixed boundary (`LAUNCH_FRACTION`, 30 % of the flight): a hard ease-out launch of 50–150 px that covers most of its distance early, then a fall of 180–300 px that eases in briefly and runs LINEAR to the end, with at most 22 px of sideways drift.
  - The cork always leads: a shuttle flips nose-first within ~20 ms of the hit, points along its velocity thereafter, and spins and rocks a little on the way down. → A second keyframe on the image inside the path wrapper: aimed along the launch from the first frame (`aim`, computed from the launch angle and the artwork's own cork direction, `NOSE_DEG` = 161°), turned nose-down through the apex, then rocked 6–14° either side of vertical, settling as it fades. The turn always takes the short way round (`nearestTurn`).
  - Confetti from a popper leaves in an UPWARD cone at staggered instants and lingers, and a falling card's flutter is a side-to-side rock rather than a tumble at these sizes (the flutter/tumble regime of Belmonte, Eisenberg & Moses, Phys. Rev. Lett. 81, 345). → The cone is ±75° about straight up, delays are spread over 160 ms, the flight is 1.0–1.4 s instead of ~0.6, and the wobble is a rock, not a spin.
  - Sources read for this: https://www.worldbadminton.com/reference/research/documents/Aerodynamics_of_a_Badminton_Shuttlecock.pdf, https://iopscience.iop.org/article/10.1088/1402-4896/ae5361, https://physicsworld.com/a/flutter-and-tumble-in-fluids/, https://link.aps.org/doi/10.1103/PhysRevLett.81.345.
  - Verified by seeking the Web Animations to fixed times (110 / 380 / 800 / 1150 ms) in Playwright's Chromium AND WebKit and reading each piece's position, opacity and rotation back: every rotation converges on nose-down with the rock, every piece rises then lands below the card. A CDP playback-rate slowdown was the wrong tool — it slows the CSS but not the `onDone` timer, so the layer unmounted at ~400 ms of animation time.

## Shape

| Piece | File |
|---|---|
| Particle generator (pure, tested) | `lib/shuttleBurst.ts` |
| Layer + portal + reduced-motion guard | `components/home/ShuttleBurst.tsx` |
| Keyframe and layer rules | `app/globals.css` ("Sign-up shuttle burst") |
| Trigger | `components/HomeTab.tsx` → `applySignup` |
| Tests | `__tests__/shuttle-burst.test.ts`, `__tests__/components/ShuttleBurst.test.tsx` |
