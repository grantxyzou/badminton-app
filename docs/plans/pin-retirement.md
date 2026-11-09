# Move PIN members onto Apple, Google or email (PIN stays as a fallback)

**Track:** P1.5/A2 — identity recovery bridge (ROADMAP §4). Also closes the narrowed "a recovery code can take over a rank" risk in `docs/plans/claim-your-name.md`.
**Status:** intent
**Review on:** 2026-12-07 — how many ACTIVE members are still PIN-only (the sign-in readiness read), and did anyone need a recovery code because of this change? Under half moved, or anyone locked out by it, means stop and rethink (Kill criterion).

**Grant, 2026-11-09: PIN sign-in is NOT switched off.** "Pin sign-in is it secure? We should keep it just incase." So this plan moves people onto a way they can recover by themselves, hardens the PIN, and keeps it as a fallback. The original step 6 (turn it off) is withdrawn; see Decision 6.

## Problem

Grant, 2026-11-05 (`docs/plans/door-link.md`): "start phasing out sign in with a pin either SSO or Email + Password (min 8 characters with upper and lower case combo + number + special character)." The door link stopped OFFERING a PIN to new people on 2026-11-07, and named the rest as its own plan: "Retiring PIN sign-in for existing members is its own plan, with its own migration and kill criterion." This is that plan.

Grant, 2026-11-09: "should we let people get their pin and account back via email and verification or phone text?" The answer that came out of it is the reason for this plan's order:

