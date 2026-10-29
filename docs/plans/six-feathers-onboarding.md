# Six Feathers — onboarding a club that runs its week in WhatsApp

**Track:** multi-group critical path — "a SECOND club created and run through one session end to end" (CLAUDE.md, Groups; `docs/plans/multi-group.md`). Six Feathers is the first real candidate for that step.
**Status:** in-flight
**Review on:** 2026-11-30 — has Ian seen the demo, and if he said yes, has Six Feathers run a Saturday on BPM? If he said no, or nothing has run, close this file and keep only PR 2 (claiming a name), which every second club needs.

## Problem

Six Feathers Badminton plays Saturdays on four courts. The organiser is Ian, and the club has about 35 members plus drop-ins. Grant is one of the members. The whole week runs in a WhatsApp group as one numbered list that everyone copies, edits and reposts. The organiser's own rules, quoted from the chat export Grant shared on 2026-10-28 (contact details left out):

- *"Going forward, I'll post the previous week's list each Sunday with drop-in names removed. If you can't make it, please remove your name as soon as possible, and no later than Wednesday at noon or you have to pay for your spot."*
- *"You're welcome to bring friends. Please add their name(s) to the waitlist as soon as it is posted."*
- *"As members, you have priority for a spot each Saturday and pay a lower rate than drop-in players. Please keep at least $50 in your account. … The flat rates are $20 for the members and $22 for the non members."*
- *"The member-priority registration deadline is 11:59 p.m. every Monday … Starting every Tuesday, if any spots remain available, we will move waitlisted players to the confirmed list in order."* (posted in English and Chinese)
- *"If we got 5 more people, I will get 1 more court."*
- *"Hi all, just copy and paste when you want to add or remove please."*

The chat shows what the copy-paste costs:
- About ninety full reposts of the list in eighteen days.
- A stale paste that blanked two people who were on the list.
- Two waitlist lines both numbered "1.".
- A header that named the wrong date.

Nobody in the club has asked for an app. Ian has not been asked yet. This is Grant's read of a problem he sees every week as a member.

## Kill criterion

- Ian sees the demo (PR 1) and says no. Stop after PR 2, which every second club needs anyway.
- Or Six Feathers has not run two Saturdays on BPM by 2026-12-02. That is the same date as `docs/plans/pricing.md`'s review, which asks whether any outside club has held a second session.

## Non-goals

- **Money, for the pilot.** Flat member and drop-in rates, the prepaid $50 balance, charging a late cancel, and charging a guest to their host all stay with Ian until the list part is proven. Each has a known bridge (see Decisions).
- A per-club link preview. `app/opengraph-image.tsx` shows BPM Core on purpose, and a per-club card needs a per-club URL first.
- Replacing WhatsApp. The chat stays the broadcast, and the app becomes the one copy of the list.

## Decisions

- **Pitch before building the club's rules** (2026-10-28, Grant's choice: "Ian hasn't been asked"). PR 1 is only what a demo needs: a seeded copy of the club, plus the list as chat text. PRs 3–6 wait for Ian.
- **List only in the pilot** (Grant: "List only at first"). The bridges for later, found while mapping the code:
  - Flat rates: a `pricing` mode in `GroupSettings` that settle reads per row.
  - A top-up from an e-transfer: a third `resolvePayment` kind that writes credit with `grantCredit` under id `topup:<paymentId>`.
  - Deducting at settle: `payWithCredit`.
  - Low-balance nudges: a new check in the daily `POST /api/payments/remind` run.
  - Late cancels: settle reads rows stamped `lateCancel`.
- **The chat format is the spec for the copied list.** The text keeps open spots as empty numbers, because that is how the chat reads "how many are left", and a numbered waiting list. The order is `compareBySignup`, the one the capacity check uses, so the text and the app never disagree. It is English only, like every admin surface.
- **Six Feathers is a real club with its own settings, not a demo** (Grant, 2026-10-29: "Treat the real demo club as a real group just with different setting configuration on how the group run this will help BPM long term too scale for different management style"). Every rule the club runs by is a per-club setting (`GroupSettings.run`, `lib/clubRun.ts`), and a **style** fills them in: `first_come` is BPM, `members_first` is Six Feathers, and any hand edit makes a club `custom`. Grant creates the production club and owns it; Ian becomes an admin when he agrees (handing over ownership is not built). The roster goes in with the real names from the chat — names only, no phone numbers or e-transfer address. A setting joins the model in the PR that makes it do something, and the styles carry only those.
- **The demo seed uses famous players' names, never the club's.** The fixture-name rule in CLAUDE.md applies twice over here: Grant knows these people.

## Fit, as found in the code (2026-10-28)

| Six Feathers | BPM today | Gap |
|---|---|---|
| A separate club with co-organisers | Multi-group is on: create a club, one roster per club, admins per membership | none |
| A weekly list, a waitlist, a cap | `POST /api/players`, `lib/capacity.ts` | none |
| "Remove your name by Wednesday noon" | `lateCancelHours` and `lib/cancelPolicy.ts` warn the player and tag the cancel "Late" | none for the pilot. A count of hours equals a weekday cutoff while the session time is fixed |
| Chinese | zh-CN on every member screen | admin screens and the sign-up share text are English only |
| Last week's list, drop-ins removed | advance copies nobody (`app/api/session/advance/route.ts`) | PR 3 |
| Member vs drop-in | `Membership.role` is about permissions only | PR 3 |
| Members-first until Monday, waitlist moves Tuesday | promotion is an admin tap | PR 4 |
| Guests, written "Jenny (Josh)" | a member can sign up only themselves | PR 5 |
| Courts × 8 | `Session.courts` and `maxPlayers` are separate | PR 6 |
| One list, not ninety copies | no text of the roster existed | PR 1 |

