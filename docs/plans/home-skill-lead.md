# Home skill lead — the one line on Home that says what Stats knows

**Track:** Value-Hub Slice-0 (#101), through `docs/plans/skill-leads-stats.md` — whose 2026-10-15 reading fired its `reach` row ("the fix is off-tab; reopen the Home decision").
**Status:** in-flight
**Review on:** 2026-11-15 — four weeks on: is `reach` in `GET /api/admin/slice0` → `skill` at or above 0.5, and how many members are in `homeLeadTappers`? Below 0.5 with few tappers, the card comes off.

## Problem

`docs/plans/skill-leads-stats.md` read its own kill criterion on 2026-10-15: of 36
roster members, 17 ever opened Stats — `reach` 0.472 against a 0.5 bar — while the two
inner stages (finding the check-in door, finishing it) pass. The people who need the
skill work never see the tab it lives on. Home is the one screen everyone opens, weekly,
to sign up.

Grant, 2026-10-14, reopening the Home decision: *"Something low effort like after sign
up — have you evaluated your skill? with some improvement stats, or interesting group
skill distribution then ask them to add or use stats."* And on the first draft's copy:
*"A system should never speak in first and second person. Instead do 'The group' '12
people'."*

A Home card for this already existed (`SkillDiscoveryCard`): shown only to a member who
had never rated, retired forever on one rating or one dismiss, carrying no number. It
could never show an improvement, because anyone with one had already been retired from
it — and `reach` sat at 0.47 with it in place.

## Kill criterion

Four weeks after deploy, read `GET /api/admin/slice0`. The card has to move `reach`:
≥ 0.5 keeps it. Below 0.5, `homeLeadTappers` says whether the card was ignored (few
tappers: the line is not interesting enough, or Home is not where reach is lost) or
tapped without a Stats open following (a measurement gap). Either way the card comes off
rather than being iterated blind — it is one line of Home's most-seen group, and a line
nobody acts on is a cost paid by everyone weekly.

## Non-goals

- Opening the check-in sheet from Home. `useCheckIn` has one owner (`SkillsTab`); a
  second mount site is the shape the skill-leads plan removed.
- The member's own band against the club. That stays behind the Stats consent sheet;
  Home shows the club spread (everyone's, returned without consent) and the member's
  own level (theirs), never the comparison.
- A new endpoint. Both reads exist and the member already has rights to them.
- A dismiss. "Everyone, every week" (Grant, 2026-10-14) is the decision; a dismiss
  turned the previous card into a one-shot.

## Decisions

- **Everyone, every week, no dismiss** (Grant, 2026-10-14). Beat "unrated only" and
  "everyone, dismissable". A rated member is exactly who an improvement line is for.
- **Third person, always.** "The group: 12 people have rated." Beat "12 of us". The
  speaker is the app, not a member of the club.
- **Three states, one line each**: never rated → the club spread and the ask; rated once
  → level and "rate again to see it move"; rated twice → level and the change since the
  previous check-in. A drop reads "down 0.3" in the muted colour, never red — red means
  failure on Home.
- **Below the cohort floor, no spread.** `cohort < minCohort` renders "Be among the first
  to rate" — a fabricated median is a spec driving a real decision, the same rule as
  tension ceilings.
- **Measured through `stats_open` with a bounded `source`.** Beat a new event kind. The
  tap records `stats_open { source: 'home' }` before the tab switch; `SkillsTab`'s own
  mount beacon stays as it is. Slice0 adds `homeLeadTappers` (members).
- **A measured placeholder, not a space-less slot.** The card renders for every
  identified member now, so the loading rule applies: its slot holds the card's height.
- **Rebuilt as an upsell, 2026-10-15.** Grant, on the one-line card in production:
  *"this does not make sense, I would be like huh? … Redesign it. Like an actual
  upsell."* "Level 3.4 overall" named no scale and no subject, and nothing said what a
  tap would get. Explored on a design canvas first; the first redesign (~560px, a list
  of Stats sections and a button) was *"too tall … a quarter or half"*. What shipped is
  one tappable card of at most three rows, held at 160px (the tallest state at 400px):
  a headline in words, the level **out of 5** beside a small line through the recent
  check-ins (or a dotted line to the next one), and three chips naming what Stats holds
  — Focus drill, Your record (a chart glyph: *"data related"*), Racket fit.
- **The never-rated state names the club and asks.** Grant: *"This is the {group
  name}'s average skill level. Add yours."*, and *"after adding there will be
  improvement tips, drills, racket, and string recommendations"*. The headline takes
  the group's name from `useCurrentGroup` (the app name with groups off); the bars are
  the dimension MEDIANS, which "average" stands for in member-facing copy. This
  supersedes **Third person, always** above: Grant's own copy says "yours", and the
  headlines speak to the member ("Your level is climbing").
- **Blue, not green.** The card wears the Stats field's blue (`--sev-low-text`) and a
  faint glow from the corner the Stats field is lit from, so it reads as a window into
  that tab; accent stays spent on the sign-up button, and the card carries no filled
  button that could outweigh it. A rise is blue, a dip is neutral text, never red.

## Shape

| piece | file |
|---|---|
| The card (its states, two reads through `sharedFetch`) | `components/home/SkillLeadCard.tsx` (replaces `SkillDiscoveryCard.tsx`) |
| Its look (classes and the two `--skill-lead-*` tokens) | `app/globals.css` (`.skill-lead*`) |
| Its slot and measured placeholder | `components/HomeTab.tsx` |
| `stats_open` may carry `source: 'home'` | `lib/events.ts`, `app/api/events/route.ts` |
| `homeLeadTappers` | `app/api/admin/slice0/route.ts` |
| Copy, both locales | `messages/en.json`, `messages/zh-CN.json` (`home.skillLead`) |
| Tests | `__tests__/components/SkillLeadCard.test.tsx`, the slice0 and events route tests |
