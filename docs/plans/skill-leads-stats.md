# Skill leads: make the club see the value that already shipped

**Track:** Value-Hub Slice-0 (#101) — its own readout named reach as the failure, and
the measurement below is what makes that readout legible. This is not Track 1 (#102);
Track 1 is what it unblocks.
**Status:** intent
**Review on:** 2026-10-15 — Of `reach` / `entry` / `finish` / `repeat` in `GET /api/admin/slice0` → `skill`, which is lowest, and does it point inside Stats or off-tab?

## Problem

Grant, 2026-09-10: **"How might we bring more realization this app has skill,
learning, and recommendation value?"**

And, on being told the flag retirement was next: **"I dont want to remove what we
build."** That is the whole problem in one line — the work is shipped, it is good,
and almost nobody has seen it.

The numbers behind it, read from production the same day:

| stage | members |
|---|---|
| on the roster, active | 56 |
| **ever completed a check-in** | **7** |
| ever tapped the recommendation card | 5 |
| tapped it more than once | 3 |

Sources: `GET /api/members`, `GET /api/stats/club/bands` → `cohort` (exactly the
members holding a self-assessment), `GET /api/admin/slice0`.

**The recommendation card does not fail on value. It fails on reach.** Three of the
five people who ever tapped it tapped it more than once. The people who find it come
back. Almost nobody finds it.

And the deeper cause is upstream of the card: **everything personal in this app is
downstream of one check-in**, and 49 of 56 members have never taken one. For them the
You register is three tiles reading `—` / `0` / `0`, Learn is a check-in invitation,
Equipment is a parked card, and the AI greeting renders nothing at all. They are not
ignoring the value. They have never been shown any.

### A denominator that has now misled three readings

Every rate published so far has been denominated on *attendance since a cutoff*, not
on the roster. That makes the same fact read three different ways:

- 7 of 17 recent attendees is 41%. 7 of 56 members is 12.5%.
- The rec-card rate "fell" 0.25 → 0.176 between 2026-08-25 and 2026-09-10. Nobody lost
  interest: `repeatTappers` was 3 both times and the attendance denominator grew 12 → 17.
- The games `0/12` was read as disinterest for weeks. It was an empty partner picker.

Attendance is not the question. Someone who skipped three weeks still has the app on
their phone and is exactly the person we want to give a reason to open it.

## Kill criterion

Four weeks after Phase 2 deploys, read `GET /api/admin/slice0?since=<ship date>` and
act on whichever ratio is **lowest**:

| reading | meaning | next move |
|---|---|---|
| `reach` < 0.5 | they do not open Stats at all | the fix is off-tab; **reopen the "Home is out of scope" decision**. Nothing inside Stats can help. |
| `entry` < 0.4 | the door is not seen or not legible | affordance on the level tile, not the sheet |
| `finish` < 0.5 | the sheet is where they drop | short-form first check-in; lift the jump-to-review escape above the anchor buttons |
| all pass, `repeat` low | skill value is not sticky | the chart is the lever; reconsider what a second check-in is *for* |

If `reach`, `entry` and `finish` all pass and `repeat` still does not move after two
further months, the honest conclusion is that per-member skill tracking is not what
this club wants, and the check-in should stop being the gate on everything else.

**This criterion is falsifiable against the decision that scoped the work.** A low
`reach` says the answer was never inside Stats. Recorded now, while it is still cheap
to say.

## Non-goals

- **Home.** Scoped out by decision, 2026-09-10. A low `reach` is what would reopen it.
- **Register persistence and deep-linking.** `'you'` is already the default and You
  *is* the skill register, so persistence could only move a member *away* from skill.
  Deep-linking has no caller: no scheduler, no push trigger, no share link carries a
  register. Building an entrance nothing can arrive at is the `pick_served`-with-no-
  reader error this plan exists to close.
- **Redesigning `CheckInSheet`.** It is already a per-skill wizard with Skip, a
  jump-to-review escape, and Save enabled at one rating. Partial check-ins already work.
- **A `checkin_saved` beacon.** Completions are already stored in `assessments` with
  full history and `takenAt`. A beacon would be a second lossier copy, blind to every
  check-in taken before today.
- **Push, and anything time-based.** There is no scheduler in this repo; every trigger
  is event-driven off an HTTP request.
- **Changing the rec-card or games denominators.** Changing a number mid-gate is worse
  than leaving it. The new block is denominated differently and says so.

## Decisions

- **Skill leads, not equipment or learning** (Grant, 2026-09-10). Equipment has the
  sharpest promise but skill is the gate: a check-in is the input every other register
  is waiting on.
- **Measurement ships alone, before any UI change.** Beat shipping the door first.
  Nothing currently records that a member ever opened Stats, so the diagnosis above is
  an inference — it may be describing a screen nobody looks at. Ship the door first and
  a flat result cannot distinguish a bad door from an empty room.
- **Denominate the new block on the roster, not attendance.** Beat reusing the existing
  cohort for consistency. Consistency with a frame that has misled three readings is not
  a virtue. The two blocks are labelled as not comparable.
- **A trend chart, not a copy nudge** (Grant, 2026-09-10: *"We should introduce a trend
  chart of the level change overtime"*). Beat a 28-day `baselineInvite` caption. A
  caption asks you to take progress on trust; a line is the thing itself. It also makes
  the argument for a second check-in structurally — you cannot draw a line through one
  point — instead of asking for one.
- **Plot against time, not sessions attended.** Beat a per-session x-axis. Indexing on
  sessions would make the line say something about turning up rather than improving,
  which is the same mistake as the attendance denominator.
- **One owner for `CheckInSheet`.** It has three mount sites today across two registers,
  each with its own open state and refresh. Follows the `useGear` single-owner precedent
  (prop-drilling, not context).
- **No feature flag on any of this.** A flag on a measurement kills the measurement, 56
  members do not split into two readable arms, and the door is a one-line revert.

## Shape

| piece | file |
|---|---|
| Event kinds `stats_open` / `checkin_open` + `source` enum | `lib/events.ts` |
| `source` on the client meta | `lib/engagement.ts` |
| `source` on the stored event (additive optional) | `lib/types.ts` |
| Per-kind flag gate (gear kinds keep it, skill kinds do not) | `app/api/events/route.ts` |
| The `skill` block, roster-denominated | `app/api/admin/slice0/route.ts` |
| Reader-coverage canary | `__tests__/events-reader-coverage.test.ts` |
| Single owner for the check-in + its assessments read | `components/stats/useCheckIn.ts` (new) |
| Owns the sheet, fires `stats_open` | `components/SkillsTab.tsx` |
| Level tile becomes a door | `components/stats/OverviewStrip.tsx` |
| The chart | `components/stats/LevelTrendChart.tsx` (new) |
| Hosts the chart; drops its own fetch and both sheet mounts | `components/stats/SkillTrendCard.tsx` |
| Drops its sheet mount | `components/stats/LearnRegister.tsx` |
