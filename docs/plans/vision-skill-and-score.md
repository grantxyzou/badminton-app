# Photos for scores and skills

**Track:** ROADMAP critical path — "capture game/win-loss data" (the score-sheet photo), and the Stats register (form tips). Follows `docs/plans/string-photo-stocktake.md`, whose photo → check → save shape this reuses.
**Status:** intent
**Review on:** 2026-12-31 — after the score-sheet photo has had two court nights: how many games were logged from a photo, and how many of those did someone correct before saving? Few logged, or most corrected, and the photo is not saving work: stop there and do not start the form tips.

## Problem

Grant, 2026-11-15, after the stringing stocktake used a photo: *"can we use this
same tech for badminton skill assessment and score counting?"*

What "the same tech" is: one still photo (or a handful), sent to a model that
reads images, answering in a fixed shape, which a person checks before
anything is saved. It reads what is IN a picture well (printed labels, digits,
how full a spool looks). It does not watch video, and it does not run live.
That decides which of the asks fit.

## What fits, and what does not

| Ask | Fit | Why |
|---|---|---|
| **Log a finished game from a photo of the score** (a paper score sheet, a flip scoreboard, a whiteboard of the night's games) | **Good** | Digits and names on a sheet are exactly what a photo reads well. It fills "Add a game" (teams, both scores); the player confirms, like the stocktake. Several games on one sheet become several rows to tick. |
| **Count rallies live from a phone watching the court** | **Poor** | That is video: following a shuttle at 300 km/h frame by frame. A still-image model sees one moment; sending frames many times a second is slow and costly and still misses the shuttle. The court-night board already counts by VOICE (`docs/plans/voice-score.md`, in flight), which is the better tool for live scoring. |
| **Form tips from a short clip of your own shot** | **Possible, as a coaching aid** | A few frames from a 5–10 s clip of one shot (a smash, a clear) can show grip, ready position, contact height and base footwork. It can NOT give a fair level: frames blur, angles vary, one shot is not a game. So it gives tips, never a number. |
| **A skill rating from photos** | **No** | The app has one level (`docs/plans/one-level.md`): check-ins blended with logged games. A second number from a photo would break that rule and would be a guess presented as a measure. |

## Kill criterion

See the review line. For the form tips, separately: if members who try them
rate the tips "not useful" more often than "useful" across the first twenty,
remove the feature.

## Non-goals

- Live rally counting by camera (voice owns live scoring).
- Any rating, level or ranking from a photo or clip.
- Storing photos or video. Each is read once for the answer and dropped, as
  the stocktake's photo is.
- Filming other people. Form tips are for your OWN clip only; a club setting
  stays off until the privacy policy says what is sent where.

## Proposed order

1. **Score-sheet photo → Add a game.** Would reuse the photo stocktake's
   pieces: the photo shrinker, the fixed reply shape and the check step. Those
   were removed when the stocktake moved to barcodes (2026-11-16,
   `docs/plans/string-barcode-stocktake.md`); git history keeps them. Names on the sheet are matched to the club's roster the way the
   stocktake matches labels to the shelf: exactly one match or "not sure",
   never a guess.
2. **Form tips from your own clip** (only if 1 is used). Frames are taken on
   the phone (no video leaves it), a few are sent, and three short tips come
   back with what to watch for. A privacy-policy sentence first: what is sent,
   to whom, and that nothing is kept.

## Decisions

<Appended as the work proceeds.>

## Shape

<Appended as the work proceeds.>
