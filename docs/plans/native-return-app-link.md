# Native sign-in returns through a verified link

**Track:** security, Claude Security scan 2026-11-17, finding F30 (LOW). Ships with the next native build.
**Status:** intent
**Review on:** 2027-01-15 — has a native build gone to the stores since 2026-11-18? If yes, did this ship in it; if no, is the next one scheduled?

## Problem

Nobody has reported this. The security scan found it (F30), and Grant chose on
2026-11-18 to fix it with the next native release rather than accept it.

The native app signs in with Google or Apple in the system browser sheet, and
the browser hands the result back over `bpm://auth/return?c=<returnCode>`
(`lib/handoffClient.ts` `nativeReturnHref`, `components/HomeShell.tsx`). A
custom scheme is not exclusive: any app can register `bpm://` on Android, and
on iOS outside an authentication session.

The attack: a malicious app on the person's phone starts its OWN sign-in
(`/api/auth/google/start?native=1&hr=<its ref>`), so it holds the handoff id.
It talks the person into picking their Google account. The code comes back on
`bpm://`, the malicious app receives it, and claims a session for that person.

What is already safe, and why a server-side secret does not help: a code
caught from a sign-in the REAL app started is useless, because the claim needs
the handoff id only that app holds (`claimHandoff`). In the attack above the
attacker started the sign-in, so any extra secret would be theirs too. Only a
return channel that reaches the real app alone closes it.

## Kill criterion

A sign-in started by a different app (any `hr` it chooses) cannot deliver its
return code to that app. Checked on a real phone, with a test app that
registers `bpm://`: after this ships it receives nothing.

## Non-goals

- The installed iOS web app's pop-up path (`postMessage` to a checked origin) and the typed 6-digit code: not affected.
- Changing the handoff stash or the claim.

## Decisions

- **Not a link on `bpm.grantzou.com` itself.** A same-domain link opens in
  place (`.claude/rules/native.md`), so the sheet would never hand back to the
  app. The two candidates:
  - **iOS:** `ASWebAuthenticationSession`. Its callback, custom scheme or
    `https` with an associated domain (iOS 17.4+), is delivered only to the
    session that opened it, never to another app.
  - **Android:** an Android App Link on a SEPARATE return host (for example a
    `return.` subdomain) with its own `assetlinks.json`, verified to the Play
    signing key, so only the real app opens it. Custom Tabs have no
    session-bound callback.
- **Keep `bpm://` working until the store build is out**, so phones on the old
  build still sign in; remove it the release after.

## Shape

| Piece | Where |
|---|---|
| Return URL choice | `lib/handoffClient.ts` `nativeReturnHref` |
| The landing's button and auto-navigate | `components/HomeShell.tsx` |
| iOS session | the native Google/Apple start in `ios/` (Capacitor plugin or a small bridge) |
| Android App Link | `android/app/src/main/AndroidManifest.xml`, the return host's `/.well-known/assetlinks.json` (`proxy.ts` `WELL_KNOWN`) |
| Test | a real-phone check per the kill criterion; `__tests__/native-shell-projects.test.ts` pins the manifest edits |
