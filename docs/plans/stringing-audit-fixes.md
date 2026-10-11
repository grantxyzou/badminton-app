# Stringing flow — audit fixes

**Track:** North Star pillar 4 (equipment service) — the stringing service is the one paid thing the app sells, and `restring-reach.md` already measures its reach; this closes what a role-by-role audit found between the player, the stringer and the bench.
**Status:** in-flight
**Review on:** 2026-11-11 — From `stringingJobs`: of the requests made in the four weeks after ship, how many were claimed within 24h of `createdAt` (the notification's job), and how many player-origin jobs carry a `readyBy` (the detail-screen date's job)? Before ship both were structurally zero.

## Problem

Nobody reported these; they come from a 2026-10-11 walkthrough of the flow as a player, a stringer and the admin on the mock store (`.impeccable/critique/2026-10-11T08-08-31Z__components-stringing-stringingcard-tsx.md`, score 25/40). The nine findings that cost a person something, each measured on screen:

- A player with three rackets in sees one (`jobs.find(open)`), and the cap error tells them to collect rackets they cannot see.
- Reopening the request sheet after a send shows the old "Sent." screen; a second request needs a reload.
- A racket still in the player's bag reads "With Grant"; the admin footnote reads "Lin sees · You have it" for a job nobody has. `requested` and `received` were folded together before remote requests existed.
- A new request reaches nobody: the route sends no push, the Profile badge counts unpaid/birds/dormant only, the Command Center has no stringing count, and the bench is the last of nine rows. Three unclaimed requests and a job two days late showed as "1 need you".
- The bench list starts at 826px of a 932px screen, under four set-up cards; 34 tap targets above the fold.
- A player-made request can never be given a ready-by date: intake has a date picker, the detail screen has none, so "N days late" only ever applies to admin-logged jobs.
- Intake reads "They sees" and "Save & let They know", and the save sends nothing.
- The stringer's advance button renders "标记为ready" in Chinese, and a mis-tap on "Mark ready" pushes the player with no way back for the person who tapped it.
- The stringer is the one person not shown the promised date, though the API sends it.

Plus three measured accessibility failures in the light theme (amber banner title 4.43:1; active segment 3.55:1 and `cc-btn-primary` ink 4.16:1; eleven bench controls under 24px).

Grant, 2026-10-11, on the two open choices: "All stringer, bench first. and the order you suggested."

## Kill criterion

- **Notification:** if, four weeks after ship, requests are still claimed no faster than before (median hours from `createdAt` to the first `history` entry by someone other than the requester), the push is noise and the admin's own habit of opening the bench was enough. Remove it rather than tune it.
- **Bench reorder:** if the set-up cards are opened more than the list is scrolled (no telemetry; Grant's say-so after two weeks on the bench), the original order was right for the one admin who uses it and the fold measurement was the wrong lens.

## Non-goals

- A player cancelling their own request (audit note N7). One more write path on the player side is its own decision.
- A reason/message field on a proposed change (note N8).
- Pricing per string or anything in the string inventory (#586 owns that).
- Retracting a "ready" push once sent. Undo restores the status; the banner has already been shown.
- Re-keying the hardcoded "Grant" to the actual stringer's name. The player view strips the stringer on purpose (`docs/roles.md`); the copy becomes "the stringer", not a name.

## Decisions

- **Recipients of the new-request push are every `canString` member AND every admin of the group, minus the requester** (Grant: "All stringer"). Beat admins-only (Zach would never hear about work meant for him) and canString-only (Grant is the admin who runs the bench and is not necessarily flagged). Resolved through `rosterMembers(groupId)` so a second club's stringers never hear about the first club's rackets.
- **The payload carries no money and no spec** — "New stringing request · Lin's Astrox 88D Pro" — the same lock-screen rule as the player payloads.
- **`requested` becomes its own player stage** rather than renaming `with_stringer`. Beat keeping the fold: the collapse was argued from a racket handed over in person, and the remote request now outnumbers that path. The strip puts `requested` on "Drop off your racket" and `with_stringer` on "Track progress".
- **The bench lists first; set-up folds** (Grant: "bench first"). The shop sign stays as the one card above the segment because closing the shop is the admin's most consequential bench action; strings, stock and prices sit in a collapsed "Set-up" section under Archived.
- **The stringer gets an Undo, not a confirm.** Beat a confirm on every tap: the stringer's whole value is a one-tap bench, and "are you sure" on each of four taps is how people start tapping through. Undo PATCHes the previous status (the route already permits it); a push already sent is not retracted, and the plan says so.
- **"Grant" leaves the player copy** (10 strings) for "the stringer" / neutral phrasing. Beat passing the stringer's name through the player projection: `docs/roles.md` strips the stringer on purpose and a `requested` job has none.
- **Light-theme ink moves to `--accent-dark` where accent sat on a tint.** `--segment-active-text` and `.cc-btn-primary` light both read `#15803d`; `#166534` measures ≥ 4.7:1 on both tints. The amber banner title moves to `#9a4408` (≥ 5.9:1 on `--banner-orange-solid` light). Same class on the Command Center's "Finalize cost" and "Set up" is fixed by the same line.

## Shape

| Piece | File |
|---|---|
| Sheet resets on open | `components/stringing/RequestStringingSheet.tsx` |
| Every open racket listed | `components/stringing/StringingCard.tsx` |
| New-request push (recipients, payload, call) | `lib/stringingRequestNotify.ts`, `lib/pushMessages.ts`, `app/api/stringing/requests/route.ts` |
| Requests + overdue in "need you", bench row first with a count | `lib/useAdminNeedsYou.ts`, `components/admin/CommandCenter/CommandCenter.tsx` |
| `requested` player stage | `lib/stringing.ts`, `components/stringing/StringingSteps.tsx`, `StringingCard.tsx`, `messages/*.json` |
| Copy: intake fallback and button, stringer status words, sheet subtitle, "Grant" | `messages/en.json`, `messages/zh-CN.json`, `components/stringing/StringerJobsCard.tsx` |
| Stringer undo + due date | `components/stringing/StringerJobsCard.tsx` |
| Ready-by on the detail screen | `components/admin/CommandCenter/StringingJobDetail.tsx` |
| Light-theme tokens | `app/globals.css` |
| Bench order + set-up fold | `components/admin/CommandCenter/StringingPage.tsx` |
| Tap-target minimums | `StringingPage.tsx`, `StringingJobDetail.tsx`, `PricingCard.tsx`, `StringingCard.tsx` |
