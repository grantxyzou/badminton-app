# Native shell — App Store + Google Play

**Track:** Reach (ROADMAP track 4 — the one Value-Hub track never built)
**Status:** in-flight

## Problem

Grant, 2026-08-28: the app should be on both stores "for product completeness and
reach". Nobody has asked for it from the other side — the group is already
installed as a home-screen PWA (the iOS cookie-jar bug in `lib/authHandoff.ts`
could only have happened inside a WKWebView). So this is a weaker reason to
build than a reported problem, and the kill criterion below is written to match.

The concrete gaps that a listing exposes are real, though, and they are not
native at all: on 2026-09-03 the repo had **no public privacy policy, no support
page, and no sign-in-free account-deletion page** — all three are hard
requirements at both consoles, and one of them is a PIPEDA obligation whether or
not an app ever ships. A second gap surfaced by the same audit is a live bug:
`app/api/auth/apple/start` never parks the `?hr=` handoff that
`google/start` does, so an installed-PWA user who picks Apple signs Safari in
and comes back to the app signed out.

## Kill criterion

If App Review rejects under Guideline 4.2 (minimum functionality) **twice**
after the mitigations are in place — native push, native share, Sign in with
Apple, universal links, a bundled offline page — stop, keep the PWA, and leave
the legal pages and the Apple handoff fix (both stand on their own).

## Non-goals

- React Native / Expo (costed 2026-08-28: the CSS design system does not survive).
- A bundled static build (`output: 'export'`) — 48 of 70 routes are cookie-gated
  and would need a bearer-token migration.
- Retiring the PWA. Both run in parallel; the migration link carries identity across.
- CI-built native binaries. `server.url` means a web deploy already updates the
  app; the shell is archived locally a few times a year.

<!--
Everything above is the gate for starting. Everything below is appended as the
work proceeds. Architecture, env vars and conventions live in CLAUDE.md — link,
don't copy.
-->

## Decisions

- **Capacitor 8 shell loading the live URL** over RN and static (2026-08-28;
  reasoning in the approved plan and memory, not repeated).
- **All sign-in providers at v1** (2026-09-03). Consequence: `@capacitor/browser`
  is mandatory (Google returns `disallowed_useragent` in an embedded WebView),
  and the Apple routes must gain the same handoff Google has.
- **One push transport for both platforms** — `@capacitor-firebase/messaging`
  hands back an FCM token on iOS and Android (Firebase relays to APNs), so the
  server gains one sender, not two.
- **Legal pages are server components under `/bpm/legal/*`**, request-rendered,
  no client state, no fetch. They are also the URLs pasted into both consoles.
- **`.well-known` bodies come from env**, via the existing `proxy.ts` + rewrite
  pattern for Sign-in-with-Apple domain verification. The Play App Signing SHA
  and Apple team id never enter git.
- **Distribute in Canada (+US) only** — sidesteps the EU DSA trader question
  for a single local group.

## Shape

| Piece | File |
|---|---|
| Legal pages | `app/legal/{layout,_LegalDoc}.tsx`, `app/legal/*/page.tsx`, `messages/*.json` `legal.*` |
| `.well-known` at root | `proxy.ts` `WELL_KNOWN` table, `next.config.js` `rewrites()` |
| Native detection | `lib/native.ts` |
| Apple handoff parity | `app/api/auth/apple/{start,callback}/route.ts` |
| Native push | `lib/fcm.ts`, `lib/push.ts`, `app/api/push/subscribe/route.ts` |
| Migration link | `lib/authMigration.ts`, `app/api/auth/migrate/*`, `components/Migrate*.tsx`, `app/migrate/page.tsx` |
| Shell | `capacitor.config.ts`, `native/`, `ios/`, `android/`, `components/NativeBridge.tsx` |
