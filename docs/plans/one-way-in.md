# One way in: the club link, an email code, and the organiser's yes

**Track:** members-only (`docs/plans/members-only.md`), how a new person gets in, and the multi-group critical path's onboarding of a second club (`docs/plans/six-feathers-onboarding.md`)
**Status:** in-flight (all six steps built 2026-11-14; not yet merged or deployed)
**Review on:** 2026-12-15 — since the account-first club link shipped, did any newcomer need the organiser to send them something (a new link, a code, "try again") to get in, and how many accounts were never approved?

## Problem

Grant, 2026-11-13: "I think sign up and invite and join all these flows are just over complicated."

Read from the code on 2026-11-13 (`main` at `eecdf19`; the proposal page with the full map is https://claude.ai/artifact/CtXFLhFqbKAzM6YXN1xMZJ):

- **Six ways in.** A one-time invite, the club's door link, the Sign up page's code box, "I play here already", joining a second club, and starting a club. Each is short. There are too many of them.
- **Two kinds of link at one address.** A one-time invite (`/bpm/j/<token>`) makes an account at once. The door link at the same address asks, waits for an organiser, then asks again how to sign in. The organiser picks which to send.
- **Four codes.** The 8-character invite code, the 4-digit PIN, the 6-digit admin recovery code and the 6-digit sign-in code from the iOS handoff.
- **"Sign up" means three things.** Create an account (Welcome), type an invite code (the Sign up page), and put me on this week's list (Home).
- **The door's wait is fragile.** The asking page must stay open, the request dies after an hour, and after approval comes a second step, "Keep your account", whose "Not now" leaves thirty days of session and nothing to sign in with.

Earlier words that led here:

- "lets make it one time used link." (2026-10-06, `one-time-invites.md`)
- "Keep approval but they need first last name and after approval create an account with Apple, Gmail, or email n password" (2026-11-07, `door-link.md`)
- "The action sheet for request to join and create and account feels temporary. Since there's a real person approval steps I think they all should be using a page not a sheet" (2026-11-08, `door-link.md`)
- 2026-11-06, `oauth-handoff-gaps.md`: "yes, someone got stuck" on Google or Apple. The details are still not in hand.

## Kill criterion

- **A newcomer still needs a message from the organiser to get in.** If, by the review date, any newcomer was sent a fresh link, a code or "try again" because the club link did not take them through, the flow is not simple yet. Find which step and fix it before building more.
- **Or strangers outnumber members at the door.** If never-approved accounts outnumber approved ones in the first month, account-first creation is letting noise in. Go back to "approval creates the account" (`door-link.md`) for new people.

## Non-goals

- **Guests.** Plus-ones stay exactly as they are (`.claude/rules/signup.md`): a member types the friend's name on the sign-up card, and the member pays.
- **No auto-approval.** The door keeps every join behind an organiser (`door-link.md`, Non-goals). There is no "anyone with the link gets in" switch.
- **Retiring PIN sign-in for people who have one.** PINs move behind "Other ways to log in"; taking them away is its own plan, with its own migration.
- **Text-message codes.** Email codes only. SMS costs money per message and needs a provider.
- **Merging a newcomer into a name someone already signs in with.** Unchanged from `door-link.md`: that name is shown to the organiser as taken, never attached. The one link is an organiser's yes to an imported name nobody has ever signed in as (step 4b).
- **What a signed-out or waiting person can read.** Members-only stays as it is: the club's name and nothing else.

## Decisions

- **2026-11-13 — One-time invites go away. The club link is the only way to become a member.** Grant, asked whether to keep them as "Let in ahead": "One time invite should just be the guest feature", then, choosing between a one-session guest pass with or without an account and dropping the link: drop it. Guests stay as today's plus-one. Beat: keeping per-person links as a second, wait-free route, which is one more card, one more branch and one more thing for the organiser to choose. This reverses `one-time-invites.md`. Its reason, a forwarded permanent link being an open door, has been answered since 2026-11-05 by the door's approval.
- **2026-11-13 — New accounts sign in with a 6-digit email code, beside Apple and Google. No password is offered to a new person.** Grant: "Email code create account before let I'm" [let in]. Existing passwords and PINs keep working. Beat: email and password (today's form), which needs a "forgot password" path of its own; and a magic link, which opens in the mail app's own browser or on another device and strands the sign-in, worst inside the native shell.
- **2026-11-13 — The account is created BEFORE the organiser approves.** Grant, same message. The person signs in first, then asks. They can close the app while they wait, the request no longer dies with a page, and "Keep your account" disappears for them. This reverses `door-link.md`'s "approval creates the account". Beat: today's order, where the organiser's tap creates the account and the asking phone must poll for it. Cost: a stranger who is never approved leaves an account in no club. It sees only the no-club screen (`lib/pageGate.ts`), and is deleted after 14 days unapproved (Grant: yes to the 14-day cleanup).
- **2026-11-13 — The organiser chooses regular or drop-in when approving.** The approve button offers "Let in as a regular" and "Let in as a drop-in" (`Membership.regular`). Today a new member lands on the waitlist during the members-first window until someone marks them on the Roster. Beat: every approval making a regular, which gives a stranger members-first priority by default.

- **2026-11-13 — Step 1: a one-word name at the door is a hint, not a wall.** The form refused any one-word name, but the server claims an unclaimed roster name exactly as written, so an imported "Lin" could never claim her spot through the club's link. Now the first tap shows "Add your last name too. If the club already knows you by one name, tap Ask to join again." and the second sends it; the server's rules did not change. Beat: dropping the client rule, which would have sent every new person's one-word name into a silent "no request is open".
- **2026-11-13 — Step 1: another club's door link says what works instead of failing.** A signed-in member opening another club's door link now reads "ask {club}'s organiser for an invite link" in place of a Join button that always failed. Beat: building door joins for existing accounts now, which is step 4's machinery and would be half thrown away.
- **2026-11-13 — Found while doing step 1, for Grant to decide: the ask's poll says which names exist.** `POST /api/members/access-request` answers the same 200 for every name, as designed, but its poll (`access-request/claim`) answers `pending` for a request it stored and `none` for one it did not, and it stores one only for a name the club knows (or, through the door, a full name). So asking under a name and reading the first poll tells a stranger whether that name is on a club's roster. Step 4 replaces this ask with a signed-in one, which closes it; until then it stands.

- **2026-11-13 — Step 2: "Sign up" keeps the week's list; making an account stops using it.** The proposal renamed Home's button to "I'm in this week". Reading the copy showed "sign up" already meant the week's list in about forty strings (Home, the push, the help guide and its screenshots, the legal pages, the app shortcuts) and an account in five. So the five moved: Welcome and the invite page say "Join a club", Log in says "New here? Join a club". Beat: renaming the forty, which would also have meant new help screenshots. Chinese already kept the two apart (注册 for an account, 报名 for a session). "Group" became "club" in every member screen and the admin screens' own English (群组 → 俱乐部), keeping "group chat"; the legal pages still say "group", for Grant to decide. The rule is in `.claude/rules/i18n.md`.

- **2026-11-13 — Step 3: the email code signs in an account that already has an address; making an account with one is step 4.** Step 4 is where a new person signs in first and then asks, so the code's sign-up half belongs with that flow rather than ahead of it. Log in keeps name and PIN as its first form until step 6; "Use email instead" now leads with the code, and the password is a tap away.
- **2026-11-13 — Step 3: the code is in the email's SUBJECT too** ("123456 is your BPM code"), so it can be read off the notification and typed without opening the mail, as most apps that send codes do. It is single use, ten minutes, and worthless without the address. Beat: body only, one more app switch for every sign-in.
- **2026-11-13 — Step 3: the send is not awaited.** `start` answers every address the same, and waiting for Gmail (about a second) only when the address is real would say which addresses are. The code is stored before the send, so a mail that fails costs a "Send a new code", never a code that was mailed but not kept.

- **2026-11-13 — Step 4: imported names come in the same way as everyone, and the organiser links them.** An imported "Lin" (on the list, never signed in) signs in with Apple, Google or an email code, types "Lin" and asks. The organiser's approval offers "This is Lin from your list", which links her new sign-in to the existing Lin and her history. Grant chose this over keeping a separate "claim your name" path beside the club link. Built as step 4b; the old name-only claim stays reachable for imported names until step 4d removes it.
- **2026-11-13 — Step 4: the person hears "you're in" by email, and by push if they have it on.** A new account rarely has notifications on, so the email is what reaches them. Beat: push only.
- **2026-11-13 — Step 4: "I play here already" stays, and stops saying which names exist.** Every name gets the same "Sent. If the club knows that name, an organiser will see it." for the hour, so the poll can no longer be used to test names. A real member is let in as today. Beat: removing it, which would leave a PIN-only member with no email and a forgotten PIN no self-serve way back. Built as step 4c.
- **2026-11-13 — Step 4 is four parts on one branch,** each leaving the app working: 4a the account-first club link (sign in, name, ask, the waiting screen, approve as a regular or a drop-in, the "you're in" email and push); 4b linking an imported name at approval; 4c the "I play here already" leak; 4d removing the signed-out name-only club-link ask once 4b covers the names it existed for. The 14-day cleanup of never-approved accounts stays in step 6.

- **2026-11-13 — Step 4a built.** Two things decided while building it:
  - **A club's link and a one-time invite share one field.** They already shared one address (`/bpm/j/<token>`), so `signupGroupFor` reads a token that is not an invite as the club's link. Every sign-up form that sends an invite token, Google and Apple's name step included, works with the club's link unchanged. Beat: a separate `doorToken` threaded through every form.
  - **An email the account can get a code at counts as a way in.** Found by looking: an account made with an email code was shown "Keep your account: nothing to sign in with". `GET /api/auth/methods` reports `hasEmailCode`, and Home, the upgrade nudge and Profile's methods read it.

- **2026-11-13 — Step 4b built: the organiser's link moves the new sign-in onto the imported member, never the other way.** The imported Lin holds the history (sessions, payments, ratings, kudos, the membership), all keyed by her id; the account made at the door holds only a sign-in. So "Yes, that's Lin" moves every sign-in identity (Apple, Google, the email) onto the imported Lin, gives her the address, and retires the door account (`active: false`, `mergedInto`, its email and pointers stripped). Beat: copying the history the other way, which would rewrite rows across a dozen containers. Guards: the imported name must never have been signed in as (`isUnclaimed`), and the asker must be in no club, so a person with history of their own is never folded into someone else. The phone still holding the door account's cookie is signed in as Lin on its next poll (`GET /api/groups/ask` answers `relinked`), the same trust as signing in again with the moved identity. A retired account cannot be let into another club later. The 14-day cleanup (step 6) deletes it.

- **2026-11-13 — Step 4c built: the poll answers by a seal, not by the store.** Every secret the signed-out ask hands out is signed with its hour (`lib/askSecret.ts`, the session HMAC), stored or not. The poll opens it first: a seal inside its hour reads `pending` whatever is stored under it, so a made-up name, a real one and an ignored ask all read the same until the hour is up, then `none`. Only a stored, approved ask is ever `approved`; the seal grants nothing. Beat: storing a decoy request for every unknown name, which would write to the database for every guess and still differ on approval. Two costs, both accepted: an ignored ask now waits out its hour instead of hearing "no request is open" at once, which is what "Ignore" means; and a secret handed out before the deploy reads the store as before, for at most an hour. **Still open, for later:** the ask itself does more work for a known name (a write, a push) than for an unknown one, so its response TIME differs. Five asks an hour per caller make that slow to use; the signed-in club link (4a) has no such path, and step 4d removes the name-only door ask.

- **2026-11-13 — Step 4d built: the club's link takes no name from a signed-out phone.** "Claim your name" under the club's page, the ask form's club-link mode (its email field and one-word hint) and the phone-bound join requests (`addJoinRequest`, `collectJoinRequest`, approval making the account) are gone; every ask through the link is an account's. An ask that still arrives with a `claimToken` (a page left open across the deploy) stores nothing and gets the same sealed answer as any other, so it waits out its hour. A phone-bound row left on a club is not listed and cannot be approved. Beat: keeping the old ask for an hour of overlap, which would have kept the whole collect path alive for requests nobody could make. "I play here already", Log in's ask for a member who lost access, stays (4c).

- **2026-11-13 — Step 5 built: one Club link card, and one-time invites retired.** The console's People section has "Club link" in place of "Invite someone": one card with the link's QR on the page, the link, Share, Save poster, how many on the list have never signed in, and "New link" (asks first; people already asking keep their place, because their asks belong to their accounts). The same card stands in the Roster's sheet and in the session list's "Invite {guest} to the club". Creating a club makes its link and shows it (`link`, no code). Gone: the invites library, `/api/groups/invite`, `/api/groups/join`, the Invite, invite QR and door poster cards, and the 8-character code everywhere a person could type one (Join a club, Join another club, the name step's resume). A new account has two ways to be made: through a club's link (it asks), or inside Create a club; with groups off, none. A pasted or typed old code gets "Paste the whole link your club shared. Codes from old invites no longer work." Unused invites stopped working on deploy, as the old club-wide link did on 2026-10-06; their docs stay unread. Beat: keeping invites for an organiser standing next to a newcomer, which the QR on the Club link card does now without a second kind of link.
- **2026-11-13 — Found in step 5, for step 6 (closed in step 6, below): "Is that you?" has no way in any more.** It opened when sign-up answered "that name is taken", and since 4a an account made through the club link is in no club, so nothing checks its name; with invites gone, nothing does. So a member who has a PIN and taps Google on the club's page makes a second account, and the organiser sees the name as taken and cannot let it in. Today's way round: sign in with the PIN and add Google under Profile, How you sign in. Step 6 should offer it at the ask: when the asked-for name is held by someone who has signed in before, ask "Is that you?" for their PIN or code (the existing `POST /api/auth/claim-name`, which now reads the club from the link).

- **2026-11-14 — Step 6 built, in three parts.**
  - **Log in leads with the email code; name and PIN sit behind "Other ways to log in".** Apple and Google stay above it. PINs keep working for everyone who has one; nobody new is offered one (a Non-goal: taking them away is its own plan). Beat: a PIN tab beside the code, which keeps two equal first choices on the one screen everyone sees.
  - **The 14-day cleanup rides the hourly tick** (`lib/strayAccounts.ts`, a once-per-tick job in `lib/tick.ts`). Every account made since step 6 carries `noClubSince`; 14 days on, one on no club's roster in any status and asking nowhere is deleted the way "Delete my account" deletes (`purgeMember`, a filed report anonymized, the Member doc last). One that got into a club loses the mark, so the set the tick reads stays the people actually waiting. An account linked away at approval (4b) goes at 14 days too. At most 25 per hour. Beat: a separate daily workflow, which is a second key and a second schedule for one query; and deleting at the ask's lapse, which would delete someone mid-way through making a club. Accounts made before step 6 carry no mark and are never touched.
  - **"Is that you?" at the ask.** Through a club's link, a name someone on that list already signs in under answers `name_taken` before anything is made, and the name step asks for their PIN or an organiser's code (`POST /api/auth/claim-name`, which reads the club from the link and now records an email-code sign-in's address too). Right, and the new sign-in is joined to them, signed in to that club, no ask. A name nobody has signed in under still goes to an ask, and the organiser links it (4b). Cost, accepted: someone holding the club's link who signs in learns that the club has a member by that name who signs in; every member can read the roster's names already. Beat: leaving it to the organiser, who could only answer "taken" and leave the person with a second account.

## Shape

Planned; nothing is built yet.

| Piece | Where |
|---|---|
| Email code: send, check, sign in or create | a new `app/api/auth/email-code/` route and `lib/emailCode.ts`, sending through `lib/mailTransport.ts` |
| "Join {club}": Apple, Google, email code, then the name | `components/onboarding/SignedOutShell.tsx`, `components/auth/AskAccessForm.tsx` |
| The waiting screen, signed in and in no club | the `noClub` mode of `SignedOutShell` (`lib/pageGate.ts`) |
| A join request held by a member, not a device secret | `lib/joinRequests.ts`, `app/api/members/access-request/` |
| Approve as regular or drop-in | the console's Sign-in requests card in `components/admin/` |
| One "Club link" card in place of Invite someone and the poster card | `components/admin/CommandCenter/InviteCard.tsx`, `components/admin/CommandCenter/DoorPosterCard.tsx` |
| Retire one-time invites | `lib/invites.ts`, `app/api/groups/invite/`, `lib/inviteSignup.ts` |
| 14-day cleanup of never-approved accounts | `lib/memberPurge.ts` |
| One word per idea | `messages/en.json`, `messages/zh-CN.json` |

## Order of work

Each step is its own PR, and each one leaves the app working.

1. **Fix what is broken today**, whatever else ships. Built 2026-11-13, except the first item, which moved to step 4:
   - A member who taps another club's door link sees "Join {club}?" then "That code doesn't work": `JoinGroupPage` takes the door preview, but `POST /api/groups/join` only claims one-time invites. *Step 1 replaced the dead button with what to ask for; the real fix is step 4.*
   - "I play here already" with an unknown name reads "That request expired" after one poll. Keep the silence (no name oracle), change the words.
   - A used or expired tapped link lands on the code box with "That code doesn't work", and the sign-up error says the invite "has been replaced".
   - An imported one-word roster name cannot be claimed through the door, which requires a first and last name.
   - After Google or Apple on a new account, `auth/claim-name` resolves the name in BPM, not the invited club.
2. **One word per idea**, copy only: "Join a club" and "Log in" on Welcome, "club" for "group". Built 2026-11-13; Home's button kept "Sign up for this week" (see Decisions).
3. **The email code** as a sign-in method beside Apple and Google, on Log in first. Built 2026-11-13 for existing accounts (see Decisions).
4. **The account-first club link**: sign in, name, ask, the waiting screen with a push to the person when approved, and approve as regular or drop-in.
5. **One "Club link" card**, and one-time invites retired. Unused invites stop working on deploy, as the old club-wide link did on 2026-10-06.
6. **PIN behind "Other ways to log in"**, and the 14-day cleanup.
