# A2 — Identity Recovery Bridge

**Status:** Design — pending review
**Date:** 2026-04-26
**Sprint:** P1.5 Access & Admin Relief
**Flag:** `NEXT_PUBLIC_FLAG_RECOVERY` (planned removal: 2026-05-24, four weeks after first ship)

## Goal

Give a player a way to restore their access to a session when they no longer have a working `deleteToken` in `localStorage`. Today the only recovery is "ping the admin and have them rebuild your record by hand" — A2 turns that into a deliberate, auditable flow.

## Non-goals

- Not building email/SMS/OTP-based recovery. No contact-info column exists; adding one is a separate project.
- Not adding SSO / OAuth / WeChat / Google sign-in.
- Not building a CAPTCHA, bot-detection, or device-trust system.
- Not consolidating the two existing auth axes (player `deleteToken` vs admin cookie). They stay orthogonal.
- Not folding the entire Admin tab into Profile. ProfileTab exposes a single "Admin tools →" entry point that routes to the existing Admin tab; admin UI itself is untouched.

## Threat model

In scope:

- **A. Same-device cleared cache.** Player cleared site data on their phone. They are who they say they are; they just lost the token. Recover via PIN if one was set, else admin-mediated.
- **C. Lost-device recovery.** Player got a new phone or wiped their old one. They have no access to the original `deleteToken`. Recover via admin-mediated 6-digit code.
- **E. Impersonation defense.** Stop "Grant" from being able to self-cancel "Michael" just by typing "Michael" into a recovery form. Both paths require proof.

Out of scope:

- **B. New-device migration with old device still working.** Use the existing flow on the old device.
- **D. Friend's phone for one-off self-cancel.** Acceptable to ask admin instead.
- **Admin compromise.** If admin auth is compromised, the attacker has more than recovery-code generation.

## Architecture

### Schema changes (additive, optional)

Both deployments share one Cosmos DB. Per CLAUDE.md's schema rule, all changes are additive and optional.

On the player doc (container: `players`, partition key: `/sessionId`):

```ts
type RecoveryEvent =
  | { event: 'pin-set'; at: string }
  | { event: 'pin-removed'; at: string }
  | { event: 'reset-access-issued'; at: string; admin: 'admin' }
  | { event: 'recovered-via-pin'; at: string }
  | { event: 'recovered-via-code'; at: string }
  | { event: 'recovery-failed'; at: string; reason: 'wrong_pin' | 'wrong_code' | 'expired_code' };

interface Player {
  // ... existing fields ...
  pinHash?: string;            // bcrypt(pin, 10), never returned in any response
  recoveryEvents?: RecoveryEvent[]; // capped at 200, drop oldest
}
```

`pinHash` is stripped from every API response that returns a player record (same rule as `deleteToken`). A canary test asserts `pinHash` never appears in any GET/PATCH response.

### In-memory recovery-code store

Recovery codes are not persisted to Cosmos. They live in a process-local map for 15 minutes max:

```ts
type ActiveCode = {
  playerId: string;
  sessionId: string;
  codeHash: string;     // bcrypt(code) — plaintext code is never stored
  expiresAt: number;    // Date.now() + 15 * 60 * 1000
};

// keyed by playerId — re-issuing a code overwrites the prior one
const activeCodes: Map<string, ActiveCode>;
```

The map is module-level state in a new `lib/recovery-codes.ts`. Cold-start invalidates outstanding codes — acceptable: 15-min TTL is much shorter than typical Azure B1 cold-start intervals during active use, and an invalidated code just means "ask admin for a new one."

### Endpoints

#### `POST /api/players/recover`

Body: `{ name: string, sessionId: string, pin?: string, code?: string }`. Exactly one of `pin` or `code` must be present.

Pre-execution gate order:

1. Rate limiter: 5 attempts per `(name, IP)` per hour → 429 with retry-after.
2. Input validation: name length, sessionId valid, pin = exactly 4 numeric digits OR code = exactly 6 numeric digits.
3. Load player by `(sessionId, lower(name))`.
4. **Constant-time miss handling:** if no player or `pinHash` is unset, perform a dummy `bcrypt.compare(input, FAKE_HASH)` against a pre-computed fixed hash so wall-clock latency matches a real failed compare. Return generic 401 `invalid_credentials`.
5. PIN path: `bcrypt.compare(pin, player.pinHash)`. Match → success.
6. Code path: look up `activeCodes.get(player.id)`, check `expiresAt > now`, `bcrypt.compare(code, entry.codeHash)`. Match → success.

On success:
- Mint a new `deleteToken = randomBytes(16).toString('hex')`.
- Update player doc: write new `deleteToken`, append `recovery-events` entry (capped at 200), do NOT touch `pinHash`.
- Delete the code entry from `activeCodes` (single-use).
- Return `{ deleteToken }` once. `pinHash` and the existing `deleteToken` are stripped from any related response shape.

