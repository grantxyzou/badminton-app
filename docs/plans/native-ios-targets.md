# Native: iOS targets beside the shell — and the rewrite question

**Track:** the native shell (`docs/plans/native-shell.md`, Reach), its third addition after `native-badge-shortcuts.md` and `native-widgets.md`.
**Status:** intent
**Review on:** 2026-12-02 — is a Mac build loop connected (Remote Control from Grant's Mac, or a Mac runner in CI)? Nothing below can start without one; decide whether to set it up or shelve this.

## Problem

Grant, 2026-11-03: "Estimate what will it be like if we have to rewrite the
entire app in native iOS. Can you just run it non stop? We will be keeping
react for android." Asked what native would buy, 2026-11-04: "dynamic island,
apple watch integration, and liquid glass. I also think a quick app clip to
sign up? Since whatsapp for communication is inevitable."

Nobody in the group has asked for any of the four. The one with a reported
problem behind it is the App Clip: invites travel through WhatsApp, and today
a tapped invite link lands on the web sign-up inside WhatsApp's browser, with
the store app a separate install afterwards. The other three are Grant's own
sense of what a store app should feel like, which (as with the shell itself)
is a weaker reason to build than a reported problem, and the kill criteria
below are written to match.

The estimate this plan records: **the rewrite is a client-only rewrite** (the
126 API routes, the ledger, auth and payments stay), roughly 35–45k lines of
SwiftUI, 4–6 months of calendar time with a build loop, about 3 if Admin stays
a WebView. **Three of the four things Grant wants do not need it.** They are
separate Xcode targets that attach to the Capacitor shell as the widgets did.
Only Liquid Glass needs native UI, and it is deferred.

## Kill criterion

Per piece, because they ship separately:

- **App Clip.** First test, before any further work: open an invite link from
  a WhatsApp chat on a real iPhone. If the App Clip card never appears from
  WhatsApp's in-app browser and the person has to find "Open in Safari", the
  clip is only worth building if a Smart App Banner on the join page shows
  there instead; if neither shows, stop — the web sign-up already works and
  the clip would reach nobody. After shipping: if a month in fewer than half
  of iPhone sign-ups arriving by invite link come through the clip, it is
  cut and the web sign-up stays.
- **Live Activity.** Start with the score (the rules are already in Swift in
  `ios/App/BPMWidget/`). If it is not started courtside on three session
  nights in a row, build no second activity (session night, stringing).
- **Apple Watch.** Starts with a question, not code: ask the roster who owns
  one. Fewer than three answers and it is not built. After shipping, if
  fewer than three members have it installed a month later, it gets no
  further features.
- **The rewrite** (for Liquid Glass) does not start unless all three targets
  above shipped and are used, the build loop exists, and Grant still wants
  the material after seeing it on the native chrome option below. Any one
  missing means the shell stays.

## Non-goals

- Android native. React stays on Android (Grant's call). Every target here is
  iOS-only; Android keeps the web invite link and its existing widgets.
- Rewriting Admin natively. Even in the full rewrite, the Command Center (54
  files, 17k lines, three English-reading users, changes weekly) stays a
  WebView tab. That alone halves the rewrite.
- A second backend, or a GraphQL/BFF layer for native. The targets call the
  routes that exist; the only additions are a Live Activity push and, in the
  rewrite, a native Sign in with Apple token check.
- Chinese copy in any target. Same rule as the widgets and push payloads —
  no per-member locale to choose from until `Member.locale` exists.
- The App Clip doing anything but sign-up. No stats, no balance, no stringing;
  it hands the session to the full app and stops.
- Running the rewrite "non-stop" from a Linux cloud session. There is no
  Xcode there, so every line would be written unverified; see the first
  decision.

## Sizing (recorded 2026-11-03, from the tree)

What a full native iOS client would replace, and what it would not:

| Area | Today | Rewrite |
| --- | --- | --- |
| API routes + server lib (`app/api`, most of `lib/`) | 126 routes, ~53k lines | unchanged |
| UI components (`components/`) | 202 files, 49k lines, 57 bottom sheets | ~35–45k lines SwiftUI |
| Admin (`components/admin/`) | 54 files, 17k lines | WebView tab (non-goal to rewrite) |
| Stats (`components/stats/`) | 39 files, 9.5k lines, inline SVG charts, consent flow | Swift Charts / Canvas |
| Stringing, auth/onboarding, Home | 3.6k + 3.7k + 0.7k lines (plus `HomeShell` in `app/`) | SwiftUI |
| Design system (`app/globals.css`) | 7.5k lines, tokens, motion recipes | ~500 lines of tokens; motion by hand |
| Strings (`messages/`) | 2,219 keys, EN + zh-CN | String Catalogs, mechanical |
| Client API surface | 143 distinct `/api/` paths referenced from client code | one typed client |
| Native plumbing | 13 Capacitor plugins, 2.2k lines of Swift already (widgets, two in-house plugins) | simpler in Swift; the Swift carries over |
| Tests | 559 files, mostly route tests (stay); component tests and the source-scan canaries are lost | XCTest; the canary discipline has no Swift twin |

Phases with a build loop: foundation (typed models from `lib/types.ts`,
cookie client, tokens, strings) 2 weeks; onboarding + Home 3; Profile +
Stringing 3; Stats 4; Admin 6–8 (or 0 as a WebView); native plumbing and store
submission 3–4. **The cost that outlives the rewrite:** every member-facing
change ships twice, in two languages, and must match — about 1.7× per
feature — plus a 1–2 day App Store review on every iOS fix, and an API
compatibility window for old binaries (the additive-only schema rule already
covers that half). Today a web deploy *is* the iOS update.

## Decisions

- **2026-11-04 — the three targets attach to the shell; the rewrite is not
  the way to get them.** A Live Activity is a WidgetKit extension (the one in
  `ios/App/BPMWidget/` already exists), a Watch app is a watchOS target, an
  App Clip is a clip target. All three run outside the WebView whatever the
  main app is written in, exactly as the widgets do. The alternative — rewrite
  first, then add them — puts the first of them six months out and makes a
  3-week item depend on a 6-month one.
- **2026-11-04 — Liquid Glass is the one that needs native UI, and it waits.**
  It is a material on native chrome. A full-screen WKWebView has no chrome to
  adopt it, so rebuilding the shell with the iOS 26 SDK changes nothing on
  screen; the `.glass-card` CSS stays CSS. The cheap half — a native tab bar
  and navigation around the web content, 1–2 weeks — is the way to see the
  material before deciding on the rest. Decided after the three targets, not
  before.
- **2026-11-04 — order: App Clip, then Live Activity (score first), then
  Watch, then the Glass question.** The clip is the growth lever (WhatsApp)
  and the pilot for everything a native client needs; the score rules are
  already Swift and session night is when people look at their phone; the
  Watch starts with a head-count. Alternative beaten: Live Activity first,
  because it was already drawn (`native-widgets.md`, 2026-10-23) — but it
  reaches members who already have the app, where the clip reaches people who
  do not.
- **2026-11-04 — one shared Swift package before the first target.** Models
  mirrored from `lib/types.ts`, a client that holds the member cookie or the
  widget pass, the design tokens, the strings. The clip, the Watch, the
  activities and the widgets all consume it. The alternative — each target
  carrying its own copy of the pass handling — is the "ten copy-pasted
  resolvers" family `lib/memberResolve.ts` exists to prevent, in Swift. If
  the rewrite ever happens, this package is a third of its foundation.
- **2026-11-04 — the build loop is the gate, not a nicety.** The Live Activity
  was parked on 2026-10-23 for exactly this reason (`native-widgets.md`):
  Xcode work cannot be compiled in a Linux session, and Swift on Linux has no
  SwiftUI or UIKit. Writing 40k lines unverified means several hundred build
  errors on first open and every layout bug waiting for Grant. Two loops
  work: Grant's Mac shared through Remote Control (the session runs
  `xcodebuild` and the simulator there), or a Mac runner in GitHub Actions /
  Xcode Cloud (push, compile, read errors; ~10 minutes a round, ~10× a Linux
  runner's price). Without either, the targets are written in phases and
  Grant compiles each on his side — possible, and a day of his time per
  phase.
- **Auth per target, decided now so no target invents its own:**
  - *App Clip* — signs up through the routes the web uses (`lib/inviteSignup.ts`
    claims the one-time invite, `app/api/groups/preview/route.ts` names the
    club, `app/api/players/route.ts` takes the sign-up), holding
    `member_session` in its own cookie jar; hands the session to the full app
    through a shared keychain access group (Apple's sanctioned clip → app
    bridge). Sign in with Apple natively; Google deferred to the full app.
  - *Watch* — the widget pass (`lib/auth.ts` `mintWidgetToken`, `lib/widget.ts`
    `requireWidgetMember`, the `app/api/widget/` routes). It is already a
    Bearer pass for code that runs outside the WebView, re-checked against
    the membership on every read and revoked at sign-out; the phone app
    hands it over through WatchConnectivity the way `lib/widgetBridge.ts`
    hands it to the widget. Join and Undo go through `app/api/widget/join/route.ts`,
    so every rule Home's button meets, the wrist meets.
  - *Live Activity* — started locally by the app through a small in-house
    plugin beside `ios/App/App/BpmWidgetPlugin.swift`; updated by push with
    the activity's own token. Open question below on how that push is sent.

## Shape (intended; nothing below is in the tree yet except where marked)

| Piece | Where |
| --- | --- |
| Shared Swift package (models, client, tokens, strings) | new, `ios/BPMKit/`, consumed by every target |
| App Clip target | new, `ios/App/BPMClip/`; Info.plist clip marker; `appclips` entry in the AASA (`proxy.ts` `WELL_KNOWN`, env body `APPLE_APP_SITE_ASSOCIATION`); App Clip experience registered in App Store Connect |
| Smart App Banner on the join page | `app/layout.tsx` (an `apple-itunes-app` meta carrying the clip bundle id, only when `?join=` is present) |
| Live Activity (score, then session night) | `ios/App/BPMWidget/` (exists; gains an `ActivityAttributes` file compiled into app and extension, `NSSupportsLiveActivities` in the app plist); in-house start/update plugin beside `ios/App/App/BpmWidgetPlugin.swift` |
| Live Activity push | `lib/push.ts` / `lib/fcm.ts` (exist) — see open question |
| Watch app + complications | new, `ios/App/BPMWatch/`; pass handover from the Capacitor app via WatchConnectivity through `lib/widgetBridge.ts`'s plugin |
| Native chrome for Liquid Glass (if tried) | `ios/App/App/MainViewController.swift` (exists; hosts the WebView) |
| Canaries | `__tests__/native-shell-projects.test.ts` pins the hand edits; extend it per target, as it was for the widgets |
| Runbook | `native/README.md` (exists; gains the clip and Watch archive steps) |

## Open questions

- **Does the App Clip card show from WhatsApp's in-app browser?** Apple
  guarantees it in Safari, Messages and Mail. This is the first thing tested
  on a real phone, and it is the clip's kill switch (above).
- **Live Activity push transport.** `lib/fcm.ts` sends FCM HTTP v1; an
  activity update needs the `liveactivity` APNs push type with the activity's
  token. Either FCM's Live Activity support (an `apns` override on the same
  v1 call) or APNs direct with a `.p8`. The former keeps one sender; decide
  when the first activity exists.
- **Minimum iOS.** The app floor is 15.0 (`native-shell-projects` pins it).
  ActivityKit is 16.1+ and can be `@available`-gated, so no raise is needed
  for the activity; the clip runs on 14+; a standalone Watch app is its own
  floor. Raise nothing until a target needs it.
- **Watch head-count.** Asked before any Watch code is written.