**Onboarding blockers:**
- **One invite per person.** Bringing 35 people in takes 35 one-time invites, at 30 an hour per IP, and each invitee needs email, Google or Apple to sign up (`lib/invites.ts`).
- **Names the admin adds by hand are stuck.** Signed out, "I play here already" resolves the name in BPM: `app/api/members/access-request/route.ts` and `app/api/auth/claim-name/route.ts` use `resolveGroupId`, which falls back to BPM. Pre-adding a name also makes that person's invite sign-up answer `name_taken` (`app/api/auth/signup/route.ts`). This is open as Phase 6 of `docs/superpowers/plans/2026-09-07-multi-group.md`.

**A list-only club will see "N unpaid this session" in Needs you** (`components/admin/CommandCenter/NeedsYouCard.tsx`), because nobody ever settles a session that has no cost. Seen on the demo seed. Answered by the `money: 'off'` setting (step A below).

## Plan

Revised 2026-10-29: these rules ship as settings any club can choose, and Six Feathers is created in production with the "Members first" style. The order:
- **A** (shipped): the model, "How your club runs", players per court, and money off.
- **B**: paste a roster, marking members and drop-ins.
- **C**: claim a pre-added name.
- **D**: last week's list carries over.
- **E**: the members-first window, and the waitlist moving up.
- **F**: guests.

The original order follows for the record.

1. **PR 1, the pitch kit (this change).**
   - This file.
   - The `SEED_DEV_SCENARIO=six-feathers` seed (`lib/cosmos.ts`): a second club, 32 on a 4-court Saturday, three drop-ins waiting, a 72-hour late-cancel window. Sign in as Chong Wei / 1357 for the organiser, or Taufik / 2468 for a member.
   - "Copy list" on the Command Center's session card (`lib/rosterText.ts`).
2. **Gate: Grant shows Ian.**
3. **PR 2: bring your list, claim your name.**
   - Paste a numbered list into the Roster page to pre-add every name.
   - One club claim link that admits only a name already on the roster with no credential, and only after the admin approves. The approval then offers a PIN, so nobody needs an email address.
   - An invite sign-up whose name matches an unclaimed pre-added member attaches to it instead of answering `name_taken`.
4. **PR 3: last week's list.** `Membership.regular` marks who is a regular. `GroupSettings.carryForward` makes advance copy last week's active regulars onto the new session. A push tells them they are on the list and when the cutoff is.
5. **PR 4: members first, then the waitlist moves.**
   - `GroupSettings.priorityHours` sets when the members-first window ends; advance stamps that time as `Session.priorityEndsAt`.
   - Until then, a non-regular lands on the waitlist even when spots are free.
   - After it, the waitlist promotes in order on every cancel and sign-up. The writes are etag-guarded, and each promoted person gets a push.
6. **PR 5: guests.**
   - A member adds `guestName`, at most two per session.
   - The guest has no account and shows as "Jenny (Josh)".
   - The host or an admin cancels.
   - This is a written exception to security rule 13.
7. **PR 6: courts set the cap.** `GroupSettings.playersPerCourt`, plus "N waiting — enough for another court".
8. **After a Saturday has run:** read `leaks` on `GET /api/admin/migrate-groups`, Grant's precondition for the strict-mode step.

## Shape

| piece | file |
|---|---|
| The list as chat text (pure) | `lib/rosterText.ts` |
| "Copy list" | `components/admin/CommandCenter/NextSessionCard.tsx` |
| The demo club | `lib/cosmos.ts` (`seedDevSixFeathers`) |
| Tests | `__tests__/roster-text.test.ts` |
| How a club runs (pure: styles, `clubRunOf`, `parseClubRun`, `capacityForCourts`) | `lib/clubRun.ts` |
| `GroupSettings.run` (additive) | `lib/types.ts` |
| Read and write it | `app/api/admin/settings/route.ts`; members see it through `memberVisibleSettings` in `lib/groupRoutes.ts` |
| The admin screens' reading, current after a save | `lib/useClubRun.ts` |
| "How your club runs" | `components/admin/CommandCenter/ClubRunPage.tsx` |
| Money off: Payments, Money rows, bill actions, "N unpaid" | `components/admin/CommandCenter/CommandCenter.tsx`, `components/admin/CommandCenter/NextSessionCard.tsx`, `lib/useAdminNeedsYou.ts` |
| Spots follow the courts | `components/admin/AdvanceSessionForm.tsx`, `components/admin/CommandCenter/SetupPage.tsx` |
| Tests for the settings | `__tests__/club-run.test.ts`, `__tests__/admin-settings-club-run.test.ts`, `__tests__/components/ClubRunPage.test.tsx`, `__tests__/components/NeedsYouCard.test.tsx` |
