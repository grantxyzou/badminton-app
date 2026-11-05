# A session list for clubs with money off

**Track:** multi-group critical path — "a SECOND club created and run through one session end to end" (CLAUDE.md, Groups). Six Feathers (`docs/plans/six-feathers-onboarding.md`) is the club, and it runs with money off.
**Status:** shipped 2026-11-05 (#796)
**Review on:** 2026-11-30 — has Six Feathers run a Saturday, and did its organiser use the list (remove, move, restore, read a late cancel)? If two Saturdays ran and nobody opened it, remove it (Kill criterion).

## Problem

Nobody has reported this yet. Ian has not run a session, and Six Feathers is the only club with money off. It was found by reading the code on 2026-11-05, and it is the kind of gap that shows up on the first Saturday: someone posts in WhatsApp "can't make it" without removing their name, and the organiser cannot take them off.

The cause is one line in the Command Center. With `ClubRun.money === 'off'` (`lib/clubRun.ts`), `components/admin/CommandCenter/CommandCenter.tsx` drops the Session · Payments toggle and does not render `PaymentsCard` at all. `PaymentsCard` is the only admin card that lists the session's sign-ups row by row, so every per-person action goes with it.

### What the organiser of a money-off club loses today

Checked against every admin call site of `/api/players` on 2026-11-05.

| Capability | Where it lives | Money off today |
|---|---|---|
| See who is in, by name | `PaymentsCard` list; Home's `WhoElseIsIn`; "Copy list" (`lib/rosterText.ts`) | **Visible, not actionable.** Home shows the numbered list and waitlist read-only (the organiser is a member too); Copy list gives the text. |
| See who cancelled, and who cancelled **late** | `PaymentsCard` removed list, with the `Late · Nh` tag | **Lost.** `lateCancel` reaches no other admin screen. This matters most for a money-off club: Six Feathers' rule is "no later than Wednesday at noon or you have to pay for your spot", and the organiser collects that money outside the app, so the app is the only record of who owes it. |
| Remove someone from the session | `PaymentsCard` row sheet → `DELETE /api/players` | **Lost.** The auto-promote (`lib/waitlistPromote.ts`) runs on an admin removal, so this is also how a spot is freed for the waitlist. |
| Add a player by name (a drop-in with no phone, a member who asked in the chat) | `PaymentsCard` "Add player by name" → `POST /api/players` | **Lost.** Home's sign-up card is locked to the signed-in member's own name. |
| Promote from the waitlist by hand | `PaymentsCard` waitlist → `PATCH { waitlisted: false }` | **Mostly covered.** The automatic promotion fills freed spots, and "Let the waitlist in now" on `NextSessionCard` ends the members-first window. Still lost: a promotion once the session has started (auto-promote never runs then, which is when a no-show is swapped at the gym) and promoting out of order. |
| Restore someone removed by mistake | `PaymentsCard` removed list → `PATCH { removed: false }` | **Lost.** |
| Move someone back to the waitlist | Nowhere. `PATCH { waitlisted: true }` works in the API, and no screen sends it. | Not lost, since it never existed. Listed because the request names it. |
| Invite a plus-one into the club | `PaymentsCard` row sheet on a guest row → `InviteCard` | **Shortcut lost.** "Invite someone" under People still mints the same one-time invite. |
| Recovery code / Clear PIN | `PaymentsCard` row sheet; the recovery code is also on `RosterPage` | **Partly covered** by the Roster page. |
| Look back at a past session's list | `PaymentsCard`'s date stepper, reached from Ledger → Past sessions | **Lost.** The Ledger row is hidden with money off, and Past sessions is reached only through it. Out of scope here (Non-goals). |

Put simply, today's set-up is like a restaurant that took the tables off the floor plan because it stopped printing bills. The host can still read the reservation book on Home, but cannot seat, move or cross anyone off.

### A server detail, checked and left alone

A hand promotion (`PATCH { waitlisted: false }` in `app/api/players/route.ts`) clears `heldForUnpaid` and leaves `waitingForMembers: true` on the row; the automatic promotion clears both (`lib/waitlistPromote.ts`). The first draft of this plan called that a stale flag to clear. **It was wrong** (see Decisions): the flag is what keeps a drop-in the organiser moves BACK behind the members while the window runs.

## Kill criterion

- Six Feathers runs two Saturdays on BPM and nobody opens the list or uses one of its actions. Remove it: Home's read-only list and Copy list were enough.
- Or Ian declines the pilot (`docs/plans/six-feathers-onboarding.md`). Six Feathers is the only money-off club, so don't build it.

## Non-goals

- **No change for clubs that collect money.** BPM Core keeps `PaymentsCard` and the Session · Payments toggle as they are.
- **No money of any kind** on this surface: no amounts, paid marks, covers or receipts. A club that said "money off" must not see a `$`.
- **Past sessions for a money-off club.** That needs its own way into Past sessions that doesn't go through the Ledger. Open a `later` issue if Ian asks.
- **Recovery codes and PINs.** The Roster page already carries them, and this list is about the week, not the account.

## Options

### Option A — `PaymentsCard` in a "list" mode

Pass `moneyOff` into `PaymentsCard` and hide every money branch: the hero (the per-person amount, the paid/covered bar, "N of M paid", Receipt), the amount on each row, Mark paid, the owing / paid / covered split and its statuses, "Says they've sent it", and in the row sheet Mark unpaid, Send receipt, Cover, Undo cover and the cover-and-remove intercept. Render it under `NextSessionCard` in the money-off branch, or bring the toggle back as "Session · List".

**What it gets:** one component, so every non-money action (add, remove, promote, restore, invite a guest, recovery code) comes with no new code, plus the past-session stepper.

**What it costs:**
- About twelve gated sites in a 1,134-line file whose whole job is money. Every money feature added to `PaymentsCard` later has to remember the mode, and a missed one shows money to a club that switched it off. That is exactly the "switch that lies" `lib/clubRun.ts` warns about. It needs a render test with money off that fails on any `$`, "paid", "Mark paid" or "receipt".
- **The wrong order.** `PaymentsCard` lists who owes first. A members-first club needs sign-up order (`compareBySignup`), the order Copy list, Home and the auto-promote all use. That means a second ordering branch.
- **Reads with no purpose.** The date stepper loads the session list and `GET /api/sessions/history?counts=1` to put money dots on a calendar.
- Its loading skeleton (`CONSOLE_HEIGHTS.payments`, 541px) is measured for the money layout, so it needs a second measured height.
- Roughly 150 changed lines plus the canary test.

### Option B — a small `SessionListCard` under `NextSessionCard` (recommended)

A new card, rendered only in the money-off branch, directly below `NextSessionCard`, with no toggle:
- **One read:** `/api/players?all=true` for the active session.
- **Confirmed**, numbered in `compareBySignup` order, so it agrees line for line with Copy list and Home.
- **Waitlist**, numbered, each row with Promote. A `waitingForMembers` row says so while the window runs.
- **Cancelled**, with the existing `Late · Nh` tag and when they left, each with Restore. This is the line a money-off organiser reads on Wednesday afternoon.
- **Add by name** for the current session.
- **Row sheet:** Remove from session, Move to waitlist (or Promote), and on a guest row Invite to the club.

**What it gets:** no money **by construction**. Its row type has no money fields, so nothing can leak in later. It uses the right order, adds no reads, and needs no toggle.

**What it costs:**
- A new component of about 300 lines, with a test file: the three lists and their order, each action's request body, the loaded-empty vs load-failed states (the lying-empty-state rule), and a check that it renders only with money off.
- **Duplicated fetch handlers.** Add, remove, promote, restore and invite are about 60 lines in `PaymentsCard`. The way to keep one copy is to move the plain calls into `lib/sessionRowActions.ts` (async functions returning `{ ok, error }`) and have `PaymentsCard` call them too. `PaymentsCard`'s money-only parts, such as the cover-and-remove intercept, stay where they are and run before the shared call. This is the one edit Option B makes to the money card, and it is mechanical.
- A second request for the same rows. `NextSessionCard` reads `/api/players` and the list reads `?all=true`, and `sharedFetch` dedupes by path only. `NextSessionCard` can switch to `?all=true` (it already drops removed rows), which makes it one request.
- A measured `CONSOLE_HEIGHTS.sessionList` and a `RevealSlot`, per the loading-cascade rule.
- Roughly 400 lines, including tests.

### Both options

- Moving a row back to the waitlist does **not** promote anyone, as today (`docs/plans/waitlist-auto-promote.md`: never on an admin's move back). The sheet should say so ("Nobody moves up").
- English only, like every admin surface.
- `verify-ui` on the seeded `six-feathers` scenario (`SEED_DEV_SCENARIO=six-feathers`, organiser Chong Wei / 1357), at a phone width, before claiming it works.

## Questions for Grant

Answered 2026-11-05: B, with "Move to waitlist". Past sessions was not answered and stays a non-goal, as recommended.

<!--
Everything above is written BEFORE the work and is the gate for starting it.
Everything below is appended AS the work proceeds.
-->

## Decisions

- **Option B** (Grant, 2026-11-05: "Go with B, include move to waitlist"). A new `SessionListCard` under the session card, in the money-off branch only, over a money mode inside `PaymentsCard`: the card's row type has no money field, so the promise that money is off holds by construction.
- **"Move to the waitlist" ships, and moving back promotes nobody.** The row returns to its place by sign-up time, which is usually the FRONT of the line, so the next freed spot goes back to them unless the organiser promotes someone else first. The sheet says so ("They wait in line by when they signed up").
- **`waitingForMembers` is left on a hand promotion** (2026-11-05, while building). The plan proposed clearing `waitingForMembers` on a hand promotion. Tracing `planPromotions` showed that would be a regression: the automatic promotion only takes a flagged row once the window has closed, so clearing it there is harmless, but clearing it on a HAND promotion would let a drop-in the organiser moves back take the next freed spot ahead of a member. The flag left on the row means "not a member", which stays true. `__tests__/group-members-first.test.ts` pins it.
- **The list is folded behind one line** ("32 of 32 in · 3 waiting", then Show), as Home folds the same list. Open, Six Feathers' 35 rows stood 1,574px in the middle of the console (verify-ui, the six-feathers seed, 430px); folded, the card is 178px and the line carries the counts. The cancelled rows fold the same way, with the late count on their line ("2 cancelled · 1 late").
- **Removal is by NAME, as `PaymentsCard` sends it.** `DELETE` is the path that stamps `removedAt`, marks the row removed by an admin, takes a host's guest along and hands the spot on; `PATCH { removed: true }` targets by id but stamps no `removedAt`, so the cancelled list could not say when.
- **The courts are the cap, and the waitlist is their overflow** (Grant, 2026-11-05: "wait list is limited by court and total player per court availability"). The session forms already write the cap as courts × players per court (`capacityForCourts`), and the server enforces it, but the first build broke the rule at two edges: on a full Saturday, **Add player by name** answered "Session is full" instead of joining the waitlist, and **Restore** answered 409 even for someone who had cancelled FROM the waitlist, because the server capacity-checked every restore. Now Add always sends `waitlist: true` (a spot while there is one, the waitlist once full), Restore on a full session sends `waitlisted: true` and is labelled "To waitlist", and `PATCH /api/players` capacity-checks only a move that ends holding a spot — security rule 8 says the same, and a restore onto the waitlist was never what it guarded. The card speaks in courts: the line counts them ("32 of 32 in · 4 courts · 3 waiting"), the waitlist label says how close it is to another court ("4 more fills a court", `courtLine`, the session card's words), and a waitlisted row on a full session says "All 4 courts are full at 8 a court. Add a court in Edit details, or remove someone first." Adding a court raises the cap, which the automatic promotion already answers.
- **Recovery code and Clear PIN are left to the Roster page**, as the Non-goals say; the sheet offers move, remove and, on a guest, the invite.
- **The per-row calls are one copy**, `lib/sessionRowActions.ts`, and `PaymentsCard` now sends its add, promote, restore and remove through it. Its cover-and-remove intercept stays in the card and runs before the call.

## Shape

| Piece | File |
|---|---|
| The money-off branch renders the list | `components/admin/CommandCenter/CommandCenter.tsx` |
| The list card | `components/admin/CommandCenter/SessionListCard.tsx` |
| The pressable roster row | `app/globals.css` (`.roster-row--action`, beside Home's `.roster-row`) |
| Shared row calls (add, remove, promote, move back, restore) | `lib/sessionRowActions.ts`; `PaymentsCard.tsx` sends through it (without the waitlist options, so BPM's behaviour is unchanged) |
| A restore onto the waitlist is not capacity-checked | `app/api/players/route.ts` (PATCH) |
| Measured skeleton height | `components/primitives/CardSkeleton.tsx` (`CONSOLE_HEIGHTS.sessionList`) |
| Tests | `__tests__/components/SessionListCard.test.tsx` (order, numbering, no money, fold, each action's body, failure vs empty), `__tests__/components/CommandCenter.moneyOff.test.tsx` (which card each club gets), `__tests__/group-members-first.test.ts` (a drop-in moved back waits behind a member), `__tests__/waitlist-auto-promote.test.ts` (a full session refuses a restore into a spot and takes one onto the waitlist) |
