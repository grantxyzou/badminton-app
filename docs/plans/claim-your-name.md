# Claim your name — let an imported person in

**Track:** multi-group critical path — "a SECOND club created and run through one session end to end" (CLAUDE.md, Groups). Step C of `docs/plans/six-feathers-onboarding.md`. It also closes the open Phase 6 item in `docs/superpowers/plans/2026-09-07-multi-group.md`: "A signed-out 'Ask to be let in' cannot name its club."
**Status:** in-flight
**Review on:** 2026-12-02 — of the names imported into the first outside club, how many have been claimed, and was any claim approved for the wrong person? Fewer than half claimed means the approval step is the friction. One wrong person means stop and switch to per-person codes (see Kill criterion).

## Problem

The roster import (`docs/plans/roster-import.md`, #754) puts 35 names on a club's roster in one paste. None of those people can sign in. Grant, on the import's last step: "People you import can't sign in yet" — and he asked for this step next ("plan the claim your name step", 2026-11-04).

Every way in today is closed to an imported person in a second club:

| Way in | Why it fails for them |
|---|---|
| Name + PIN on Log in | They have no PIN. The import creates a name and nothing else. |
| "I play here already" (`AskAccessSheet`) | The ask and its claim resolve the name with `resolveGroupId(req)`, which is **BPM** for a signed-out visitor. Six Feathers' Lin is not found; BPM's Lin, if there is one, is. |
| A one-time invite + sign-up | `POST /api/auth/signup` answers `name_taken`, because the import already holds the name in that club. |
| Google or Apple, then "That's me" (`claim-name`) | Also resolves in BPM, and its proof is a PIN or a recovery code — which they do not have. |
| A recovery code from the Roster sheet | Works only from Profile, signed in. And it is one code per person — 35 private messages, the burden the import removed. |

Two smaller faults surfaced while mapping this:

- **The "let me in" push goes to every admin in the deployment.** `POST /api/members/access-request` notifies `Member.role = 'admin'` across all clubs. With a second club live, BPM's admins would see "Akane is asking to be let in" for a Six Feathers member — a name crossing clubs on a lock screen.
- **An approval mints a cookie for BPM.** The claim's `setMemberCookie(..., resolveGroupId(req))` would name BPM for a signed-out device, even once the ask itself could find the right club.

## Kill criterion

- **One approved claim turns out to be the wrong person.** The link's whole safety is "an organiser approves people they know asked". If that fails once, stop and replace the link with per-person codes generated in bulk at import (more work for the organiser, no guessing).
- **Or fewer than half the imported names are claimed two weeks after the link goes out.** Then the friction is the approval, not the link. Look at why before building more (approve-all, a name picker) on top.

## Non-goals

- **Email, Google or Apple at claim time.** A claimed person who wants one adds it afterwards from Profile → How you sign in, which already exists. Building it into the claim would mean a second proof path for the same decision.
- **A name picker for the person claiming.** Listing the roster to anyone holding the link publishes the club's names to whoever the link reaches. They type their name, as "I play here already" does today.
- **Changing BPM's own "I play here already".** Without a club link it keeps resolving in BPM, as it does today.
- **Approve-all.** Blind approval is safe one request at a time (`app/api/admin/access-requests/route.ts`); a batch button is a later decision, and only if the kill criterion's second half fires.

## Decisions

Grant, 2026-11-04: "Yes to all five".

- **One link per club, no expiry, rotated by hand** (Q1). `lib/claimLinks.ts`, stored like an invite. A new link retires the old one in one write, and **also cancels the asks waiting on it**: a device polling with the old link resolves no club, so its claim answers `none`. That was not spelled out in the plan; it falls out of "the club record is the authority" and is the right thing for a link that leaked.
- **Only unclaimed names** (Q2): no PIN, no password, no Google or Apple (`isUnclaimed`). Every other ask through the link gets the same 200 and is not stored.
- **Approve one at a time** (Q3), on the existing Sign-in requests card, which now says "With the club link · never signed in". An ask remembers its club (`StoredAccessRequest.groupId`), so a person on two rosters is approved, declined and signed in per club. **An ask from before the field** has no club and stays with whichever club's roster holds the person — the rule before — rather than being read as BPM's, which would have hidden it from a second club's organiser.
- **Sign out everywhere** (Q4): `Membership.sessionsNotBefore` (the Member copy on `role`'s rule), stamped by the Roster sheet's button and by issuing a recovery code, compared in whole seconds like widget passes. Two limits, chosen:
  - **It reaches what re-reads the membership**: the page gate, every members-only read, sign-up and the widget. 23 routes trust the member cookie's signature alone (stringing jobs, stats writes, push subscribe, group switch and join among them) and see the cutoff only when the cookie expires. Locking someone out of the app is what an organiser needs; closing those routes too is a follow-up, not this change.
  - **It does not delete push devices.** They belong to the person across every club, so one club's organiser clearing them would reach into another club's notifications.
- **After an import, the sheet ends on "Share the club link"** (Q5) rather than a toast: a toast cannot carry a button. Only when the import added someone; a re-mark-only import still closes with a toast.
- **One PR, not two.** The server half and the screens went up together on #771, with the plan.

## Shape

### How it works for the person

1. The organiser posts the link in the club chat: `…/bpm?claim=<token>`.
2. Lin taps it. The signed-out screen shows **"Six Feathers"** (the club's name, from the preview read that invites already use) and one field: **your name as the club knows it**.
3. **Ask to be let in.** The screen waits, exactly as "I play here already" waits today.
4. The organiser gets a push — only the organisers of *that* club — and taps **Let in** on the card.
5. Lin's phone signs in to Six Feathers, then offers to set a PIN (the existing `OFFER_PIN_KEY` step), so next time Lin signs in with name + PIN.

### How it works for the organiser

- Roster → **Claim link** (a settings row under Import a list) opens a sheet: the link with **Copy** and **Share**, **New link**, and how many imported names have not been claimed yet.
- The access-requests card shows the club's asks with "With the club link · never signed in".

### Server

- **The link** is a sibling doc of the `Group` in the GLOBAL `groups` container, keyed by the hash of the secret (`claimlink:${sha256(token)}`), exactly as invites are (`lib/invites.ts`). `Group.claimLinkId` names the live one — the club record is the authority, so rotating is one write and an old link resolves to nothing. A new `lib/claimLinks.ts` owns mint, rotate and resolve.
- **The ask** (`POST /api/members/access-request`) takes an optional `claimToken`:
  - With it: the club comes from the token (a point read), the name resolves in that club, and the request is stored only when the member is unclaimed (Q2). Every other case answers the same `{ ok, secret }` 200 as today, so the link is not a roster oracle.
  - Without it: unchanged.
- **The request remembers its club.** `StoredAccessRequest` gains an additive `groupId`. The claim mints the cookie for that group instead of `resolveGroupId(req)`. A request without one (every request today) reads as BPM, so rollback is safe.
- **The push narrows to the club's organisers and admins** (its active `owner`/`admin` memberships), for every ask, with or without a link. That fixes the cross-club lock-screen leak above for BPM too.
- **The admin list** filters by the request's `groupId` (falling back to the roster narrowing for old requests), and marks link asks.
- **The preview** (`GET /api/groups/preview`) also accepts `?claim=` and answers the club's name and nothing else, with the same single 404 for any failure.
- **Sign-up's `name_taken`** for an unclaimed imported name says to use the club's claim link instead of a different name.
- **Undoing a claim** (Q4): `Membership.sessionsNotBefore` (additive), stamped by **Sign out everywhere** and by issuing a recovery code, checked where the member cookie is verified against the membership — the same place `widgetPassNotBefore` is.

### Tests

- **Two clubs, one name:** an ask via club X's link for "Lin" never touches BPM's Lin. Approval mints a club-X cookie. BPM's admins get no push.
- **Same answers:** an unknown name, a claimed name and a real unclaimed name all get the identical 200; only the unclaimed one appears on the admin's card.
- **Rotation:** an old token resolves to nothing; the preview 404s.
- **Old requests** with no `groupId` still approve and claim as BPM.
- **Canaries:** the new `?claim=` landing joins `lib/landingParams.ts` (`landing-params-canary`); the route classification and the group-sweep canaries cover the changed routes.

| piece | file |
|---|---|
| Link mint, rotate, resolve; `isUnclaimed` | `lib/claimLinks.ts` |
| `Group.claimLinkId`, `StoredAccessRequest.groupId` (additive) | `lib/types.ts`, `lib/accessRequest.ts` |
| The ask, the claim, the admin list, the push | `app/api/members/access-request/route.ts`, `app/api/members/access-request/claim/route.ts`, `app/api/admin/access-requests/route.ts` |
| Mint / rotate / read the link (organiser) | `app/api/groups/claim-link/route.ts` |
| Preview by claim token | `app/api/groups/preview/route.ts` |
| The `?claim=` page | `components/onboarding/SignedOutShell.tsx`, `components/AskAccessSheet.tsx` (takes the token) |
| Sign out everywhere; the cutoff check | `app/api/members/route.ts` (PATCH), `app/api/players/reset-access/route.ts`, `lib/auth.ts` (`activeMemberFor`, `sessionRevoked`), `lib/groups.ts` (`signOutEverywhereIn`) |
| The `?claim=` landing | `lib/landingParams.ts` |
| Club link sheet, card label, the import's last step | `components/admin/CommandCenter/ClaimLinkSheet.tsx`, `components/admin/CommandCenter/RosterPage.tsx`, `components/admin/CommandCenter/AccessRequestsCard.tsx`, `components/admin/CommandCenter/RosterImportSheet.tsx` |

Tests: `__tests__/group-claim-link.test.ts` (two clubs, one name), `__tests__/components/ClaimLinkSheet.test.tsx`, and the `?claim=` landings in `__tests__/components/SignedOutShell.test.tsx`.

## Accepted risk

**Someone with the link asks first under a name that is not theirs, and the organiser approves it.** The name has no credential, so nothing of value sits behind it but a spot on a list. When the real person tries, the name is now claimed, so the link refuses them. They tell the organiser, who issues a recovery code from the Roster sheet: it clears the impostor's PIN and, with Q4, signs every device out of that name, so the impostor's cookie stops working at once instead of living out its 30 days. The real person then uses the code and sets their own PIN. The approval card's "never signed in" label and the rule that two askers for one name cannot be approved are what keep this rare. The kill criterion is what decides it is not rare enough.
