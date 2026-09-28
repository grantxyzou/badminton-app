# Replace `arctic` for the Google and Apple handshake

**Track:** Store launch — Google and Apple sign-in are the store-listing credentials (`NEXT_PUBLIC_FLAG_AUTH_PROVIDERS`), and the library that performs their handshake is deprecated upstream.
**Status:** intent
**Review on:** 2026-10-26 — Has `arctic` needed a fix we could not take, or has either provider changed an endpoint? If neither, is the hand-rolled handshake shipped behind the replayed-exchange tests below, or is this plan still a note?

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

Proposed, not yet made — recorded so the review has something to hold to:

- **Hand-roll the two calls rather than adopt `openid-client`.** The surface is four functions: Google authorization URL (with PKCE `S256` challenge), Google token POST (`code`, `code_verifier`, client id and secret, redirect URI), Apple authorization URL (`response_mode=form_post`), Apple token POST (`client_secret` = the ES256 JWT `lib/appleRevoke.ts` already knows how to sign). That is ~120 lines over `fetch` and `crypto`, the same posture `lib/fcm.ts` took for FCM ("zero dependencies") and the reason it was chosen there: a dependency that does one HTTP round trip is a dependency you own the failure modes of anyway. `openid-client` would replace one deprecated dependency with a large maintained one whose discovery and JWKS machinery this app does not use.
- **Keep `googleClient()` / `appleClient()`'s exported shape.** The four route call sites (`auth/{google,apple}/{start,callback}`) call `createAuthorizationURL` and `validateAuthorizationCode` and nothing else; a same-shaped in-house client means the routes and their tests do not change, and the cutover is one import.
- **Prove it against replayed exchanges, not mocks of our own.** Capture one real token-endpoint request and response per provider (secrets redacted) during a dev sign-in and check the in-house client produces the same request bytes and parses the same response. A fixture test that only asserts what we wrote is the failure mode the kill criterion names.
- **Retire with a canary.** `__tests__/native-imports.test.ts`'s shape: after cutover, an `arctic` import anywhere in `app/` or `lib/` fails the build, and the package leaves `package.json` in the same PR.

## Shape

| Piece | File |
|---|---|
| Google authorization URL + PKCE + token exchange | `lib/oauth/google.ts` (new) |
| Apple authorization URL + token exchange | `lib/oauth/apple.ts` (new); client-secret JWT via `lib/appleRevoke.ts`'s signer, lifted into `lib/oauth/appleSecret.ts` |
| Same-shaped `googleClient` / `appleClient` | `lib/oauthProviders.ts` (import swap only) |
| Replayed-exchange fixtures | `__tests__/oauth-google-exchange.test.ts`, `__tests__/oauth-apple-exchange.test.ts` |
| Import canary | `__tests__/oauth-lib-canary.test.ts` |
| Dependency removal | `package.json`, `package-lock.json` |
