# The club's door link: one poster, every join approved

**Track:** the native shell's App Clip (`docs/plans/native-ios-targets.md`, Reach): the sticker that plan kept "behind the organiser's approval", which the reusable poster turns out to be too. Its web half ships before the clip and helps every phone.
**Status:** in-flight
**Review on:** 2026-12-03 — of the people who joined through the door link, did an organiser ever approve someone they didn't know had asked? One case means stop (see Kill criterion). And did anyone get stuck waiting more than ten minutes?

## Problem

Grant, 2026-11-05, after "Save as image" (#797) shipped: he wants the invite poster to be reusable. The QR on today's poster is a one-time invite, so posted in a group chat it lets in only the first person to scan it. The poster has to say "Works once, for one person", which is exactly what a poster is not for.

The same need was already decided once, for the NFC stickers Grant owns (`docs/plans/native-ios-targets.md`, 2026-11-04): a permanent link is acceptable only behind the organiser's approval. A photo of a poster, or a peeled-off sticker, must not let a stranger in. Both are one feature: a club's **door link**.

Grant's answers on 2026-11-05:

- **Who approves:** organisers only.
- **What a new person gives:** just their name. After they're in, they are NOT offered a PIN. Grant: "start phasing out sign in with a pin either SSO or Email + Password (min 8 characters with upper and lower case combo + number + special character)".
- **Approval joins the club only.** The person taps Sign up themselves.
- **Retire a link:** yes. "New link" makes a new one, and old posters and stickers stop working.

## Kill criterion

- **One approval lets in someone the organiser didn't mean to admit.** The door's whole safety is "an organiser approves a person they can see asked". If that fails once, stop and go back to one-time invites for new people.
- **Or a person waits at the door.** If, in the first month, the median time from asking to approval is over ten minutes, the push isn't reaching organisers. Fix the delivery before building more on the door.

## Non-goals

- **No auto-approval**, no "approve everyone from this link" switch. The approval is the point.
- **Not the App Clip.** The clip later opens the same request natively. This plan is the server and the website.
- **Not the rest of the PIN phase-out.** People already on a PIN keep it, and Log in keeps its PIN path. This plan only stops OFFERING a PIN to a person who came through the door.
- **A taken name is not merged.** If a new person types a name a member already holds, the organiser sees "that name is taken" and asks them to try again with another; the door never attaches a stranger to an existing account. Retiring PIN sign-in for existing members is its own plan, with its own migration and kill criterion.
- **Not a second link per club.** The club already has one reusable link, its claim link (`docs/plans/claim-your-name.md`). The door widens it rather than adding another (see Decisions).

## Decisions

- **2026-11-13 — Two decisions below are reversed** by [`one-way-in.md`](one-way-in.md), not yet built: the account is created BEFORE approval (the person signs in with Apple, Google or an email code, then asks), so "Approval creates the account" and the "Keep your account" step after approval go away for new people; and the organiser approves as a regular or a drop-in. Until that ships, everything below still describes the live code.

- **The door IS the claim link, widened.** The claim link is already one reusable link per club, with "New link", a device-bound ask, a 3-second poll that signs the asking phone in, and a push. What it can't do is admit a NEW name: an ask under a name not on the roster answers the same 200 and does nothing. The door adds that one case. Beat: a separate "door" link beside the claim link. That would be two reusable links per club doing nearly the same thing, and an organiser who printed the wrong one would never know.
- **Its address moves onto the one link, `/bpm/j/<token>`.** That path is already claimed by the iPhone and Android apps (#792), and the App Clip will register on it. A door token and an invite token are both 32 hex characters, so the redirect route stays dumb and the page asks `GET /api/groups/preview` what the token is: an invite (join now) or the door (ask to join). Old `?claim=` links keep working.
- **A new person's request lives on the club, not on a person.** Today's asks are stored on the Member doc (`Member.accessRequests`), and a new person has no Member doc. So a door request is an entry in `Group.joinRequests` on the club's own doc, written under its etag the way invites are claimed. It is capped (open requests per club, and an hour's life, like today's asks), and the request holds only a name, a hash of the device's secret, and its times. Beat: a doc per request in the `groups` container, which would need a query to list a club's requests, and that file is point reads only.
- **Organisers approve, admins don't** (Grant). The push goes to `listOrganisers(groupId)` only, and approving checks the organiser rank (`isAdminAuthedWithMember` answers `organiser`). The inbox card shows requests to admins as "waiting for an organiser", without an Approve button. **That covers every ask through the door, an imported name's included** (Grant, 2026-11-05: "Organisers only"): once the claim link is the poster, one rule for everything that comes through it. An ask made WITHOUT the link (an existing member who forgot their PIN, from Log in) keeps today's rule: any admin of the club.
- **Approval creates the account; the asking phone collects it.** Approve creates the Member, the membership and the name reservation in one step, as an organiser action, so a name taken in the meantime is a clear answer to the organiser, not a silent failure at the door. The asking phone's existing poll then finds the request approved, proves itself with its secret, and is signed in as that member. Single use, as today.
- **After they're in, Home offers a way to keep the account, never a PIN.** Today a person let in by an admin sees "Set a PIN so you can get back in" (`OFFER_PIN_KEY`). A door member sees "Keep your account" instead: Sign in with Apple, Google, or email and password. Their session lasts 30 days, so this is what stands between them and asking again next month.
- **Approval stays, and a new person gives a first AND last name and an email** (Grant, 2026-11-07, asked whether the QR could just be the approval: "Keep approval but they need first last name and after approval create an account with Apple, Gmail, or email n password"). The name rule is `lib/fullName.ts`, shared by the sheet and the ask route: two parts with a letter each, or two characters in a script with no space between family and given name (Chinese, Japanese, Korean). A one-word NEW name through the link gets the same 200 as every other miss and stores nothing, so the rule says nothing about the roster; an imported roster name is still claimed as it is written. The email never leaves the phone with the ask: it waits in session storage across the sign-in reload and fills in "Keep your account". The sheet's words are Grant's: "Hey, glad you're here! What's your name and email? Don't worry, we don't have the bandwidth to send you junk mail."
- **"Keep your account" replaces "Set a PIN" for everyone signed in with nothing to sign in with**, not only door members, because PIN sign-in is being phased out (2026-11-05). Home's card and the one-shot after any approval open `KeepAccountSheet`: Apple, Google (linked to the signed-in account), or an email and password through `POST /api/auth/password` (cookie-only, once per account, the address reserved before the write and unverified until the mailed link is used). Profile's PIN row is untouched for anyone who wants one.
- **Everyone hears that someone joined, on the Notifications page only** (Grant, 2026-11-07: "not push, just passive one in the notification center"). A `member_joined` notice to the club's active roster minus the new person (`noticeClubOfJoin` in `lib/joinNotify.ts`), written on a door approval and on every invite join. Claiming an imported name is not a join and writes none.
- **Asking and keeping the account are PAGES, not sheets** (Grant, 2026-11-08: "The action sheet for request to join and create and account feels temporary. Since there's a real person approval steps I think they all should be using a page not a sheet"). On the signed-out screen the club's link and "I play here already" open an ask page (`AskAccessPage` in `SignedOutShell`, over `components/auth/AskAccessForm.tsx`), and an approval with nothing to sign in with continues on the SAME page to "Keep your account" (`components/auth/KeepAccountPage.tsx`) before the phone goes in. The identity is written only when they leave that step, because writing it reloads into the app; the session cookie is already set, so the step acts on the new account. Home's card opens the same page in place of Home, and Back returns to the week. That retired the one-shot `OFFER_PIN_KEY` marker (`lib/offerPin.ts`): there is no longer a sheet on Home for it to open. `AskAccessSheet` stays only for Profile's anonymous card, which members-only leaves nearly unreachable.
- **The "Add to your home screen" banner is gone from Home** (Grant, 2026-11-07). Profile's install row stays.
- **Password rule: today's, unchanged** (Grant, 2026-11-05: "Keep today's rule", after the trade-off was put to him). He first asked for "min 8 characters with upper and lower case + number + special character". Today's rule is at least 10 characters plus a blocklist of common passwords, with no composition rules on purpose (`lib/passwordRules.ts`): current NIST guidance (SP 800-63B) says composition rules push people to `Passw0rd!` and that length matters more, and his rule as written would have lowered the minimum from 10 to 8.

## Shape

| Piece | Where |
|---|---|
| The door's token, "New link", resolve | `lib/claimLinks.ts` (exists), path form via `lib/inviteLink.ts` |
| What a `/j/` token is | `GET /api/groups/preview` answers `{ name, kind: 'invite' \| 'door' }` |
| Ask under a new name | `POST /api/members/access-request` (exists): a name not on the roster becomes a `Group.joinRequests` entry |
| Approve or decline | `POST /api/admin/access-requests` (exists), organiser-only for door requests |
| The asking phone collects | `POST /api/members/access-request/claim` (exists), reads the club's request by secret |
| Push | organisers only, the name and the club, tagged per request |
| The page a scan lands on | the signed-out shell: "BPM Core · ask to join", a name field, then "Waiting for the organiser" |
| Keep your account | Home, after the first sign-in: Apple, Google, email and password; no PIN |
| The poster | "Save as image" on the Invite page offers the door poster: no "works once" line |

## Tasks

- [x] Preview tells invite from door; the signed-out page opens "Join {club} · Ask to join" for a door token.
- [x] A join request on the club; organiser-only push; the inbox card's join rows; organiser-only approval that creates the account. A name a member already holds is shown as taken and refused; a removed member's name is free again, and approval makes a new person.
- [x] The asking phone signs in on approval, and is not offered a PIN.
- [x] The door poster on the Invite page ("A poster for everyone"), and the club link shared on `/bpm/j/`.
- [x] "Keep your account" instead of "Set a PIN": Apple, Google, or a new route to add an email and password to a signed-in account (2026-11-07).
- [x] First and last name plus an email at the door; "X has joined" on everyone's Notifications page (2026-11-07).

Checked on the mock store, 2026-11-05: an organiser made the club link and saved the poster (a QR decoder read it as the `/bpm/j/` link); a signed-out phone opened that link, asked as a new name, the organiser tapped "Let them in", and the phone landed on Home signed in.

Checked on the mock store, 2026-11-07, at 430 wide in both themes: a signed-out phone opened the `/j/` link, was refused "Sandra" and "sandra@" with a line under each field, asked as "Sandra Test", the organiser approved, the phone landed on Home with "Keep your account" open and the email filled in, saved a password, and the card was gone; Lin's Notifications page read "Sandra Test has joined BPM Core".

Re-checked 2026-11-08 after the move to pages, 430 wide in both themes: the `/j/` link opens "Join BPM Core" as a page; the wait replaces the question; approval continues to "Keep your account" on the same page with the email filled in; Save then Done lands on Home. A second person tapped "Not now", saw Home's card, opened the page from it (no "You're in" line there) and Back returned to the week.