On failure:
- Append `recovery-failed` event to the player's `recoveryEvents` array (only if a real player was found — non-existent names don't get audit-logged, by design, since they don't have a doc).
- Return `{ error: 'invalid_credentials' }` with 401.
- Increment rate-limit counter for `(name, IP)`.

The endpoint never indicates whether the failure was "no PIN set", "wrong PIN", "no code outstanding", "wrong code", or "expired code". One generic error.

**Admin bypass: explicitly disallowed.** Admin auth is checked and rejected on this endpoint — admins must use `/reset-access` to mint a code, not `/recover` to mint a token directly. Keeps the admin path auditable.

#### `POST /api/players/reset-access`

Body: `{ playerId: string }`.

Pre-execution gate order:

1. Rate limiter: 10 attempts per admin per hour → 429.
2. `isAdminAuthed(req)` → 401 if not admin.
3. Validate `playerId` is a string.
4. Load player by `(activeSessionId, playerId)` — partition key matters here (CLAUDE.md gotcha #2 on `container.item(docId, partitionKeyValue)`).
5. Reject if `player.removed === true` — admin should restore first.

On success:
- Generate a 6-digit code via `crypto.randomInt(100000, 1000000)`.
- Compute `codeHash = bcrypt(code, 10)`.
- Set `activeCodes.set(playerId, { playerId, sessionId, codeHash, expiresAt: Date.now() + 15 * 60 * 1000 })`. Overwrites any prior entry for that player.
- Append `reset-access-issued` event to player's `recoveryEvents`.
- Return `{ code, expiresAt }` once. Plaintext code is never logged or persisted.

#### `PATCH /api/players/[id]` (extending the existing route)

New supported body fields:

```ts
{ pin?: string | null, deleteToken?: string }
```

Setting `pin` to a 4-digit string sets/changes the PIN. Setting `pin: null` clears it.

Pre-execution gate order:

1. Existing rate limiter on this route.
2. `isAdminAuthed(req) || matchesDeleteToken(player, body.deleteToken)`.
3. PIN format validation: exactly 4 digits.
4. Soft blocklist check: reject if `pin` is in `['0000', '1111', '1234', '4321', '1212']` with `{ error: 'pin_too_common' }` 400.
5. Update: `pinHash = bcrypt(pin, 10)` for set, `pinHash = undefined` for clear.
6. Append `pin-set` or `pin-removed` event.

Returns the updated player record with `pinHash` and `deleteToken` stripped.

### Client surface

#### Bottom navigation

The navigation drops from the current 4 tabs (Home, Sign-Ups, Stats, Admin) to a different 4 tabs (Home, Sign-Ups, Stats, **Profile**). The `activeTab` state machine still has an `'admin'` value; it's just no longer surfaced in the bar. The Admin tab is reachable only by:

- Tapping "Admin tools →" on ProfileTab (shown only when `isAdmin === true`).
- The `?tab=admin` deep link (preserved for backwards compatibility).

The CLAUDE.md "4 tabs" gotcha line is updated to reflect the new set. New i18n key: `nav.profile` (en + zh-CN).

#### `<ProfileTab>` (new)

State-driven render:

| State | Rendered content |
|---|---|
| Anonymous (no identity, not admin) | Empty-state copy: "You're not signed up yet — head to Sign-Ups to join a session." Below: "Already a player but lost your access? Restore here." → opens `<RecoverySheet>`. |
| Player only (identity, not admin) | Read-only name + "signed up for [date]". Recovery PIN row (state: "Not set" + "Set PIN" button OR "Set" + "Change" / "Remove" buttons). |
| Admin only (no player identity, admin cookie) | Empty-state copy + "Admin tools →" button at the bottom. |
| Both (player + admin) | Full player profile + "Admin tools →" at the bottom. |

PIN management uses inline expansion within the tab: tapping "Set PIN" / "Change" reveals a 4-digit input + confirm input. Save → `PATCH /api/players/[id]` with current `deleteToken` from localStorage. No re-auth challenge — the deleteToken in localStorage is the auth.

The "Restore my access" entry on Sign-Ups tab (originally in Section 2) is removed. Profile is the canonical recovery entry point.

Admin status detection on the client mirrors whatever pattern `app/page.tsx` uses today for showing/hiding the Admin tab — no new admin-status probe is invented for this work.

#### `<RecoverySheet>` (new, uses `BottomSheet` primitive)

Two paths in a vertical stack:

**Path 1 — "I have my PIN"**
- Name autocomplete (sources from active session's player list, same as the existing invite-list enforcement on Sign-Ups).
- 4-digit PIN input (`inputMode="numeric"`, `autoComplete="off"`).
- Submit → `POST /api/players/recover` with `{ name, sessionId, pin }`.

**Path 2 — "Ask admin for a code"**
- Copy: "Tell the admin you lost access. They'll give you a 6-digit code."
- Name autocomplete + 6-digit code input.
- Submit → `POST /api/players/recover` with `{ name, sessionId, code }`.

Both paths share success behavior: server returns fresh `deleteToken` → client writes new identity to localStorage via `setIdentity()` → sheet shows "Welcome back, [name]" for ~1.5s and closes.

Failure handling:
- 401 `invalid_credentials` → inline error: "That didn't match. Try again." Attempt counter shown after second failure ("3 attempts left").
- 429 `rate_limited` → banner: "Too many tries. Try again in [retryAfter] minutes." Both inputs disabled during lockout.
- "Code expired" returns 401 too (single error surface) but the player can ask admin for a new code.

#### `<SignUpForm>` extension on Sign-Ups tab

Below the existing name input, add an opt-in checkbox: "Set a recovery PIN (optional)". Checked → 4-digit numeric input expands beneath. PIN is sent on the existing `POST /api/players` body as an extra `pin?: string` field. Unchecked or empty → omitted.

If the player picks a blocklisted PIN, server returns 400 `pin_too_common` and the form shows: "Pick a less common PIN."

#### `<AdminPlayerActions>` on Admin tab

Each active player row gains a "Reset access" button (positioned next to existing remove/restore actions).

- Tap → confirm dialog: "Generate a recovery code for [name]? They'll be able to use it to restore their access on a new device. The code expires in 15 minutes."
- Confirm → `POST /api/players/reset-access`.
- Success → `<ResetAccessSheet>` (BottomSheet) shows the 6-digit code in monospace, an expiry countdown, and a "Copy" button using `navigator.clipboard.writeText(code)`. Sheet closes when admin taps "Done."

Soft-deleted players (`removed: true`) do NOT get the button; restore them first.

### Feature flag

`NEXT_PUBLIC_FLAG_RECOVERY` registered in `lib/flags.ts`. Default off. On `bpm-next` until proven; promoted to `bpm-stable` on next tag after smoke-testing.

Server-side flag-off behavior on the new endpoints (`/recover`, `/reset-access`): return **404** route-not-found shape. Client-side flag-off behavior: ProfileTab still exists (it's a regular nav tab) but recovery affordances and PIN management are hidden. PATCH PIN paths return 400 for `pin` field with flag off. Sign-up form's PIN checkbox is hidden.

## Security model

### Threats and mitigations

| Threat | Mitigation |
|---|---|
| Brute-force the 4-digit PIN (10K combos) | 5 attempts per `(name, IP)` per hour → 15-min lockout. |
| Brute-force the 6-digit admin code (1M combos) | Same lockout. 15-min code TTL. Combined: brute force is infeasible. |
| Lock-out attack (attacker exhausts another player's recovery attempts) | Lockout keyed on `(name, IP)`, not just `name`. Attacker locks themselves out from one IP; legit player from a different IP unaffected. |
| Stolen recovery code | 15-min TTL, single-use, auto-invalidated when admin re-issues. |
| Stolen PIN | Rate limit slows abuse. Player can change/remove PIN any time from Profile. |
| Enumeration via response shape | Single `invalid_credentials` error for all PIN/code failure modes. |
| Enumeration via response timing | Constant-time response: dummy `bcrypt.compare` against `FAKE_HASH` when player or PIN is missing. |
| Enumeration via rate-limit-bucket existence | Real and fake names both get rate-limit buckets allocated on first request. |
| Replay of an old recovery response | Recovery overwrites the player's `deleteToken` field. Old token immediately invalid. |
| Memory dump of running process | Codes and PINs are stored as bcrypt hashes, never plaintext. |

### Out of scope

- ❌ CAPTCHA. Friend-group scale, rate limiter is enough.
- ❌ Email/SMS OTP. No contact-info column.
- ❌ SSO / OAuth.
- ❌ Comprehensive PIN strength meter / common-PIN blocklist beyond a soft 5-entry check.
- ❌ "Remember this device" beyond what localStorage already does.

## Testing strategy

All tests use the in-memory mock store (no Cosmos integration tests). Each test gets a unique `X-Client-IP` to avoid rate-limit collisions across the suite.

### New tests

| Behavior | Layer | File |
|---|---|---|
| Recover with valid PIN | API | `__tests__/players-recover.test.ts` (new) |
| Recover with valid code | API | same |
| Recover with wrong PIN | API | same |
| Wrong PIN N times → 429 | API | same |
| Real vs fake name: identical response shape and rate-limit behavior | API | same |
| Recovery succeeds → old `deleteToken` invalidated | API | same |
| Recovery succeeds → new token returned | API | same |
| Recovery succeeds → `recoveryEvents` appended | API | same |
| Expired code returns generic `invalid_credentials` | API | same |
| Re-issue code invalidates prior code | API | `__tests__/players-reset-access.test.ts` (new) |
| Reset-access non-admin → 401 | API | same |
| Reset-access rate-limit → 429 | API | same |
| PATCH PIN set | API | `__tests__/players.test.ts` (extend) |
| PATCH PIN with blocklisted value → 400 | API | same |
| PATCH PIN without `deleteToken` and not admin → 401 | API | same |
| `pinHash` never appears in any GET/PATCH response | API | `__tests__/players.test.ts` canary |
| ProfileTab renders for player + admin + ∅ | Component | `__tests__/components/ProfileTab.test.tsx` (new) |
| ProfileTab "Admin tools →" gated on `isAdmin` | Component | same |
| RecoverySheet PIN path → success | Component | `__tests__/components/RecoverySheet.test.tsx` (new) |
| RecoverySheet code path → success | Component | same |
| RecoverySheet locked-out state | Component | same |
| BottomNav has Profile, no longer Admin | Component | extend existing nav tests |
| Flag off → endpoints 404 | API | `__tests__/flags.test.ts` pattern |
| Flag off → ProfileTab hides recovery affordances | Component | flag pattern |

### Patterns to follow

- Component tests wrap with `<NextIntlClientProvider locale="en" messages={enMessages}>`. Reference: `__tests__/components/CostCard.test.tsx`.
- Manual `cleanup()` from `@testing-library/react` between cases. Reference: `__tests__/components/PrevPaymentReminder.test.tsx`.
- Flag tests mutate `process.env` in `beforeEach`. Reference: `__tests__/flags.test.ts`.
- Per-test unique IPs via `X-Client-IP`. Reference: `__tests__/helpers.ts`.

### Manual smoke tests on `bpm-next`

1. Sign up as a player with an opt-in PIN.
2. Clear localStorage. Open Profile → "Restore my access" appears.
3. Tap → enter name + PIN → success → identity restored, can self-cancel.
4. Clear localStorage. Try wrong PIN 5 times → 429 banner with retry-after, inputs disabled.
5. Wait for lockout, then admin issues code → enter code → success.
6. (Trust the unit test for the old-token-invalidated assertion — no manual step.)
7. Toggle flag off → confirm Profile shows nothing recovery-related, endpoints return 404.

### Out of test scope

- ❌ E2E / Playwright. Repo doesn't have E2E infra; not adding one.
- ❌ Load testing the rate limiter.
- ❌ Cosmos integration tests. Mock store is the trusted pattern (316 tests).

## Files touched

**New:**
- `app/api/players/recover/route.ts`
- `app/api/players/reset-access/route.ts`
- `lib/recovery-codes.ts`
- `components/ProfileTab.tsx`
- `components/RecoverySheet.tsx`
- `components/admin/ResetAccessSheet.tsx`
- `__tests__/players-recover.test.ts`
- `__tests__/players-reset-access.test.ts`
- `__tests__/components/ProfileTab.test.tsx`
- `__tests__/components/RecoverySheet.test.tsx`

**Modified:**
- `app/api/players/route.ts` (sign-up: accept optional `pin`)
- `app/api/players/[id]/route.ts` (PATCH: accept `pin`)
- `lib/types.ts` (add `pinHash`, `recoveryEvents` to `Player`)
- `lib/flags.ts` (register `NEXT_PUBLIC_FLAG_RECOVERY`)
- `lib/identity.ts` (no API change; ensure `setIdentity` is called consistently from recovery success path)
- `app/page.tsx` (replace Admin nav slot with Profile; route `?tab=admin` deep link still works)
- `components/BottomNav.tsx` (Profile entry, drop Admin)
- `components/HomeTab.tsx` (no change — recovery does not live here)
- `components/admin/PlayerActions.tsx` (or wherever per-row actions render today — add "Reset access" button)
- `components/SignUpForm.tsx` (or the equivalent on Sign-Ups tab — add opt-in PIN)
- `messages/en.json` and `messages/zh-CN.json` (new keys: `nav.profile`, `profile.*`, `recovery.*`, `pin.*`)
- `CLAUDE.md` (update "4 tabs" gotcha; document the recovery flow + flag)

## Open questions for review

None. All section-level decisions were locked during brainstorm.

## Future work (not part of A2)

- Issue #29: admin signup-toggle is a no-op on finished sessions. Independent UX deficit, surfaced during the A2 brainstorm but unrelated to recovery.
- Migration path if PIN adoption gets high enough that we want to make it required for new sign-ups. Schema is already additive-friendly.
- Audit log to a dedicated container if per-player query patterns ever justify it. Today's array-on-doc approach is sufficient.
