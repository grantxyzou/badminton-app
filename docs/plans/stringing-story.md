# Your racket, step by step

**Track:** North Star pillar 4 (equipment service), the same track as [`stringing-canvas-redesign.md`](stringing-canvas-redesign.md): it is the moment after the one paid thing the app sells is asked for.
**Status:** shipped 2026-11-05
**Review on:** 2026-12-05 — once members have sent requests with it, has anyone said they saw it, or asked to turn it off; and does anyone reach the Done button less often now that it sits lower on the screen?

## Problem

Grant, on the Stringing canvas (2026-11-05): "Now that we have strings and racket asset can we make it into a step by step animation when user send in an request? Racket goes on to [the] machine > stringing through a racket > off machine > tada", then "oh also add when the string package tears open at the top string comes out". Then, once the board was published: "What about the animation" — build it.

Nobody has reported missing it. It is a delight piece: the request screen said "Drop off your racket" and nothing showed what happens next.

## Kill criterion

It gets in the way: a member reports the Request sent screen is slow, too long, or that they could not find Done; or the 1.2 MB of bare frames turns out to cost a deploy more than a few seconds. Either way, the component is removed from the Sent screen in one line and the frames are deleted.

## Non-goals

- Following the job's status on the racket's progress card (the packet for waiting, the machine for being strung, tada for ready). The board offers it; it is a separate change with its own question of how tall a progress card may be.
- A string's own colour on the thread and the packet's coil. The thread is drawn in the packet's cream; the request names a colour by word, not by paint.
- The maker's machine. It is a generic electronic stringer seen from above, with no name or logo.

## Decisions

- **Plays once on "Request sent", then holds its last frame**, as the board says, rather than looping. A loop on a screen a member reads for its next step is a distraction; "Play again" replays it.
- **The member's own racket and string.** The racket comes from the kit row they picked (a typed racket draws the default frame); the packet from the offered list's catalog link (a string with no packet starts at the machine).
- **A bare frame is a render, not a mask.** `racketBareSrc` (`public/rackets/bare/`, `--bare` on the render script) is the list pose with the model's string bed hidden, and the strung list picture is revealed over it. Masking the strings out of the strung picture would have needed every head shape's inner edge.
- **CSS keyframes ending on the final frame, `fill-mode: both`.** The app's reduced-motion rule (0.01 ms, one iteration) then lands on that frame with no special case; only "Play again" is hidden there, since it would replay nothing.
- **A dark scene in both themes**, like the share image: the renders are lit for a dark ground.
- **The picture is drawn on a fixed 420 × 490 stage and scaled to the sheet**; the captions are ordinary translated text below it.

## Shape

| Piece | File |
| --- | --- |
| The scene, captions, dots and Play again | `components/stringing/StringingStory.tsx` |
| Geometry and the twelve-second keyframes (`.ss-*`) | `app/globals.css` |
| Where it plays | `components/stringing/RequestStringingSheet.tsx` (the Sent step) |
| The bare frames | `public/rackets/bare/`, `racketBareSrc` in `lib/racketLook.ts`, `--bare` in `scripts/render-racket-images.mjs`, `__renderRacket(id, { bare })` on `/design/racket-render` |
| Copy | `home.stringing.story` in `messages/en.json` and `messages/zh-CN.json` |
| Coverage | `__tests__/racket-look.test.ts` (a bare frame per look), `__tests__/components/StringingStory.test.tsx` |
