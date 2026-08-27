# Multi-Provider Auth — Phase 2: email + password

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans.

**Goal:** A person can create an account with an email address and a password, verify the address, sign in with it, and recover it if they forget the password — without any of it disturbing the existing name+PIN path.

**Spec:** `docs/superpowers/specs/2026-08-26-multi-provider-auth-design.md`
**Depends on:** Phase 1 (`docs/superpowers/plans/2026-08-26-multi-provider-auth.md`), all five tasks merged.

## Global Constraints

Inherits every constraint from the Phase 1 plan. Additionally:

- **Rate limit first**, before body parsing and before any Cosmos read.
- **`POST /api/auth/forgot-password` always returns 200**, whether the address exists or not. Anything else is an account-enumeration oracle.
- **Constant-time miss on sign-in** against `FAKE_PASSWORD_HASH`, so timing cannot distinguish "no such email" from "wrong password".
- **Every `/api/auth/*` route is gated server-side** on `isFlagOn('NEXT_PUBLIC_FLAG_AUTH_PROVIDERS')` → 404 when off. A client flag cannot protect the database.
- **All sign-in terminates at `completeSignIn()`** from `lib/authSession.ts`. No route calls `setMemberCookie` directly.

## Write-ordering decision (locked)

Sign-up performs two writes that can partially fail: reserve `email:<normalized>` in `identities`, and upsert the `Member`. **Reserve first, and `releaseIdentity` in a catch if the member write fails.**

The alternative is worse in a way that cannot be repaired by a retry: member-first leaves a member holding an email that nothing has reserved, so a second sign-up can reserve that same address and *steal* it. Reserve-first's failure mode is an orphan reservation pointing at a member that does not exist — which blocks that address, but blocks it for nobody in particular and is releasable. The catch makes even that transient.

This is worth an explicit test: reservation succeeds, member upsert throws, assert the address is free again.

## Tasks

### Task 6: `lib/authToken.ts` — single-use, hashed, expiring tokens

**Files:** Create `lib/authToken.ts`; test `__tests__/authToken.test.ts`.

**Produces:**
- `interface TokenRecord { hash: string; expiresAt: number }`
- `createToken(ttlMs: number): { token: string; record: TokenRecord }`
- `checkToken(token: string, record: TokenRecord | undefined | null): boolean`
- `VERIFICATION_TTL_MS` (24 h), `RESET_TTL_MS` (1 h)

**Design note to carry into the code:** hash with SHA-256, not scrypt. The token carries 256 bits of entropy from `randomBytes(32)`, so key-stretching defends against nothing — there is no dictionary to attack — and would only add latency to every verification click. Stretching is for *low*-entropy secrets (PINs, passwords). Compare with `timingSafeEqual`.

Tests: round-trip; wrong token fails; expired record fails; absent/malformed record fails; two tokens differ; the raw token never equals the stored hash.

### Task 7: `lib/authEmail.ts` — the two transactional emails

**Files:** Create `lib/authEmail.ts`; test `__tests__/authEmail.test.ts`.

**Produces:**
- `sendVerificationEmail(to, name, url): Promise<{ sent: boolean }>`
- `sendPasswordResetEmail(to, name, url): Promise<{ sent: boolean }>`

Follows `lib/reportEmail.ts` exactly: lazy `nodemailer` import, env-gated on `GMAIL_USER` / `GMAIL_APP_PASSWORD`, returns `{ sent: false }` rather than throwing when unconfigured (already confirmed present in the `vnext-badminton-app` App Settings). Friend-voice copy.

Tests run with the env vars unset and assert `{ sent: false }` and that nothing throws — the suite must never attempt real SMTP.

### Task 8: `POST /api/auth/signup`

**Files:** Create `app/api/auth/signup/route.ts`; test `__tests__/auth-signup.test.ts`.

Body `{ name, email, password }`. Behaviour:
1. Flag gate → 404 when off.
2. Rate limit 5/hr per IP.
3. Validate email shape and `validatePasswordStrength`.
4. Reserve `email:<normalized>` → 409 `email_taken` if held.
5. Resolve or create the `Member` by name. **A name collision with an existing member is a 409 `name_taken`, not a silent link** — names are enumerable, and treating one as proof of identity is the WS#3 hazard.
6. Write `passwordHash`, `email`, `emailVerified: false`, `emailVerification`.
7. Send the verification email (best-effort; sign-up succeeds regardless).
8. `completeSignIn`.

On any failure after step 4, `releaseIdentity('email', email)`.

Tests: happy path; duplicate email 409; name collision 409; weak password 400; malformed email 400; flag-off 404; **orphan-release test** (member upsert throws → address free again); response never contains `passwordHash` or `emailVerification`.

### Task 9: `POST /api/auth/signin`

**Files:** Create `app/api/auth/signin/route.ts`; test `__tests__/auth-signin.test.ts`.

Body `{ email, password }`. Point-read `email:<normalized>` → `memberId` → member. Verify against `passwordHash`, or against `FAKE_PASSWORD_HASH` when absent so both branches cost the same. Generic `invalid_credentials` 401 for every failure. Rate limit 5/hr per (email, IP), matching `/recover`. `completeSignIn` on success.

Tests: happy path sets `member_session`; wrong password 401; unknown email 401 with the *same* body as wrong password; inactive member 401; admin gets `admin_session`; non-admin's stale `admin_session` is cleared; rate limit 429.

### Task 10: `GET /api/auth/verify-email`

**Files:** Create `app/api/auth/verify-email/route.ts`; test `__tests__/auth-verify-email.test.ts`.

Query `?token=&email=`. On success set `emailVerified: true`, delete `emailVerification`, redirect to `/bpm?verified=1`. On failure redirect to `/bpm?verified=0` — a redirect rather than JSON, because this URL is opened from a mail client, and a raw JSON error page is a dead end for the person reading it.

Tests: valid token verifies and clears the record; reuse of a consumed token fails; expired token fails; wrong email fails; already-verified is idempotent.

### Task 11: forgot / reset password

**Files:** Create `app/api/auth/forgot-password/route.ts`, `app/api/auth/reset-password/route.ts`; test `__tests__/auth-password-reset.test.ts`.

`forgot-password` `{ email }`: rate limit 3/hr per IP, **always 200**, writes `passwordReset` and mails the link only when the address actually resolves.

`reset-password` `{ email, token, password }`: validates strength, verifies the token, writes the new `passwordHash`, deletes `passwordReset`, and **signs the user in** — they have just proven control of the mailbox.

Tests: unknown address still 200 and sends nothing; valid reset changes the password and the old one stops working; token is single-use; expired token 400; weak new password 400; reset issues a session.

## Phase 2 exit gate

`npm test`, `npm run lint`, `npx tsc --noEmit` all clean, and a manual `npm run dev:next:mock` sign-up → verify → sign-out → sign-in round trip. The suite cannot prove the email actually arrives; that is checked once by hand against a real address.
