# Multi-provider auth: email + password, Google, Apple

**Date:** 2026-08-26
**Status:** Design approved, ready for implementation plan
**Flag:** `NEXT_PUBLIC_FLAG_AUTH_PROVIDERS` (planned removal 2026-10-15)

## Goal

Let people create an account with email + password, Sign in with Google, or Sign
in with Apple. Existing name + PIN members keep working untouched, and are nudged
— never forced — to add a stronger credential.

## The one decision everything else follows from

**Identity stays name-keyed. The new providers are a credential layer that
resolves to the existing `memberId`.**

`LOWER(c.name)` is the join key in `players`, `skills`, `members`,
`stats/attendance`, `stats/club/bands`, `stats/insight`, `admin`, `recover`,
`reset-access` and `lib/memberResolve.ts`. `ownsNameOrAdmin()` compares the
cookie's `name`. Re-keying on email would mean rewriting every one of those AND
backfilling an email for members who have never given one — impossible without
asking them, which is the friction this design exists to avoid.

So every new sign-in path terminates at the call `/api/players/recover` already
makes:

```ts
setMemberCookie(res, member.id, member.name);
```

Downstream authorization is unchanged. `isAdminAuthedWithMember()` keeps its live
Cosmos role re-check, so demotion still takes effect on the next request rather
than at cookie expiry. The two-cookie split (`admin_session` vs `member_session`)
survives intact.

## Scope

**In:**

- Email + password sign-up and sign-in, with email verification and password reset.
- Sign in with Google (OIDC authorization code + PKCE).
- Sign in with Apple (OIDC authorization code, `response_mode=form_post`).
- Linking a provider to an already-authenticated member, and unlinking.
- A dismissible upgrade nudge for existing PIN-only members.

**Out (deliberately):**

- Removing or deprecating the PIN. It stays a permanent, valid credential.
  Nobody gets locked out of a badminton game.
- Requiring an account to sign up for a session. The name-only Home flow
  (`useMemberProbe` → `POST /api/players`) is unchanged. Accounts are optional;
  they *claim and secure* an identity that already works without one.
- Email as a login identifier for admin. Admin auth continues to key off
  `member.role === 'admin'` after any successful sign-in.

## Library choice

`arctic@3.7.0`, handshake only. It builds the authorization URL and exchanges the
code; it has no opinion about sessions, storage, or users.

Verified from the published types:

```ts
class Apple {
  constructor(clientId, teamId, keyId, pkcs8PrivateKey: Uint8Array, redirectURI)
  createAuthorizationURL(state, scopes): URL
  validateAuthorizationCode(code): Promise<OAuth2Tokens>
  private createClientSecret            // ES256 JWT, generated internally
}
class Google {
  createAuthorizationURL(state, codeVerifier, scopes): URL   // PKCE built in
  validateAuthorizationCode(code, codeVerifier): Promise<OAuth2Tokens>
}
```

`Apple.createClientSecret` being internal is the reason to take the dependency:
hand-rolling Apple's ES256 client-secret JWT from a `.p8` key is the most
error-prone part of the whole feature.

**Rejected:** Auth.js/NextAuth v5 wants to own the session cookie and has no
first-party Cosmos adapter, so it would run alongside — not replace — the
`member_session`/`admin_session` pair the authorization model reads. A hosted
provider (Clerk/Auth0) offloads real work but adds a vendor holding friends' PII,
assumes a Vercel-shaped deploy while this ships to Azure App Service, and still
needs a mapping back to `memberId` because the join key is `name`.

### id_token signature verification

We decode the `id_token` without verifying its signature. This is safe **only**
because the token is obtained by a direct server-to-server TLS call to the
provider's token endpoint (OIDC Core §3.1.3.7 note 2 permits skipping
verification in exactly this case). If a flow is ever added that receives an
`id_token` from the browser, it must verify against the provider JWKS. This
constraint goes in a comment at the decode site.

## Data model

### `Member` (existing container, additive-and-optional per the schema rule)

