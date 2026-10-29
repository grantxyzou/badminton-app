# One level

**Track:** none, and deliberately so: it repairs already-shipped work (Stats and the Home skill lead, `docs/plans/home-skill-lead.md`) rather than starting anything.
**Status:** in-flight (PR open 2026-10-29)

## Problem

Grant, on the design canvas (2026-10-29), noticed the Home frame said 3.4 and the Stats frames said 3.1 for the same member. Both were drawn from the app correctly: the app shows a member two different levels.

- Home's "Your level is climbing" card: the **latest check-in's raw score** (3.4), with "+0.8 since September" from the two raw scores.
- Stats, the LEVEL tile: the **canonical level** (`lib/level.ts`, 3.1: the smoothed check-ins blended with logged games), captioned "▲ 0.8 since September" from the RAW scores, a change nothing on the screen adds up to.
- Stats › You, "Your level over time": the raw scores again (2.6 → 3.4), and "You're Advanced…" read from them.

Asked which one "Your level" should be, Grant chose the canonical level.

## Kill criterion

A member sees more than one number labelled as their level anywhere in the app, or a "since …" change that is not the difference between two levels shown to them.

## Non-goals

- Changing how the canonical level is computed (the blend, the smoothing, the game weight).
- The per-side "three sides of your game" bars: they are labelled as sides, not as the level.
- The phase hysteresis (`CanonicalLevel.phase`); the chart's sentence reads the band its number sits in, as before.

## Decisions

- **The change is canonical against canonical.** A "since" figure needs a level THEN, and nothing stored one, so the API now returns a **trail**: the canonical level as of each check-in (the same EWMA, anchored at that check-in, over the check-ins up to it), with the last point the current canonical level itself. Past points carry no game term: there is no historical game calibration, and inventing one would be a number nobody could check. For a member with games the last step therefore includes the games' nudge; that is the level the member actually has.
- **One read, one parser.** `lib/levelRead.ts` parses the response and owns the "change since" rule (`lastChange`); `lib/useLevelRead.ts` is the client read, re-read on a saved check-in. Home's card switched from `/api/assessments` to it, and the Stats tile and the chart read it too, through `sharedRead`, so Stats still asks once.
- **The chart draws what it is handed.** It took the check-in owner and plotted its snapshots; it now takes the level read as a prop, so `/design/level-trend` still renders every state from made-up data.
- **A visible consequence:** the chart's phase sentence reads the canonical number, so a member whose raw score had crossed a band but whose level has not now reads the lower phase (Lin: "Advanced" became "Intermediate, 0.3 from Advanced").

## Shape

| Piece | File |
|---|---|
| The trail (pure) | `lib/level.ts` `levelTrail`, on `CanonicalLevel.trail` |
| Home's card | `components/home/SkillLeadCard.tsx` |
| The Stats LEVEL tile | `components/stats/OverviewStrip.tsx` |
| "Your level over time" | `components/stats/LevelTrendChart.tsx` (data from `SkillTrendCard`) |
| The shared reader | `lib/levelRead.ts`, `lib/useLevelRead.ts` |
