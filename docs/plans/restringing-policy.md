# Restringing policy: what the club and its stringers are, and are not, responsible for

**Track:** North Star pillar 4 (equipment service). Card payments for restrings are live (`docs/plans/card-pay-prototype.md`), so a restring is now a paid service with a written refund line (#940) and no written service terms.
**Status:** intent
**Review on:** 2026-12-16 — Build the four pieces below, some of them, or none? And which frame-breakage outcome (Decision 1)?

## Problem

Grant, 2026-11-16: "can we also add a terms of use for requesting restringing? How do I protect myself, stringers to ensure no liability when racket break, or people claiming we damanged it?"

Three ways it goes wrong today, none of which has happened yet:

1. **A frame breaks on the machine.** It happens to old frames with a crack nobody could see, and to frames strung tighter than they are rated for. Nothing in the app says what the player gets, or that the stringer does not owe them a racket.
2. **"You damaged it."** A player finds a crack, a chipped grommet or a scuffed bumper after pickup. Nothing records what the racket looked like when the stringer took it.
3. **Tension above what the frame is rated for.** The request sheet allows 20 to 32 lb for any racket (`TENSION_MIN_LB` / `TENSION_MAX_LB` in `lib/stringing.ts`), while many frames are rated to 28 or 30. The catalog knows each frame's rating (`attributes.tensionMaxLbs`, read by `app/api/stringing/fit/route.ts`), and the request ignores it.

The terms page (`app/legal/terms/page.tsx`, copy under `legal.terms` in `messages/en.json` and `messages/zh-CN.json`) says nothing about stringing.

## What shops do (research, 2026-11-16)

Only one Vancouver-area shop has its stringing terms online. The rest are from elsewhere, and they all say much the same.

- **Graybar Badminton, Richmond BC** (graybarbadminton.ca/stringing-services). They inspect the frame, material and paint before stringing. They refuse a cracked frame, and refuse a tension above the racket's recommended limit. Customers confirm the racket and strings at pickup: "Once confirmed, Graybar will not be responsible for any subsequent string breakage or racquet damage." In a dispute, Graybar decides.
- **Racquet Network, Calgary.** Tension above the frame's maximum needs a signed waiver, and there's no warranty on the frame or string. Nearly every frame that broke in their shop was a knock-off.
- **McKinney and DFW badminton centres, US.** They give no warranty or liability. Used frames can have hidden microfractures, and a frame may be declined after a visual inspection, with a refund.
- **Joy Badminton, US.** They're not liable for strings that break during the service, or for tension outside the maker's range.
- **Badminton Alley, US.** Damage from the normal stringing procedure is not their responsibility.

The pattern:
- inspect first and refuse what looks damaged;
- no payment for the frame;
- tension above the rating is the player's risk;
- the racket's condition is agreed at pickup, and after that the shop isn't responsible.

## Kill criterion

- A player is refused a fair outcome because of these terms (a stringer's clear mistake, such as a dropped racket, waved away by "not responsible"). That means the wording reaches too far and must be narrowed. The terms limit liability "to the extent the law allows"; BC consumer law does not let a service exclude its own negligence outright.
- The agreement line or the tension warning makes requests drop. Compare requests per week for the 4 weeks before and after.
- The condition check is skipped. If over half of received jobs in the first month carry no check, the step is in the wrong place, or is too slow, and should move or go.

## Non-goals

- Lawyer-grade terms. This is a club's plain-language policy; for real protection, have a BC lawyer read the final wording.
- A signed waiver or e-signature flow.
- Photos of the racket. That needs file storage the app doesn't have; a note is the first step.
- Refusing tension above the rating outright. Warn and record instead (Grant, 2026-11-16).
- Walk-up jobs filed by a stringer (`POST /api/stringing/jobs`). The person is standing there, so the stringer tells them. The terms still apply, but nothing is recorded in the app.
- Insurance.

## Decisions

1. **What the player gets when a frame breaks on the machine.** OPEN. Grant asked for "real examples" first, and they're above.
   - **Recommendation: no charge for the job, and the racket comes back as it is.** The club and the stringer don't pay for the frame. This is the norm: a refund where a shop refunds, "not responsible" everywhere.
   - Other options: a free restring next time, as goodwill; or charge only for the string used.
2. **How a player agrees.** Grant asked: "Can we imply by using BPM?" Partly.
   - Terms only on a separate page are the weakest form. A court asks whether the person had a fair chance to see them.
   - **Plan: one line under the request's Send button, with no tick-box.** "By sending, you agree to the restringing policy", linking to the terms page's Restringing section. The job records the date and the policy version.
   - It costs no tap, and every job carries proof that the notice was on screen when the player asked.
   - The alternatives were a tick-box on every request (the strongest, but one more tap) or the terms page alone (the weakest).
3. **The stringer records the racket's condition when they take it** (Grant, 2026-11-16: "Yes, a quick note").
   - When the stringer marks a job received, they tap "Looks fine" or write what they see (a crack, a dent, a broken grommet).
   - If they note damage, the player is told before any work.
   - The note stays on the job and the player sees it. This answers "you damaged it".
4. **Tension above the frame's rating: warn, confirm, record** (Grant, 2026-11-16: "Warn and ask to confirm").
   - When the racket is a catalog frame with a `tensionMaxLbs`, a request above it shows "Your <racket> is rated up to N lb. Above that the frame can break, and it isn't covered". The player either lowers the tension or confirms.
   - The confirmation is stored on the job, and the stringer sees it on the card.
   - A typed-in racket the catalog doesn't know gets no check.

## Shape

What would be built, if Grant says go. Nothing below exists yet.

| Piece | Where |
|---|---|
| A "Restringing" section on the terms page, in English and Chinese: inspection; refusing damaged frames; what happens when a frame breaks (Decision 1); tension above the rating is the player's risk; check the racket at pickup; the player's own string; liability limited to the job's price, to the extent the law allows. The terms date moves. | `legal.terms.sections` in `messages/en.json` and `messages/zh-CN.json` |
| The agreement line under Send, linking to the section | `components/stringing/RequestStringingSheet.tsx` |
| The job records which policy version the player agreed to, and when (additive, optional) | `StringingJob` in `lib/types.ts`; written by `app/api/stringing/requests/route.ts` |
| The tension check on the SERVER: find the member's kit racket by label, point-read its catalog frame and compare. Above the maximum without a confirmation answers 409 `over_frame_max` with the rated maximum; with one, the job records it. | `app/api/stringing/requests/route.ts` (the catalog read as in `app/api/stringing/fit/route.ts`) |
| The warning step: on that 409, the sheet offers "Lower to N lb" or "String at X lb anyway" | `components/stringing/RequestStringingSheet.tsx` |
| The condition check: "Mark received" opens a short step, "Looks fine" or a note. The PATCH carries it with the status; a stringer who isn't an admin may send it with `status` alone. | `app/api/stringing/jobs/[id]/route.ts`; the bench and the stringer's card (`components/stringing/JobCard.tsx`, `components/stringing/StringerJobsCard.tsx`) |
| The player sees the condition note on their job, and a push if damage was noted (no money in it) | the player's job view; the push copy beside the other stringing pushes |
| Tests: the 409 and the confirmed path; the version stamp; the condition PATCH for a stringer, and its refusal with other fields; the terms shape (`__tests__/legal-pages.test.ts`) | `__tests__/` |