```ts
email?: string;              // normalized lowercase. STRIP-CANARY.
emailVerified?: boolean;
passwordHash?: string;       // STRIP-CANARY.
emailVerification?: { hash: string; expiresAt: number };   // STRIP-CANARY.
passwordReset?:     { hash: string; expiresAt: number };   // STRIP-CANARY.
linkedProviders?: ('google' | 'apple')[];  // DISPLAY ONLY, never authoritative
authNudge?: { dismissedAt: string | null };
```

`linkedProviders` exists so Profile can render "Google connected" without a
second query. The `identities` container is the source of truth; a mismatch
resolves in favour of `identities`.

**Every new secret field joins the strip-canary set.** CLAUDE.md's rule: search
`pinHash: _ph` to find all strip sites. `email` is included — member names are
already enumerable via `GET /api/members`, and leaking addresses alongside them
would be a real privacy regression under the standing PIPEDA note.

`email` and `linkedProviders` are a *narrower* canary than `pinHash`: they are
stripped from every list and cross-member response, but returned by
`GET /api/members/me` for the calling member's own record — the same exception
`statsPrivacy` already has, since Profile must render "signed in as
grant@example.com" and which providers are connected. `passwordHash`,
`emailVerification` and `passwordReset` are absolute: never returned anywhere.

### `identities` (new container, PK `/id`)

Created lazily via `ensureContainer('identities', '/id')` — real Cosmos does not
auto-create containers the way the mock store does.

| `id` | purpose |
|---|---|
| `google:<sub>` | provider identity → member |
| `apple:<sub>` | provider identity → member |
| `email:<normalized>` | **uniqueness reservation** for email |

```ts
interface AuthIdentity {
  id: string;
  provider: 'google' | 'apple' | 'email';
  memberId: string;
  createdAt: string;
  lastUsedAt?: string;
}
```

Two properties earn this shape:

1. **The callback lookup is a point read**, not a cross-partition query. `id` is
   both the document id and the partition key, so resolving `google:<sub>` →
   `memberId` is the cheapest operation Cosmos offers, on the hottest path.
2. **`items.create()` gives atomic uniqueness.** Cosmos has no unique constraint
   across partitions, so "is this email taken?" cannot be answered by a query
   without a race. Creating `email:<normalized>` throws 409 on a duplicate id,
   which *is* the uniqueness check. Same for a provider `sub`.

Reading a member back by email (for password sign-in) point-reads
`email:<normalized>` → `memberId` → member. No `LOWER(c.email)` scan anywhere.

## Cookies

### `member_session` / `admin_session`: SameSite `Strict` → `Lax`

**This is required, and it is the single most likely thing to silently break.**
A Strict cookie is not sent on a cross-site navigation, and an OAuth callback is
exactly that. Chrome evaluates the whole redirect chain, so a Strict
`member_session` set by the callback and then 302'd to `/bpm` is not sent on the
landing request: the user is signed in, and the page renders signed-out.

`Lax` still blocks cross-site POST and subresource sends, which is the CSRF
protection that matters here. All mutating routes are `POST`/`PATCH`/`DELETE`
with a JSON content type, which is not simple-form-reachable.

### Transient OAuth cookies

Short-lived (10 min), `httpOnly`, single-use, deleted on the callback.

| cookie | flow | SameSite |
|---|---|---|
| `oauth_state` | Google | `Lax` |
| `oauth_verifier` (PKCE) | Google | `Lax` |
| `oauth_state` | Apple | `None; Secure` |

Apple uses `response_mode=form_post` — the callback is a cross-site **POST**,
which strips even `Lax`. `None` requires `Secure`, so **the Apple flow cannot be
exercised over `http://localhost` at all**. Google can: Google permits
`http://localhost` redirect URIs.

The cookie carries only a random state value, never a session.

## Sign-in paths

All four converge on one function, `lib/authSession.ts`:

```ts
completeSignIn(res, member)  // setMemberCookie + admin cookie sync
```

