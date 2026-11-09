# Retire PIN sign-in for existing members

**Track:** P1.5/A2 — identity recovery bridge (ROADMAP §4). Also closes the narrowed "a recovery code can take over a rank" risk in `docs/plans/claim-your-name.md`.
**Status:** intent
**Review on:** 2026-12-07 — how many ACTIVE members are still PIN-only (the sign-in readiness read), and did anyone need a recovery code because of this change? Under half moved, or anyone locked out by it, means stop and rethink (Kill criterion).

## Problem

Grant, 2026-11-05 (`docs/plans/door-link.md`): "start phasing out sign in with a pin either SSO or Email + Password (min 8 characters with upper and lower case combo + number + special character)." The door link stopped OFFERING a PIN to new people on 2026-11-07, and named the rest as its own plan: "Retiring PIN sign-in for existing members is its own plan, with its own migration and kill criterion." This is that plan.

Grant, 2026-11-09: "should we let people get their pin and account back via email and verification or phone text?" The answer that came out of it is the reason for this plan's order:

- **A PIN member who forgets it can only get back in through someone else.** Email reset exists (`POST /api/auth/forgot-password`), but only for an account with an email and password; a PIN account has no email on file. Its ways back are an admin-issued recovery code or asking to be let in again.
- **That makes recovery codes a way to take over a rank.** Redeeming a code from `POST /api/players/reset-access` signs in as the person it was issued for, admin cookie and all. Since #801 (2026-11-05) only an organiser may issue one for an organiser or admin (`organiser_only`), but one organiser can still take over another, and nothing tells the person a code was issued for them. An organiser who signs in with Google, Apple or email can recover alone, so they rarely need a code at all.
- **A four-digit PIN is ten thousand guesses.** The per-account lock (`lib/pinLockout.ts`) holds that line today; Google, Apple and a policy-checked password don't need it.

Nobody has reported being locked out yet. The pressure is the takeover risk and Grant's direction, not a complaint.

## Kill criterion

Stop and rethink (not push harder) if, at the review date:

- **Under half of the PIN-only active members have added Apple, Google or an email.** The ask isn't landing, and turning PIN off would strand the rest; the likelier fix is the password policy or the prompt, not the deadline.
- **Anyone needed a recovery code BECAUSE of this change** — a member who lost their way in after a step here, rather than one who forgot a PIN as people always have. One case means the step that caused it is undone first.

## Non-goals

- **Text-message (SMS) recovery.** Decided against on 2026-11-09: a per-message cost and carrier registration, SIM-swap makes it the weakest recovery route, and it would bring phone numbers into the privacy policy, account deletion and the response strip-canaries. Nearly every phone is already signed into Apple or Google.
- **Emailing a PIN reset.** That would mean collecting emails and maintaining a reset path for a sign-in method being retired. Moving the person onto email (or Apple/Google) gives them email reset for free.
- **Email sign-in links ("magic links").** Possible later; not needed to retire the PIN.
- **Deleting `pinHash` from member docs.** The schema rule is additive-only (a rollback runs older code against the same database). Turning PIN off means the code stops READING it; clearing the stored hashes is a separate, later step once no rollback target reads them.
- **Changing the password policy.** It is Grant's call as stated above; this plan only watches whether it is what keeps people on PIN (Kill criterion).

<!--
Everything above is written BEFORE the work and is the gate for starting it.
Everything below is appended AS the work proceeds.
-->

## Decisions

Proposed, for Grant to confirm before step 1 starts. Each one names the alternative it beats.

