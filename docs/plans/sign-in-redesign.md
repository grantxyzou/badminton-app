# Sign-in redesign: one layout, thumb-reach buttons, and "Is that you?" without an organiser first

**Track:** members-only (`docs/plans/members-only.md`) and its onboarding step, `docs/plans/one-way-in.md` — how a new person gets in and how a member gets back in
**Status:** in-flight
**Review on:** 2026-12-18 — since the redesign shipped, did any member who forgot a PIN or changed phone need an organiser to get back in, and did any newcomer stall between "Check your email" and "Request sent"?

## Problem

The "BPM Sign-Up Review Report" (an outside review, 18 Nov) walked every way in and back in. Checked against the code, five findings were true, four partly true and one already decided (the design canvas, page "Sign-up · review 18 Nov", board "The report, checked against the code"). The ones that matter most:

- A member who forgets a PIN can only be let back in by an organiser, and the ask lapses within an hour.
- Wrong PINs give no sign that the account is paused (decided 9 Nov, `pin-retirement.md` step 6, not built).
- The name step does not say what the name is for.
- Sign-out leaves the app open with nobody signed in, so the old three-door screen and Profile's name-and-PIN form appear: two front doors.
- `bpm.grantzou.com` with no path is a 404.

Grant, on the canvas, 19–20 Nov:

- "A log in screen should be clean and easy."
- "Take out the card. The UI input and buttons should take on the Liquid Glass bring the entire thing down to the bottom of the phone. I should not need to trace that far with my thumb"
- "The title should always be on the same height. Same spacing btw texts. CTA button should not jump around too. Apply this rule for all sign-in paths"
- "Request shouldn't be a long wait time"
- "Scan then ask the email, name, then approval stage. Code is uselss right?"
- "how to remove manual approval but get player verfication?"

## Kill criterion

- **A member who changed phone or forgot a PIN still needs an organiser.** If by the review date anyone with a PIN or a second signed-in phone reached the organiser step, the ladder is not doing its job.
- **Or a newcomer stalls in the new flow.** If the share of accounts that verified an email code but never asked to join rises above what it was before the redesign (`clubMetrics`, accounts in no club with no ask), the screens lost someone and need another look.

## Non-goals

- No new way to sign in (Apple, Google and the email code are enough; the report agrees).
- No emailed PIN reset: a PIN-only account has no email on file (`pin-retirement.md`, 9 Nov).
- No PIN offered to anyone new (7 Nov).
- No more than the club's name shown to someone signed out.

## Decisions

- **One layout for every sign-in screen** (Grant, 20 Nov). The title sits at the same height on every screen, a step marker has its own reserved line above it, text keeps a fixed rhythm, and the lowest button sits in the same place with the small-links line always reserved under it, so nothing moves from screen to screen. Logo screens keep the launch screen's lockup at one height. *Beats* each page laying itself out, which put the button anywhere from mid-screen to the bottom.
- **No card; filled fields; glass only on buttons you press** (19 Nov). Apple's and Google's buttons follow their own brand rules (white, black Apple mark; white, `#747775` edge, colour G), not the glass.
- **The phone's own sign-in first**: Apple first on an iPhone, Google first on Android, email last. No "recommended" label.
- **Organizer and club** in every sign-in string (Grant: the Canadian spelling).
- **Join a club scans the club's QR code first**, with "Paste a link" as the quiet way. The scanner is the stocktake's (`lib/barcodeScanner.ts`), reading QR codes too, behind the same camera gate, so a store build without the camera permission offers Paste a link only.
- **A request stays open for 3 days, not 14** ("Request shouldn't be a long wait time"), and every waiting screen says so. An ask that runs out reads "Not this time", the same as one an organizer declined; the app already treats both as `closed`.
- **Codes a person types are gone except the one in the email.** The typed club code was retired 13 Nov; the organizer's 6-digit code leaves the screens with step 3, once the ladder below replaces it.
- **"Is that you?" checks in this order** (Grant, 20 Nov): the PIN; else any phone where that person is still signed in, which asks "Someone is signing in as you on a new phone. Is this you?" (as Google and WhatsApp do); and only if both fail, an organizer who knows them. *Beats* the organizer first (most people never need one) and *beats* no organizer at all (someone who forgot the PIN and lost their only phone would lose their history).
- **Sign-out reloads to Welcome**, and the screens it used to leave behind (the old three-door screen, Profile's signed-out form) go.

## Shape

Three pull requests, each safe alone.

| Step | What | Where |
|---|---|---|
| 1 | The layout, every sign-in screen, the QR scanner, 3-day requests, sign-out reload, `/` → `/bpm` | `components/onboarding/AuthStage.tsx`, `SignedOutShell.tsx`, `DoorJoinPage.tsx`, `WaitingAsks.tsx`, `components/auth/*`, `lib/barcodeScanner.ts`, `lib/joinRequests.ts`, `next.config.js` |
| 2 | The PIN countdown, the same for every name | `lib/pinLockout.ts`, `app/api/players/recover`, `app/api/admin`, `app/api/members/me`, `SignInForm`, `AdminSignInCard`, `RecoveryPinSheet` |
| 3 | "Is that you?": another phone, then an organizer | `lib/joinRequests.ts`, a new approval route, Home's prompt, `AccessRequestsCard` |
