# Setting up Google and Apple sign-in credentials

Everything here is done once, in a browser, outside the repo. The app reads the
results from environment variables — server-side only, so they can be changed in
Azure App Settings without a rebuild.

At the end you will have:

```
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
APPLE_CLIENT_ID=          # the Services ID, e.g. com.motioncraft.bpm.web
APPLE_TEAM_ID=            # 10 characters
APPLE_KEY_ID=             # 10 characters
APPLE_PRIVATE_KEY=        # the contents of the .p8 file
APPLE_DOMAIN_ASSOCIATION= # the contents of Apple's domain-association .txt
APP_ORIGIN=               # REQUIRED in production. http://localhost:3000 locally
```

---

## Google (~10 minutes, testable on localhost)

### 1. Project

<https://console.cloud.google.com/> → project picker → **New Project** →
name it `bpm-badminton` → Create.

### 2. Consent screen

**APIs & Services → OAuth consent screen**

- User type: **External**
- App name: `BPM Badminton`
- User support email: your address
- Developer contact: your address
- **Scopes**: add `openid`, `.../auth/userinfo.email`,
  `.../auth/userinfo.profile`. Nothing else. These three are *non-sensitive*,
  which is what lets you skip Google's verification review entirely.
- **Publish the app** (the "Publish App" button on the consent-screen page).

  Leaving it in *Testing* works, but caps you at 100 named test users who each
  have to be added by hand — every friend would have to be listed. Publishing
  with only non-sensitive scopes does **not** trigger a review.

### 3. Credentials

**APIs & Services → Credentials → Create Credentials → OAuth client ID**

- Application type: **Web application**
- Name: `BPM Badminton web`

**Authorized JavaScript origins**

```
http://localhost:3000
https://bpm.grantzou.com
```

**Authorized redirect URIs** — these must match byte for byte, including `/bpm`:

```
http://localhost:3000/bpm/api/auth/google/callback
https://bpm.grantzou.com/bpm/api/auth/google/callback
```

Create → copy the **Client ID** and **Client secret**.

> A mismatched redirect URI is the single most common Google failure, and the
> error (`redirect_uri_mismatch`) names the URI it received — compare it
> character by character against the list above. `/bpm` is easy to drop.

---

## Apple — being brought online (2026-09-15)

> The code is merged and switched on (`NEXT_PUBLIC_FLAG_AUTH_PROVIDERS: 'true'`).
> What keeps the button hidden in production is only the four env vars below:
> `configuredProviders()` omits Apple without them, and
> `/api/auth/apple/start` answers a distinct 503. Setting them IS the launch —
> no deploy needed for that step.
>
> **Before the credentials go in**, two App Review requirements are already
> handled in code: the button follows Apple's spec (`.btn-apple` + `AppleMark`),
> and deleting an account or disconnecting Apple revokes the member's Apple
> tokens (`lib/appleRevoke.ts`, called from `purgeMember` and
> `DELETE /api/auth/identity`). The refresh token that makes revocation possible
> is kept server-side by Apple `sub` (`storeAppleRefreshToken` in
> `lib/authIdentity.ts`) and pinned to its files by
> `__tests__/apple-token-canary.test.ts`.
>
> **Only `bpm.grantzou.com` needs registering with Apple**, even for home-screen
> installs that run on the `*.azurewebsites.net` host: the `redirect_uri` is
> always built from `APP_ORIGIN` (`lib/appOrigin.ts`), never from the host the
> sign-in started on. That jar split is what the pop-up / typed-code hand-off
> already bridges.

## Apple (~30 minutes, **cannot** be tested on localhost)

Requires the paid Apple Developer Program membership you already have.

### Why localhost is impossible here

Two independent reasons, both from Apple's side:

1. Apple refuses to register `localhost` (or any non-HTTPS URL) as a Return URL.
2. Apple's callback is a cross-site `POST` (`response_mode=form_post`), which
   strips a `SameSite=Lax` cookie. Our state cookie therefore has to be
   `SameSite=None`, and browsers only honour `None` alongside `Secure` — which
   is not stored on a plain-HTTP origin.

So Apple is verified either against an HTTPS tunnel (`ngrok`, `cloudflared`) or
in production behind the flag. This is expected, not a misconfiguration.

### 1. App ID

<https://developer.apple.com/account/resources/identifiers/list>

**Identifiers → + → App IDs → App**

- Description: `BPM Badminton`
- Bundle ID (explicit): `com.motioncraft.bpm`
- Capabilities: tick **Sign In with Apple**
- Continue → Register

### 2. Services ID — this becomes `APPLE_CLIENT_ID`

**Identifiers → + → Services IDs**

- Description: `BPM Badminton Web`
- Identifier: `com.motioncraft.bpm.web`  ← **this exact string is `APPLE_CLIENT_ID`**
- Register, then click back into it and tick **Sign In with Apple → Configure**:
  - Primary App ID: `com.motioncraft.bpm`
  - **Domains and Subdomains**: `bpm.grantzou.com`
  - **Return URLs**: `https://bpm.grantzou.com/bpm/api/auth/apple/callback`

### 3. ⚠️ Domain verification — read the obstacle below first

Apple gives you `apple-developer-domain-association.txt` and requires it at:

```
https://bpm.grantzou.com/.well-known/apple-developer-domain-association.txt
```

**This needed a two-part fix, which is now in place** — you do not host a file,
you set an env var.

