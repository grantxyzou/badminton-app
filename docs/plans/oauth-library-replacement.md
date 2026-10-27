# Replace `arctic` for the Google and Apple handshake

**Track:** Store launch — Google and Apple sign-in are the store-listing credentials (behind `NEXT_PUBLIC_FLAG_AUTH_PROVIDERS` until it retired 2026-10-15), and the library that performs their handshake is deprecated upstream.
**Status:** shipped 2026-10-27 (#735, f6db6fb). Grant signed in with Google and with Apple on production right after the deploy, and both worked. #713 is closed.
**Review on:** 2026-11-24 — Has any member hit `exchange_failed` on Google or Apple since the cutover? If none, drop this line. The open follow-up is folding `lib/appleRevoke.ts` onto `AppleOAuth.createClientSecret`.

## Problem

Nobody has said this out loud; it surfaced as a warning during the 2026-09-28 audit's `npm ci`:

> npm warn deprecated arctic@3.7.0: Package no longer supported. Contact Support at https://www.npmjs.com/support for more info.

`arctic` is the only OAuth dependency (`lib/oauthProviders.ts`), used for exactly two things per provider: building the authorization URL and exchanging the code for tokens. Its last publish was 2025-05-21, its `@oslojs/*` dependencies carry the same deprecation, and `npm audit` reports nothing today — which is the problem, not the reassurance: a deprecated package gets no fix when one is needed, and the day that matters is the day a provider changes an endpoint or a CVE lands in a transitive dependency. Sign-in is the door to the app; the door's hinge should not be a package nobody maintains.

## Kill criterion

Kill this plan and keep `arctic` pinned if, by the review date, a maintained successor exists that is a drop-in for the two calls we make (the maintainer's own successor or a fork with releases and an issue tracker that answers). Also kill it if the hand-rolled version cannot be proven against a REPLAYED real exchange from each provider — a rewrite of a security handshake that is tested only against its own mocks is worse than the deprecated library.

## Non-goals

- Changing the handoff design (`lib/authHandoff.ts`), the state/PKCE cookies, the pop-up, the native return, or any claim route. The handshake library sits under all of that and none of it should notice.
- Re-deciding provider scope (`openid profile email` for Google, `name email` for Apple).
- Verifying `id_token` signatures. `decodeIdTokenClaims` deliberately does not, because the token arrives from the provider's token endpoint over TLS with client credentials (OIDC §3.1.3.7 n.2); that stays true whatever performs the exchange.
- Touching `lib/appleRevoke.ts`, which already signs the Apple client-secret JWT by hand (`dsaEncoding: 'ieee-p1363'`).

## Decisions

**Review answered 2026-10-27** (it was due 26 Oct). `arctic` needed no fix and neither provider changed an endpoint. But the deprecation is now deliberate: the author deprecated `arctic` in July 2026 (npm shows the generic "no longer supported"), and the README points users to example code in the repo's `/code` folder, not to a successor. So the first kill clause (a maintained drop-in) is NOT met, and the plan goes ahead.

**Built as proposed, with one substitution for Grant to accept or reject.** The kill criterion asks for proof against a REPLAYED real exchange per provider. Capturing one needs a real sign-in on a dev machine, and Apple's `form_post` cannot run on localhost. Instead, `arctic` itself, the library that carried every production sign-in, was the recording source while it was still installed: `__tests__/fixtures/oauth-arctic-requests.json` holds its exact requests (URL, method, headers including Content-Length, body) for fixed fake inputs, and `__tests__/oauth-in-house.test.ts` holds the new client to them byte for byte. Apple's client secret is compared by its decoded header and payload under a frozen clock (key order included, since it sets Content-Length), and its signature is VERIFIED against the test key's public half, which catches the DER-signature trap. What this does not prove is the provider's response side. That is what the post-deploy sign-ins are for, and why they are the ship gate.

**The Apple signer copies arctic, not `lib/appleRevoke.ts`.** The two differ: arctic's `aud` is an array, appleRevoke's a string. arctic's was accepted by Apple on every sign-in, while revocation failures are swallowed by design, so nothing proves appleRevoke's form has ever been accepted. appleRevoke stays untouched (a non-goal here). Folding it onto the sign-in signer is a follow-up worth one PR.

**`User-Agent: arctic` is kept**, so the providers see exactly the request they always have.

Proposed before the build, kept for the record:

- **Hand-roll the two calls rather than adopt `openid-client`.** The surface is four functions: Google authorization URL (with PKCE `S256` challenge), Google token POST (`code`, `code_verifier`, client id and secret, redirect URI), Apple authorization URL (`response_mode=form_post`), Apple token POST (`client_secret` = the ES256 JWT `lib/appleRevoke.ts` already knows how to sign). That is ~120 lines over `fetch` and `crypto`, the same posture `lib/fcm.ts` took for FCM ("zero dependencies") and the reason it was chosen there: a dependency that does one HTTP round trip is a dependency you own the failure modes of anyway. `openid-client` would replace one deprecated dependency with a large maintained one whose discovery and JWKS machinery this app does not use.
- **Keep `googleClient()` / `appleClient()`'s exported shape.** The four route call sites (`auth/{google,apple}/{start,callback}`) call `createAuthorizationURL` and `validateAuthorizationCode` and nothing else; a same-shaped in-house client means the routes and their tests do not change, and the cutover is one import.
- **Prove it against replayed exchanges, not mocks of our own.** Capture one real token-endpoint request and response per provider (secrets redacted) during a dev sign-in and check the in-house client produces the same request bytes and parses the same response. A fixture test that only asserts what we wrote is the failure mode the kill criterion names.
- **Retire with a canary.** `__tests__/native-imports.test.ts`'s shape: after cutover, an `arctic` import anywhere in `app/` or `lib/` fails the build, and the package leaves `package.json` in the same PR.

## Shape

| Piece | File |
|---|---|
| Shared token POST, `OAuthTokens`, `OAuthRequestError` | `lib/oauth/tokenRequest.ts` |
| Google authorization URL + PKCE + token exchange | `lib/oauth/google.ts` |
| Apple authorization URL + token exchange + client-secret JWT (arctic's claims) | `lib/oauth/apple.ts` |
| Same-shaped `googleClient` / `appleClient` | `lib/oauthProviders.ts` (import swap only) |
| Recorded-request fixtures, parity tests, response contract, import canary | `__tests__/fixtures/oauth-arctic-requests.json`, `__tests__/oauth-in-house.test.ts` |
| Dependency removal | `package.json`; `package-lock.json` edited by hand to drop only the seven `arctic`/`@oslojs` entries (a local `npm uninstall` also rewrote unrelated `libc` lines) |
