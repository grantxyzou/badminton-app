---
paths:
  - "app/api/**"
  - "lib/**"
  - "proxy.ts"
  - "components/admin/CommandCenter/PaymentsInboxCard.tsx"
---

# Security invariants (Claude Security scan, 2026-11-17)

The scan of `app/api`, `lib` and `proxy.ts` found 32 issues (4 HIGH, 8 MEDIUM, 20 LOW). They were fixed in #984, #985, #988, #992 and #998, and their record is the per-PR body and the `CHANGELOG.md` entries of 2026-11-17 and 2026-11-18. These are the rules that keep them fixed. Each names the guard that fails the build when it is broken; `__tests__/security-invariants.test.ts` holds the source scans, and each finding's own test file holds the behaviour.

**When to scan.** A PR that touches sign-in, money or an admin power runs Claude Security's "Scan changes" before merge. Those three areas held every HIGH finding. The review bot is not a security review: it answered "No issues found" on every one of those PRs, while the scan and one local review found real holes, twice in the fixes themselves.

## Who the caller is

- **Deny by default.** `verifyLiveMemberAuth` / `readLiveMemberSession` need an ACTIVE place on the roster of the club the cookie names (groups off: an active Member). An account in no club still holds a cookie naming BPM, and a removed member keeps a 30-day one; both used to pass as members (F5 game results, F13 drill ticks). Only what a person in no club must still do calls the ACCOUNT check (`verifyLiveAccountAuth` / `readLiveAccountSession`), and each caller is listed with its reason in `__tests__/account-check-coverage.test.ts`, which fails on a new one.
- **The id, never a name.** A cookie's `name` is the account's display name, chosen at sign-up; a roster name is per club and released on a rename or a removal. A write keys on `caller.memberId` (F13), a gate compares ids (`nameOwnership`), and a history read matches rows by `memberId`, by name only for a legacy row with none, and never for a guest row (`guestOf`): `stats/partners`, `stats/attendance` (F27, F28).
- **Fresh admin check wherever a read names money, costs or another person's contact.** The sync `isAdminAuthed` ignores a demotion, a removal and "Sign out everywhere" for the cookie's 30 days (F23 ledger and owed-audit, F25 string stock, F24 the stringer bench). `__tests__/members-only-coverage.test.ts` pins the helper each route uses.
- **Deployment-wide power belongs to the operator** (`isOperator` / `isOperatorAdmin`, `lib/operator.ts`), never to "an admin of BPM": the memberId migration (F22) and minting BPM's reports key, which also reads every club's problem reports (F26). Pinned in `security-invariants`.

## Acting on someone else's account

- **An admin acting on another member's credentials goes through `onBehalfRefusal`** (`lib/onBehalfGuard.ts`): setting, clearing or resetting a PIN and letting in a "let me in" ask. Only an organiser acts for an admin or organiser, and nobody acts for someone on another club's roster (F1–F4). An admin who set someone's first PIN is NOT signed in as them (`provedSelf`). Pinned in `security-invariants`: a route that admits an admin and writes a credential must call the guard.
- **Removing an admin is an organiser's call** in all three places it can be done (F20).

## Guessing

- **Count before compare.** A PIN check calls `claimPinAttempt` (counted under `IfMatch` on a fresh read) BEFORE `verifyPin`, and `notePinSuccess` after a match. The older `isPinLocked` / `notePinFailure` let a parallel burst all reach the real hash (F8, F9). Pinned in `security-invariants`; behaviour in `__tests__/pin-lockout-burst.test.ts`.
- **Same work for a name nobody holds.** Every miss pays the scrypt (`FAKE_HASH`, and `verifyRecoveryCode` pads its own misses, F17) and, where a real account's miss would read and write its counter, `padMissingAccount()` (`lib/accountPad.ts`, gap 3). It narrows the timing difference rather than removing it; the rate limits stop averaging over enough tries to see what is left (OWASP: brute-force protection "prevents an attacker from applying the enumeration at scale").
- **Same countdown for every name.** A paused PIN check answers `pin_paused` with the seconds left (`lib/pinPaused.ts`), and so does a name with no PIN behind it, counted in memory on the account lock's own schedule (`claimNameAttempt` in `lib/pinLockPolicy.ts`); a limit keyed on the name or the caller alone may answer it too. Never answer it from an account's lock alone: that lists which names hold a PIN. `__tests__/pin-countdown.test.ts` runs a real name, a name nobody holds and a member with no PIN through each route, guess for guess.
- **Same answer for every name.** A signed-out caller of `PATCH /api/members/me` gets one answer for nobody, a member with a PIN and one without (F15). The signed-out ask's poll opens a SEALED secret only, and a bare secret is dead (F14).
- **Rate-limit before the expensive part.** An anonymous request buys no scrypt before its limits (F10).

## Proving an address

- **Only a sign-in through the address proves it** (`Member.mailboxProven`, gap 2, Grant's option B): an email code, a reset link, Apple or Google at sign-up or through rule 3, claim-name. The confirmation link sets `emailVerified` only, because the owner of a mailbox may click one they never asked for. The first proof takes the account back from a password set before it (`lib/emailProof.ts`). Accounts made before 2026-11-18 09:00 UTC that had confirmed are grandfathered (`mailboxIsProven`). Changing the address drops the proof. Pinned in `security-invariants`: every writer of `emailVerified: true` other than the link writes `mailboxProven` too.

## Money

- **A name anyone can choose is never proof of who paid** (F18). A candidate found only by a roster name equal to the bank's, or only by the memo, is `nameOnly` and goes to review; only a remembered alias auto-pays, and an alias follows its member by id (`POST /api/aliases` and "Remember" store it). A dismiss never remembers a bank name equal to the chosen name. The rest of the money rules are in `.claude/rules/money.md`.

## Data that came from a member

- **A map keyed by member-supplied text is null-prototype** (`Object.create(null)` or a `Map`). The key `"__proto__"` on a plain `{}` with `??=` writes onto `Object.prototype` for the whole shared server process (F21). Pinned in `security-invariants`.
- **Parse untrusted text on bounded, tidied input.** Adjacent whitespace quantifiers backtrack polynomially in V8; `lib/etransferParse.ts` collapses whitespace and bounds the sender search (F12).

## Known and left

- F30: the native sign-in returns over `bpm://`, which any installed app can register. It is fixed with the next native build (`docs/plans/native-return-app-link.md`, issue #997).
- F31 was accepted. F32: an Apps Script copy older than 2026-11-05 sends no `to`, and is trusted as before (Grant's choice).
- An alias written before 2026-11-18 with no `memberId` still resolves by its app name.
