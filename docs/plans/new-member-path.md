# New members' path

**Track:** critical path — "prove engagement (kill-criteria)", the same step `docs/plans/usage-metrics.md` serves: whether the people the door and the invites let in go on to play is the first half of "do members come back".
**Status:** shipped 2026-11-12
**Review on:** 2026-12-10 — has the "New members' path" card on the Metrics page been read when someone new joined, and did it show a step most of them stop at? If nobody opened it, fold it back into the New members card.

## Problem

Grant, 2026-11-12: "I think there were two people joined the group and wonder what was their path. Do we have a record to see how they move through the app?"

There was a record of pieces — when the account was made, how they signed in, which tabs they opened, whether they signed up and paid — but nothing put them together, and by design nothing shows one person's trail: the privacy policy promises the organiser "group totals … never a list of what one person did". So the answer had to be a path for new members as a GROUP.

## Kill criterion

Nobody reads the card in the four weeks after a new member joins (the review above), or it shows a number nobody can act on. Either way it folds back into the existing New members card.

## Non-goals

- Not a per-person timeline. Totals only, as every other card on the page; the operator's raw read stays the Azure portal, under the privacy policy's "running or fixing the service".
- Not new tracking. It reads what is already recorded. The signed-out steps (the door's ask, the wait, "Keep your account") write nothing and still do not; "kept their account" is read off the account itself.
- Not a funnel with drop-off arithmetic between steps. The steps are not strictly nested (an organiser can add someone who never opens the app), so each is a count of the cohort.

## Decisions

- **The cohort** is the roster members who joined in the last 90 days AND on or after the day usage tracking was switched on (2026-10-07). Someone who joined before then could have opened the app with nothing recorded, and would read as "never opened" — the lying empty state.
- **The steps** (each a count of the cohort): joined → kept their account (a PIN, a password or Google/Apple — `isUnclaimed` is false) → opened the app → looked past Home (a tab other than Home) → signed up for a session → played (a confirmed spot in a session that has happened) → paid. Plus the tabs they opened, how they joined (an invite link or code; added or let in by an organiser — the door's approval and an organiser's add are both recorded as `admin`, so they cannot be told apart; started the club; or before the app recorded how, a membership the 2026-10 migration made) and the typical days from joining to the first sign-up.
- **Read for the cohort only**: their app opens and tab views since they joined (`events`, bounded by the TTL and a row limit), not the 28-day window the usage card reads, which would forget a member who joined five weeks ago and has not opened the app since.

## Shape

| Piece | File |
|---|---|
| The pure count | `computeNewMemberPath` in `lib/metricsMath.ts` |
| The read (cohort's events, the roster's claim state) | `clubMetrics` in `lib/metrics.ts` |
| The card | `NewMemberPathCard` in `components/admin/MetricsPage.tsx` |
| Tests | `__tests__/new-member-path.test.ts`, `__tests__/components/MetricsPage.test.tsx` |