- **A PIN member who forgets it can only get back in through someone else.** Email reset exists (`POST /api/auth/forgot-password`), but only for an account with an email and password; a PIN account has no email on file. Its ways back are an admin-issued recovery code or asking to be let in again.
- **That makes recovery codes a way to take over a rank.** Redeeming a code from `POST /api/players/reset-access` signs in as the person it was issued for, admin cookie and all. Since #801 (2026-11-05) only an organiser may issue one for an organiser or admin (`organiser_only`), but one organiser can still take over another, and nothing tells the person a code was issued for them. An organiser who signs in with Google, Apple or email can recover alone, so they rarely need a code at all.
- **A four-digit PIN is ten thousand guesses, and people pick the same few.** The per-account lock (`lib/pinLockout.ts`: 5 free tries, then 1 minute doubling to an hour) holds a stranger to about 33 guesses a day per account, so the whole space takes most of a year. But published PIN studies find about a quarter of people choose one of the twenty most common PINs (1234 alone is around one in ten, [DataGenetics](https://www.datagenetics.com/blog/september32012/)), and names are enumerable, so those 33 guesses break roughly a quarter of PIN accounts on the first day. The same guesses also lock the real person out.

Nobody has reported being locked out yet. The pressure is the takeover risk and Grant's direction, not a complaint.

## Kill criterion

Stop and rethink (not push harder) if, at the review date:

- **Under half of the PIN-only active members have added Apple, Google or an email.** The ask isn't landing, and the takeover and recovery problems stay with everyone left; the likelier fix is the password policy or the prompt.
- **Anyone needed a recovery code BECAUSE of this change** — a member who lost their way in after a step here, rather than one who forgot a PIN as people always have. One case means the step that caused it is undone first.

## Non-goals

- **Text-message (SMS) recovery.** Decided against on 2026-11-09: a per-message cost and carrier registration, SIM-swap makes it the weakest recovery route, and it would bring phone numbers into the privacy policy, account deletion and the response strip-canaries. Nearly every phone is already signed into Apple or Google.
- **Emailing a PIN reset.** That would mean collecting emails and maintaining a reset path for a sign-in method being retired. Moving the person onto email (or Apple/Google) gives them email reset for free.
- **Email sign-in links ("magic links").** Possible later; not needed to retire the PIN.
- **Turning PIN sign-in off, and deleting `pinHash`.** Grant's call, 2026-11-09: keep it as a fallback.
- **Changing the password policy.** It is Grant's call as stated above; this plan only watches whether it is what keeps people on PIN (Kill criterion).

<!--
Everything above is written BEFORE the work and is the gate for starting it.
Everything below is appended AS the work proceeds.
-->

## Decisions

Proposed, for Grant to confirm before step 1 starts. Each one names the alternative it beats.

1. **Measure first, by club.** `readSignInReadiness` (`lib/signInReadiness.ts`, behind the async admin check in `GET /api/admin/sign-in-readiness`) gains a `pinOnly` list beside `cannotSignIn`: active members whose ONLY method is a PIN. That is the denominator for the kill criterion and the admin's to-do list. *Beats* counting from the nudge's dismissals, which says who saw a prompt, not who moved.
2. **Rank-holders go first, and can't dismiss it.** An organiser or admin who is PIN-only sees "Keep your account" in the console until they add a method; members keep today's dismissible nudge (`lib/authNudge.ts`) with the cooldown cut from 30 days to 7 for the phase-out. *Beats* one rule for everyone: the takeover risk is about rank-holders, and nagging thirty players to protect three organisers is backwards. **Open:** Grant may prefer the members' cooldown left at 30 days.
3. **The console signs in without a PIN.** `AdminSignInCard` (`components/admin/AdminSignInCard.tsx`) is "your name and your own PIN" (`POST /api/admin`) today. `completeSignIn` (`lib/authSession.ts`) already mints an `admin_session` for an organiser or admin on ANY sign-in, so the card offers Google, Apple and email beside the PIN. *Beats* leaving it: an organiser who moves to Google, Apple or email should not need a PIN to reach the console, or step 2 asks them to give up the one thing the console takes.
4. **Slack's rule: you can only act on an account ranked BELOW yours.** Grant, 2026-11-09, on a first draft that added a waiting period and a "Not me" button: "no, look up what slack does." What Slack does ([Reset your password](https://slack.com/help/articles/201909068-Reset-your-password), [Change a member's email address](https://slack.com/help/articles/225531168-Change-a-members-email-address), [Transfer ownership](https://slack.com/help/articles/204401633-Transfer-ownership-of-a-workspace-or-org)):
   - **Nobody resets another person's password.** "Administrators can't reset or change passwords." A member recovers through their own email.
   - **What an owner or admin CAN do is change the email on the account**, and only on one ranked below them: "you will only be able to make changes to a member's account if you have a higher permission role than them." The new address is confirmed by a link sent to it.
   - **The top of the ladder goes to Slack itself.** Nobody in a workspace outranks its Primary Owner, so a locked-out Primary Owner goes to Slack Support, under review.

   For BPM, the ladder is member < admin < organiser < operator (`isOperator`, `lib/operator.ts`):
   - **Now, on recovery codes**: an admin may issue one for a member; an organiser for a member or an admin; a code for an ORGANISER only the operator issues. #801 already stopped an admin issuing for a rank-holder; what changes is that one organiser can no longer issue for ANOTHER organiser, an equal, which was the takeover left open. Your own code stays yours. A lone organiser who has lost every way in goes to the operator, Slack's Support step.
   - **For a member with an email on file, Slack's email change replaces the code**: the higher-ranked person sets the email on the account, the person confirms it from that inbox and resets their own way in. Nobody but the person ever holds a working credential for them, which a recovery code (handed to the ISSUER) never guaranteed. A PIN-only member, who has no email, still gets a code, under the same ladder.

   *Beats* a waiting period with a "Not me" button (the first draft): more moving parts, and it still let one organiser start a takeover of another. *Beats* requiring the person to ask first: their request comes from a signed-out phone anyone can use in their name, so it proves nothing.
5. **Offer a PIN to people who have none? Open, since Grant chose to keep PIN.** The door stopped offering one to new people on 2026-11-07 (Grant, 2026-11-05). With PIN kept "just in case", Grant decides whether Profile's "New PIN" row stays as a fallback anyone can add (behind the step 6 rules) or goes, leaving PIN to the people who already have one.
6. **PIN sign-in stays; it gets harder to guess instead** (Grant, 2026-11-09: "We should keep it just incase", replacing "turn it off on a date"). Setting or changing a PIN (`PATCH /api/members/me`, `lib/useHasPin.ts`'s sheet) refuses the commonest choices: the top-100 list from the PIN studies, one digit repeated (`1111`), a straight run (`1234`, `9876`) and a year from 1940 to the current one, with a message that says why. Existing PINs are not reset; the "Keep your account" prompt is how their owners move. *Beats* turning it off (Grant wants the fallback) and *beats* six digits (every member retypes, and the lockout already makes length the smaller lever: the risk is the common choices, not the count). **Open:** whether a member whose account gets locked by wrong guesses should get a push saying so.

## Shape

| Piece | File |
|---|---|
| Who is PIN-only (step 1) | `lib/signInReadiness.ts`, `app/api/admin/sign-in-readiness/route.ts` |
| The ask, and its cooldown (step 2) | `lib/authNudge.ts`, `app/api/auth/methods/route.ts`, `components/auth/KeepAccountPage.tsx` |
| Console sign-in without a PIN (step 3) | `components/admin/AdminSignInCard.tsx`, `app/api/admin/route.ts`, `lib/authSession.ts` |
| Only act on a lower rank; organisers go to the operator (step 4) | `app/api/players/reset-access/route.ts`, `lib/operator.ts`; after step 6 the email change, `app/api/auth/forgot-password/route.ts` |
| No new PINs (step 5) | `app/api/members/me/route.ts`, `lib/useHasPin.ts` |
| Refuse common PINs (step 6) | `app/api/members/me/route.ts`, `lib/pinLockout.ts` |
| Email reset that already exists | `app/api/auth/forgot-password/route.ts` |