`basePath: '/bpm'` puts everything in `public/` under `/bpm/...`, so Apple's
fetch of the domain root would 404. Two mechanisms were needed, and neither
works alone (both established by testing against a running server):

1. **`proxy.ts` cannot see the domain root.** Next auto-prefixes the middleware
   matcher with the basePath, so `/.well-known/...` never reaches it — verified
   by the locale cookie not being set at `/` either. It can only answer the
   path once the request is already inside `/bpm`.
2. **A `rewrites()` entry with `basePath: false` gets it there** — but only with
   an ABSOLUTE destination. A relative one is rejected at boot ("use a
   destination that starts with `http://` or `https://`"), because escaping the
   basePath makes the destination external too.

So the request flows: Apple hits the domain root → the rewrite proxies it to
`${APP_ORIGIN}/bpm/.well-known/...` → `proxy.ts` answers from the env var.

**What you do:** open the file Apple gives you, copy its contents, and set

```
APPLE_DOMAIN_ASSOCIATION=<the entire contents of the .txt file>
```

in Azure App Settings (and `.env.local` if you want to check locally). It is
server-only, so it needs no rebuild — but it does need `APP_ORIGIN` set too, or
the rewrite is skipped entirely.

The rewrite and `proxy.ts` entry are already deployed, so there is no deploy
here — set the App Setting, wait for the app to restart (~1 min), confirm it is
reachable, and only then click Verify in Apple's console, which fetches it live:

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://bpm.grantzou.com/.well-known/apple-developer-domain-association.txt
# 200 — anything else and Verify will fail
```

If the console no longer shows a Verify step or offers no file, skip this
section: Apple has changed that flow before, and nothing else depends on it.

### 4. Key — this is the one you cannot re-download

**Keys → + →** name it `BPM Sign In with Apple` → tick **Sign in with Apple** →
Configure → Primary App ID `com.motioncraft.bpm` → Save → Continue → Register.

**Download the `.p8` now.** Apple lets you download it exactly once. Losing it
means revoking the key and making a new one.

- The **Key ID** (10 chars, shown on the key page) is `APPLE_KEY_ID`.
- Your **Team ID** (10 chars, top-right of the developer portal, or
  Membership Details) is `APPLE_TEAM_ID`.

### 5. Getting the `.p8` into an env var

The file is multi-line PEM. Keep the newlines — the app converts `\n` back:

```bash
# prints a single-line form safe to paste into .env.local or App Settings
awk 'BEGIN{ORS="\\n"} {print}' AuthKey_XXXXXXXXXX.p8
```

Then in `.env.local`:

```
APPLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nMIGT...\n-----END PRIVATE KEY-----\n"
```

> The client secret Apple wants is an ES256 JWT signed with this key, valid for
> at most 6 months. `arctic` generates it per request from the `.p8`, so there
> is **nothing to rotate on a schedule** — but do not revoke the key in the
> console, and keep `APPLE_KEY_ID` / `APPLE_TEAM_ID` matching it.

---

## Where the values go

**Locally** — `.env.local` (hook-blocked from editing, so paste by hand):

```
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
APP_ORIGIN=http://localhost:3000
NEXT_PUBLIC_FLAG_AUTH_PROVIDERS=true
```

Apple's four variables can be left out locally — the Apple button hides itself
when they are absent, rather than failing at the point of tapping it.

**Production** — Azure App Settings on `vnext-badminton-app` (not the workflow;
none of these are `NEXT_PUBLIC_`, so they need no rebuild).

> ⚠️ **`APP_ORIGIN` is REQUIRED, not optional.** It is the origin of every link
> the app mails out. It is deliberately never derived from the request, because
> `req.url` follows the client-controlled `Host` header — and a password-reset
> link built from an attacker's host is an account takeover: the victim
> receives a genuine BPM email whose link hands their reset token to the
> attacker. With `APP_ORIGIN` unset outside local dev, the app **refuses to
> send** verification and reset emails rather than send a poisoned link.

```bash
az webapp config appsettings set \
  --name vnext-badminton-app --resource-group <rg> \
  --settings GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=... \
             APPLE_CLIENT_ID=... APPLE_TEAM_ID=... APPLE_KEY_ID=... \
             APPLE_PRIVATE_KEY="..." APP_ORIGIN=https://bpm.grantzou.com
```

`NEXT_PUBLIC_FLAG_AUTH_PROVIDERS` is the exception: it **is** `NEXT_PUBLIC_`, so
it is baked at build time and lives in `.github/workflows/deploy-next.yml`.
It ships `'true'`: the release for each provider is its env vars, not the flag.

---

## Order of operations

1. Google — done and live.
2. Apple, in this order:
   1. App ID, Services ID and key in the Apple console (steps 1, 2, 4 above).
   2. `APPLE_DOMAIN_ASSOCIATION` → curl it → Verify (step 3), if the console asks.
   3. `APPLE_CLIENT_ID`, `APPLE_TEAM_ID`, `APPLE_KEY_ID`, `APPLE_PRIVATE_KEY` in
      App Settings. The button appears on the next page load.
   4. Read-only check: `GET /bpm/api/auth/methods` lists `apple`, and
      `GET /bpm/api/auth/apple/start` redirects to `appleid.apple.com`.
   5. On a phone: a Safari tab, the home-screen app (pop-up through Apple's
      pages — "You're signed in" means it posted back; six digits means it fell
      back to the typed code), and the native app if a build is installed. Then
      disconnect Apple, and delete a throwaway account: the app should leave
      Settings → Apple ID → Sign in with Apple.