`syncAdminCookie()` currently lives as a local function inside
`app/api/players/recover/route.ts`. Its comment explains why it exists: it must
**clear a stale `admin_session` when a non-admin signs in**, or admin powers
persist across sign-out → sign-in-as-someone-else. Every new entry point needs
that behaviour, so it moves to `lib/auth.ts` before any new path is added.

### Resolution order on an OAuth callback

```
1. identities[<provider>:<sub>] exists       → sign in as that memberId.
2. valid member_session on this browser      → LINK to that member. (upgrade path)
3. provider email is verified AND matches a
   member with emailVerified === true        → link, then sign in.
4. otherwise                                 → NEW ACCOUNT. Ask for a display
                                               name, prefilled from the provider.
```

Rule 4 needs a UI round-trip, so the callback cannot finish the sign-in itself.
It writes a short-lived (10 min), `httpOnly`, signed `pending_signup` cookie
holding `{ provider, sub, email, emailVerified, suggestedName }` — signed with
the same HMAC helper as the session cookies, so the client cannot forge a
provider identity — then redirects to `/bpm?authFlow=name`. `HomeShell` reads
that query param and opens a `ChooseNameSheet`, which submits to
`POST /api/auth/complete-signup`. That route is the only place a provider
identity becomes a Member. The pending cookie is cleared on success, on
collision-abandon, and on expiry.

**Rule 4 never auto-links by name.** If the requested display name collides with
an existing member, the response is *"That name is taken. If it's you, sign in
with your PIN first, then connect Google from Profile."* Names are enumerable
via `GET /api/members`; WS#3 (2026-06-03) already closed one impersonation hole
that came from treating a name as proof of identity. This is the same hazard.

Rule 3 is safe because it requires verification on **both** sides — the provider
asserting `email_verified`, and our own `emailVerified === true`, which is only
ever set by a link we mailed. It exists so that once the nudge has done its job,
returning on a new device Just Works.

### Apple's one-shot name

Apple returns the user's name **only on the very first authorization, never
again**, in the form-post body rather than the id_token. If it isn't persisted at
that moment it is gone permanently. The callback must read it before anything
else can fail. Apple private-relay addresses also mean the email is not a
human-readable identifier — it is stored, but never shown as a display name.

## Password handling

New `lib/passwordHash.ts`. `lib/recoveryHash.ts` is untouched, so no existing
PIN hash changes.

- scrypt, **N=2^16, r=8, p=1**, with `maxmem` passed explicitly (Node's 32 MB
  default throws above N=2^15). That is ~64 MiB per hash. OWASP's floor is
  N=2^17, but this runs on a small Azure App Service instance and sign-in is
  rare for a friend group; the memory ceiling is the binding constraint. The
  trade-off is recorded here rather than left implicit.
- Stored **self-describing**: `scrypt$N$r$p$saltHex$hashHex`. `recoveryHash`'s
  bare `salt:hash` cannot survive a parameter change; this can.
- Constant-time miss against a module-level `FAKE_PASSWORD_HASH`, mirroring
  `FAKE_HASH`, so timing can't distinguish "no such email" from "wrong password".
- Minimum 10 characters. No composition rules (they push people to `Passw0rd!`).
  Reject the top-N common passwords via a small embedded list.

## Email

Reuses the already-configured Gmail SMTP transport — `GMAIL_USER` /
`GMAIL_APP_PASSWORD` / `REPORT_EMAIL_TO` are confirmed present in the
`vnext-badminton-app` App Settings. New `lib/authEmail.ts` follows
`lib/reportEmail.ts` exactly: lazy `nodemailer` import, env-gated, returns
`{ sent: false }` rather than throwing when unconfigured.

- **Verification token**: 32 random bytes hex, stored as its SHA-256. Fast
  hashing is correct here — the token has 256 bits of entropy, so stretching
  buys nothing and only costs latency. 24 h TTL, single use.
- **Reset token**: same shape, 1 h TTL, single use, invalidated when a password
  is set by any other route.