1. **Measure first, by club.** `readSignInReadiness` (`lib/signInReadiness.ts`, behind the async admin check in `GET /api/admin/sign-in-readiness`) gains a `pinOnly` list beside `cannotSignIn`: active members whose ONLY method is a PIN. That is the denominator for the kill criterion and the admin's to-do list. *Beats* counting from the nudge's dismissals, which says who saw a prompt, not who moved.
2. **Rank-holders go first, and can't dismiss it.** An organiser or admin who is PIN-only sees "Keep your account" in the console until they add a method; members keep today's dismissible nudge (`lib/authNudge.ts`) with the cooldown cut from 30 days to 7 for the phase-out. *Beats* one rule for everyone: the takeover risk is about rank-holders, and nagging thirty players to protect three organisers is backwards. **Open:** Grant may prefer the members' cooldown left at 30 days.
3. **The console signs in without a PIN before anything is turned off.** `AdminSignInCard` (`components/admin/AdminSignInCard.tsx`) is "your name and your own PIN" (`POST /api/admin`) today. `completeSignIn` (`lib/authSession.ts`) already mints an `admin_session` for an organiser or admin on ANY sign-in, so the card offers Google, Apple and email beside the PIN. *Beats* leaving it: an admin whose console cookie lapses after step 5 would have no way back into the console.
4. **Then a code for a rank-holder tells them, and waits.** The organiser-only rule is already in place (#801). What it lacks is the person's say. Grant asked (2026-11-09) why a code can't be issued only when the organiser asks for it. A request alone proves nothing: the person who has lost their way in is signed out, so the request comes from a signed-out phone that anyone, the issuing organiser included, can make in their name. What does work is telling them through a channel the issuer doesn't control, and giving them time to say no:
   - **Tell them at once**: a push and a notice to their own devices (`lib/push.ts`, `lib/notices.ts`; push devices survive a sign-out by design), and a line on every organiser's console, naming who issued it.
   - **The code works only after a wait** (24 hours proposed) for anyone holding a rank; a member's code works at once, as today.
   - **"Not me" voids it**: from any device the person is still signed in on.
   - **So the sign-out moves from ISSUE to REDEMPTION** for a rank-holder. Today issuing a code signs every device out at once (`signOutEverywhereIn`), which would sign the real person out of the very devices they'd tap "Not me" on.
   - **A lone organiser who has lost every way in** goes to the operator (`isOperator`, `lib/operator.ts`), who issues the code under the same wait.

   *Beats* requiring a request first (proves nothing, as above), and *beats* requiring a second organiser (a club with one organiser could never recover). **Open:** the length of the wait.
5. **Stop new PINs for people who have none.** Profile's "New PIN" row and the first-PIN branch of `PATCH /api/members/me` stop offering one; "Update PIN" stays for a PIN holder until step 6. The door already stopped offering it (2026-11-07).
6. **Turn PIN sign-in off on a date Grant sets** after the review, not on a date written now. Every PIN check (`POST /api/admin`, `POST /api/players/recover`'s PIN path, `auth/claim-name`, `members/me`) answers with a pointer to Apple, Google or email; a remaining PIN-only member gets back in with a recovery code and lands on "Keep your account". *Beats* a fixed deadline: the kill criterion decides whether there should be one at all.

## Shape

| Piece | File |
|---|---|
| Who is PIN-only (step 1) | `lib/signInReadiness.ts`, `app/api/admin/sign-in-readiness/route.ts` |
| The ask, and its cooldown (step 2) | `lib/authNudge.ts`, `app/api/auth/methods/route.ts`, `components/auth/KeepAccountPage.tsx` |
| Console sign-in without a PIN (step 3) | `components/admin/AdminSignInCard.tsx`, `app/api/admin/route.ts`, `lib/authSession.ts` |
| Recovery codes for rank-holders: tell, wait, "Not me" (step 4) | `app/api/players/reset-access/route.ts`, `app/api/players/recover/route.ts`, `lib/memberRecoveryCode.ts`, `lib/notices.ts`, `lib/push.ts`, `lib/operator.ts` |
| No new PINs (step 5) | `app/api/members/me/route.ts`, `lib/useHasPin.ts` |
| PIN sign-in off (step 6) | `app/api/admin/route.ts`, `app/api/players/recover/route.ts`, `app/api/auth/claim-name/route.ts`, `lib/pinLockout.ts` |
| Email reset that already exists | `app/api/auth/forgot-password/route.ts` |
