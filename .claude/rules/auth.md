---
paths:
  - "lib/auth*.ts"
  - "lib/identity.ts"
  - "lib/pinLockout.ts"
  - "lib/recovery*.ts"
  - "lib/memberRecoveryCode.ts"
  - "lib/useHasPin.ts"
  - "lib/playerIdentity.ts"
  - "app/api/admin/route.ts"
  - "app/api/admin/settings/**"
  - "app/api/auth/**"
  - "app/api/players/**"
  - "app/api/members/**"
  - "components/auth/**"
  - "components/profile/**"
  - "components/onboarding/**"
  - "components/ProfileTab.tsx"
  - "components/SignInForm.tsx"
  - "components/RecoveryPinSheet.tsx"
  - "components/RecoverySheet.tsx"
  - "components/CreateAccountSheet.tsx"
  - "components/HomeShell.tsx"
  - "components/AdminTab.tsx"
  - "components/StringingTab.tsx"
  - "components/admin/**"
  - "__tests__/*auth*.test.ts"
---

# Sign-in, identity and the admin cookie

<!-- Moved word for word from the root CLAUDE.md "Gotchas" on 2026-11-09, to keep the always-loaded file short. -->

- **Auth taxonomy** (since 2026-04-30, restructured 2026-05-12): three distinct concepts, but the user-facing surfaces are unified.
  - **Sign up** = register for the active session from Home's card; the server takes the name from the signed-in account (rule 13). The adaptive name-and-PIN form that was the flag-OFF path was deleted when the flag retired (2026-10-17); its history is in `docs/gotchas-history.md`.
  - **Create account** = identity-only creation, still lives in Profile's `CreateAccountSheet` for invite flow (`sessionSignup: false`). Refuses with 409 `account_exists` if a member already has a `pinHash` (prevents account hijack).
  - **Sign in** (Profile path) = name + PIN auth via `<SignInForm>` rendered inline on ProfileTab's anonymous view (and on the members-only Log in page, with `probeName={false}` — telling a stranger whether a name has a PIN is the oracle members-only closes). POST `/api/players/recover` verifies against `members.pinHash` and returns **identity-only** (`deleteToken: null`). **Its `sessionId` is optional**: absent, the active session is resolved server-side, because the signed-out screen cannot read the session and handing it the id would publish the date — Profile sign-in does NOT auto-register for a session. Constant-time miss against `FAKE_HASH`. Rate-limited 5/hr per `(name, IP)`.
  - **Cancel spot** ≠ **Sign out**. `HomeTab.handleCancel` (moved from the retired Sign-Ups tab) removes the user from the active session player list and zeroes the deleteToken (server consumed it), but preserves name + sessionId in localStorage. The user stays signed in and can re-sign-up with one tap. `clearIdentity()` belongs only in `ProfileTab.handleLogout`.
  - PINs scrypt-hashed via `lib/recoveryHash.ts`. Lost-device admin code via `POST /api/players/reset-access` (10/hr per IP, 6-digit, 15-min TTL, dead after `MAX_CODE_ATTEMPTS` (5) wrong tries; on someone who holds a rank it is an organiser's call, `organiser_only`, because the code clears the PIN). Stored as a scrypt hash on the MEMBER DOC (`Member.recoveryCode`) by `lib/memberRecoveryCode.ts` — it survives cold starts. This line used to name an in-memory `lib/recoveryCodes.ts` that "does NOT survive cold starts"; that file was deleted when the code moved onto the member doc, and the stale warning had people designing around a constraint that no longer exists.
  - **Recovery code path clears `members.pinHash`** (and the `players.pinHash` mirror) on success — the user reached this path because they forgot their PIN, so any subsequent `RecoveryPinSheet` should render in 2-field mode (no current-PIN prompt). Without this, the sheet's `hasPin` check left users stuck after a reset. **It also mints a `member_session` cookie** (consuming a valid admin-issued code proves identity, same as a PIN sign-in) — this is what lets the user pass the members/me first-set guard below when they pick a replacement PIN. (WS#3, 2026-06-03.)
  - **`PATCH /api/members/me` first-PIN set (claim flow) requires identity proof** (WS#3, 2026-06-03): a `member_session` cookie for that name (minted at sign-up, PIN sign-in, or recovery-code reset) OR admin. Previously name-only — member names are enumerable via `GET /api/members`, so anyone could claim an unclaimed (no-PIN) account and sign in as them. The **change-PIN** branch is unaffected (`currentPin` is its credential). Client-side: `GET /api/members/me` returns `authed`; `ProfileTab` passes it to `RecoveryPinSheet`, which blocks first-set with actionable guidance (`profile.pinNeedsSignIn`) when known-not-authed (e.g. cookie expired past its 30-day TTL while `localStorage` identity persists), and never blocks on `authed === null` (unknown — server is the backstop).
  - Profile signed-in, ACCOUNT section: **`How you sign in`** → `SignInMethodsSheet`, then `Update PIN`, then `Have a recovery code?`. All three are `SettingsList` rows opening sheets. The sign-in row carries a summary (`PIN · Google`) and goes `accent` when the server sets `nudge: true` — the upgrade prompt used to be an expanded card sitting in the list. Its data comes from `useSignInMethods()`, owned by `ProfileTab` and handed to the sheet so the row and the sheet cannot disagree; it is gated on `identity` because the anonymous card must not probe `/api/auth/methods`.
  - PIN management lives in Settings as `New PIN` / `Update PIN` row → opens `RecoveryPinSheet` (Set/Change only — no Remove). Status sourced from `/api/members/me?name=X` returning `hasPin`, refetched on identity change.
  - **PIN is opt-in** — nothing forces one.
  - **Admin login**: per-player auth via name + own PIN (`POST /api/admin`); cookie HMAC-signed via `SESSION_SECRET`. `member.role === 'admin'` required. Bootstrap names via `ADMIN_NAMES` env var. **Cookie TTL is 30 days** (`COOKIE_MAX_AGE_S` in `lib/auth.ts`).
  - **AdminTab has no standalone Sign-out button** (since v1.3) — single auth surface lives in Profile. Profile logout calls `DELETE /api/admin` to clear the admin cookie.
- **`IDENTITY_EVENT`** (`lib/identity.ts`): a `CustomEvent('badminton:identity-changed')` is dispatched from `setIdentity` and `clearIdentity`. Page-level state (admin nav refresh in `app/page.tsx`) and `ProfileTab` subscribe so sign-in/out reactivity works without refresh. Browser `storage` events fire only in OTHER tabs — the custom event is needed for same-tab updates. Any new component mirroring `getIdentity()` in local state should subscribe.
- **Admin-only settings live behind `/api/admin/settings`, not `/api/members`**: scanning the public members list for `role: admin` is fragile (multiple admins, response-shape changes leak attributes). The auth-gated `GET/PATCH /api/admin/settings` reads/writes the calling admin's own `eTransferRecipient` and `skipDates`. Used by `SkipDatesEditor`, `ETransferRecipientEditor`, `AdvanceSessionForm`, and the `CommandCenter` receipt loader.
- **The shell's `showAdmin` is the ROLE; the admin COOKIE is a separate fact** (2026-11-06, Grant: "the add a job stringing job save button does not work"). `HomeShell` shows admin surfaces when `GET /api/admin` says the admin cookie is live OR `members/me` says the role is admin, so an admin whose `admin_session` lapsed while the member cookie lived on still sees them — and every admin route checks the cookie. The Stringing bench opened, its job list said "Try again", `GET /api/members` answered the non-admin roster (no ids), so the player search found nobody and "Save job" never turned on. A screen whose reads need the admin cookie gates on `adminCookieLive` (passed down as `knownAuthed` / `adminSession`, `null` while unknown) and shows `AdminSignInCard` (`components/admin/AdminSignInCard.tsx`, the one PIN sign-in, shared with the Admin tab) in front of the work; a sign-in on either calls the shell's `refreshAdminAccess` so the other opens too (`__tests__/components/StringingTab.test.tsx`).