- `POST /api/auth/forgot-password` **always returns 200**, whether or not the
  address exists. Anything else is an account-enumeration oracle.

## Routes

All under `app/api/auth/`. Rate limit first in every handler, before auth and
before body parsing (security rule 4).

| route | limit |
|---|---|
| `POST /signup` | 5/hr per IP |
| `POST /signin` | 5/hr per (email, IP) — matches `/recover` |
| `POST /forgot-password` | 3/hr per IP |
| `POST /reset-password` | 5/hr per IP |
| `GET /verify-email` | 10/hr per IP |
| `GET /google/start`, `GET /google/callback` | 10/hr per IP |
| `GET /apple/start`, `POST /apple/callback` | 10/hr per IP |
| `DELETE /identity` | 5/hr per IP |

`DELETE /identity` **refuses to remove the last remaining credential** — a
member must always retain at least one of {PIN, password, linked provider}, or
they lock themselves out.

## The upgrade nudge

Shown when the member has a PIN and has **no** email and **no** linked provider.
Hidden permanently the moment either exists.

- `SecureAccountCard` on Profile, using `<CardHeader>` + `cc-btn` per the design
  system.
- A one-time `AuthUpgradeSheet` (`<BottomSheet>` primitive) after a successful
  PIN sign-in.
- Dismissal is stored on the **member** (`authNudge.dismissedAt`), not
  localStorage — a per-device dismissal would re-nag on every device. Reappears
  after 30 days.

Copy follows the friend-voice principle: "Add an email so you can get back in if
you forget your PIN" — not "Upgrade your authentication method."

## Testing

**What the vitest suite can prove:** state/PKCE generation and verification,
password hash round-trip and format parsing, the constant-time miss, the
identity-resolution decision table (extracted as a pure function taking a
lookup result + cookie state and returning an action), email normalization,
409-on-duplicate uniqueness, `DELETE /identity` last-credential refusal, nudge
visibility, and both flag branches.

**What it cannot prove:** the OAuth handshake itself. The mock store never
performs a cross-site redirect, so a green run says nothing about the flow most
likely to break — the SameSite behaviour above. A passing suite must not be
reported as evidence that Google or Apple sign-in works.

**Real verification:**

1. Google end-to-end against `http://localhost:3000/bpm` with real credentials.
2. Apple end-to-end in production behind the flag, or via an https tunnel —
   Apple rejects localhost Return URLs.
3. Confirm the landing page after each callback renders **signed-in**. That is
   the specific assertion that catches the SameSite regression.

## Operational notes

- **Apple's client secret expires.** The `.p8`-derived JWT has a 6-month maximum
  lifetime. `arctic` regenerates it per request, so there is nothing to rotate —
  but the underlying `.p8` key must not be revoked in the Apple developer
  console, and `APPLE_KEY_ID` / `APPLE_TEAM_ID` must stay in sync with it.
- New env vars (Azure App Settings + `.env.local.example`):
  `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `APPLE_CLIENT_ID` (the Service ID),
  `APPLE_TEAM_ID`, `APPLE_KEY_ID`, `APPLE_PRIVATE_KEY` (the `.p8` contents),
  `NEXT_PUBLIC_APP_ORIGIN` (for building absolute redirect URIs).
- Per the schema rule, every field added here is additive and optional, so a
  rollback to older code against the same live database still builds and runs.

## Staging

1. **Foundation** — `identities` container, Member fields, strip sites,
   `lib/passwordHash.ts`, extracted `syncAdminCookie`, SameSite change, flag.
2. **Email + password** — signup, signin, verification, reset, `lib/authEmail.ts`.
3. **Google** — start/callback, resolution table, linking.
4. **Apple** — start/form-post callback, one-shot name capture.
5. **Nudge + Profile** — `SecureAccountCard`, `AuthUpgradeSheet`, linked-provider
   management, unlink.

Each stage ends with the full `npm test` **and** `npm run lint` — a per-task
review scoped to its own diff cannot see cross-file breakage, and this branch
touches shared auth code that many test files assert against.
