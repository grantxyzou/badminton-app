# Setting up Google and Apple sign-in credentials

Everything here is done once, in a browser, outside the repo. The app reads the
results from environment variables — server-side only, so they can be changed in
Azure App Settings without a rebuild.

At the end you will have:

```
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
APPLE_CLIENT_ID=          # the Services ID, e.g. com.grantzou.bpm.web
APPLE_TEAM_ID=            # 10 characters
APPLE_KEY_ID=             # 10 characters
APPLE_PRIVATE_KEY=        # the contents of the .p8 file
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
- Bundle ID (explicit): `com.grantzou.bpm`
- Capabilities: tick **Sign In with Apple**
- Continue → Register

### 2. Services ID — this becomes `APPLE_CLIENT_ID`

**Identifiers → + → Services IDs**

- Description: `BPM Badminton Web`
- Identifier: `com.grantzou.bpm.web`  ← **this exact string is `APPLE_CLIENT_ID`**
- Register, then click back into it and tick **Sign In with Apple → Configure**:
  - Primary App ID: `com.grantzou.bpm`
  - **Domains and Subdomains**: `bpm.grantzou.com`
  - **Return URLs**: `https://bpm.grantzou.com/bpm/api/auth/apple/callback`

### 3. ⚠️ Domain verification — read the obstacle below first

Apple gives you `apple-developer-domain-association.txt` and requires it at:

```
https://bpm.grantzou.com/.well-known/apple-developer-domain-association.txt
```

**This does not work out of the box on this app, and is currently UNSOLVED.**
`next.config.js` sets `basePath: '/bpm'`, so anything in `public/` is served
under `/bpm/...`. Apple checks the **domain root**, which Next 404s.

A `rewrites()` entry with `basePath: false` looks like the fix and is not:
Next rejects it at boot with

```
The route /.well-known/apple-developer-domain-association.txt rewrites urls
outside of the basePath. Please use a destination that starts with http:// or
https://
Error: Invalid rewrite found
```

Once the source escapes the basePath, the destination is treated as external
too, so only an absolute URL is accepted — which would mean the app proxying to
itself by hardcoded hostname.

The remaining options, none yet implemented:

1. **Serve it from `proxy.ts`** (the renamed middleware, already present for
   i18n). It sees the full pathname including outside the basePath, so it can
   match `/.well-known/apple-developer-domain-association.txt` and return the
   token from an env var — no filesystem access, and changeable without a
   deploy. Most promising.
2. An absolute-URL rewrite to the app's own public hostname. Works, but adds a
   self-proxy hop and hardcodes the domain.
3. Drop `basePath` — far too invasive; it is load-bearing everywhere.

**This blocks Apple, and only Apple.** Google needs none of it. Do Google first.

Verify it is actually reachable before clicking Verify in Apple's console:

```bash
curl -sS https://bpm.grantzou.com/.well-known/apple-developer-domain-association.txt | head -3
```

### 4. Key — this is the one you cannot re-download

**Keys → + →** name it `BPM Sign In with Apple` → tick **Sign in with Apple** →
Configure → Primary App ID `com.grantzou.bpm` → Save → Continue → Register.

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
It currently ships `'false'`; flipping it to `'true'` is the release.

---

## Order of operations

1. Google first — it is quick and testable locally, so it proves the whole
   handshake works before Apple's slower loop.
2. Apple's domain verification second, since it needs a deploy.
3. Apple's key last.
