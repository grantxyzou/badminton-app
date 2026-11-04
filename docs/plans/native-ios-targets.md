# Native: iOS targets beside the shell — and the rewrite question

**Track:** the native shell (`docs/plans/native-shell.md`, Reach), its third addition after `native-badge-shortcuts.md` and `native-widgets.md`.
**Status:** intent
**Review on:** 2026-12-02 — is a Mac build loop connected (Remote Control from Grant's Mac, or a Mac runner in CI)? Nothing below can start without one; decide whether to set it up or shelve this.

## Problem

Grant, 2026-11-03: "Estimate what will it be like if we have to rewrite the
entire app in native iOS. Can you just run it non stop? We will be keeping
react for android." Asked what native would buy, 2026-11-04: "dynamic island,
apple watch integration, and liquid glass. I also think a quick app clip to
sign up? Since whatsapp for communication is inevitable." And the clip's
brief, the same day: "Who: People who wants a light weight sign up. Sign up:
Click on link open app clip to sign up then get reminded to download. They
can also use the app clip to join a group by being close to the phone or
scanning a qr code or clicking on the link."

Nobody in the group has asked for any of the four. The one with a reported
problem behind it is the App Clip: invites travel through WhatsApp, and today
a tapped invite link opens the web sign-up (WhatsApp on iPhone hands most
links to the default browser), with the store app a separate install
afterwards. The other three are Grant's own
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

- **App Clip.** First test, before any further work, on a real iPhone
  without the app: tap an invite link in a WhatsApp chat, scan its QR from
  another phone's screen, and tap an NFC sticker carrying it. The link is
  the one that matters. If tapping it in WhatsApp shows neither the App Clip
  card nor, once Safari opens, the clip's Smart App Banner, stop — the web
  sign-up already works and the clip would reach nobody from the channel it
  was built for. A QR or sticker working alone is not enough reason to build. After shipping: if a month in fewer than half
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
- The App Clip doing anything past the four moments in the decision below
  (sign up, log in and join, a same-night notification, the install card). No
  stats, no balance, no stringing, no second session of use; it hands the
  session to the full app and stops. It is disposable (iOS removes an unused
  clip and its data after about a month), so it holds nothing the server
  cannot give back.
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
    by writing it to the clip's own keychain, which the full app can read
    from iOS 15.4 through the associated App Clip entitlements (Xcode adds
    them when the app is archived with the clip). Not a shared keychain
    access group: Apple does not support those for clips. Sign in with
    Apple natively; Google deferred to the full app.
    A person who already has an account but not the app takes "Log in"
    instead: name and PIN through `app/api/players/recover/route.ts` (the
    same route, rate limits and per-account lock the web uses), then the
    invite is claimed through `app/api/groups/join/route.ts`, which is how
    an existing member joins a second club today.
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

- **2026-11-04 — the App Clip does four things, in this order.** Asked by
  Grant: can a person with no app use it, and could it cover sign up,
  download the app, and join a group. Yes to all three, with the facts that
  shape the build:
  - *It is for people without the app.* The invite link makes iOS fetch the
    clip on the spot; a phone that already has the full app opens the full
    app from the same link, so the clip never competes with it. One link
    serves both audiences, which is why nothing about the invite changes.
  - *Sign up* — card, clip, club name from the preview route, account,
    sign-up for this week.
  - *Log in and join* — for an existing account on a phone without the app,
    invited to another club (auth bullet above). A new person's claim of the
    invite already is joining; there is no separate step for them. A member
    who has the app installed never sees the clip, so a second club for them
    stays the full app's job through the same link.
  - *Same-night notification* — a clip may ask, in its Info.plist, to send
    notifications for 8 hours after launch without a permission prompt. Used
    for what the sign-up promises ("you're in", "a spot opened and you're
    promoted", `lib/waitlistPromote.ts`) and nothing else; never marketing.
  - *Install* — the clip shows Apple's install overlay for the full app
    (StoreKit `SKOverlay`) once, right after the sign-up confirms, which is
    the moment a person is most likely to say yes. With the session already
    in the clip's keychain the full app opens signed in. A regular member
    should take this card: the clip is removed after about a month of
    non-use.
  - *Limits that bind the build:* native only (a WebView wrapper would not
    pass review), and **15 MB**, because the clip is reached by QR and NFC as
    well as by link. Apple allows a larger clip (50 MB at WWDC23, 100 MB in
    the current docs) only when it supports no physical invocation at all
    and requires iOS 17. The shared package must stay lean. Nothing the clip
    stores is kept; everything it needs is re-readable from the server.

- **2026-11-04 — three ways in, and each one still admits one person, once.**
  Grant's brief: link, QR code, or "being close to the phone". Researched
  against Apple's docs the same day. The one-time invite (`lib/invites.ts`,
  `docs/plans/one-time-invites.md`, "replace, not add") is not reopened by
  any of them:
  - *The link.* The per-person invite link the admin already sends, on our
    own domain, registered as an advanced App Clip experience (the
    `appclips` key in the AASA the proxy already serves). Messages and
    Safari show the card directly. WhatsApp hands most links to Safari
    today, where the join page's Smart App Banner offers the clip one tap
    later. Apple's default App Clip links (`appclip.apple.com/id?p=…`) open
    from any app on iOS 16.4+, but an Android member in the same chat would
    land on an Apple page, so they are not what the admin shares. One link,
    every phone: Android and the web keep the sign-up they have.
  - *A QR on the organiser's phone.* This is what "close to the phone" can
    be. The Command Center's Invite card gains "Show as QR": a fresh
    one-time invite drawn as a QR, scanned with the other person's camera,
    used once, and the card offers the next. Apple's sample code shows App
    Clip codes on a second device, and a plain QR of an advanced-experience
    URL raises the same card. Apple's own App Clip Code is generated per URL
    in App Store Connect or with a Mac command-line tool, so per-person
    codes are a plain QR drawn in the browser.
  - *NFC.* An iPhone cannot act as a tag for another iPhone: the NFC and
    Secure Element access Apple opened in iOS 18.1 is for payments, keys and
    tickets under a commercial agreement, not a tag that launches a clip.
    So phone-to-phone tapping is out. A physical NFC sticker (on the
    organiser's bag, at the court door) does work, even from the Lock
    Screen. A sticker is a permanent URL, though, which is the club-wide
    door the one-time invites replaced. **Decided 2026-11-04: the sticker
    stays, behind the organiser's approval.** Grant already has NFC
    stickers ("Oh I have them so keep it?"). A tap opens "BPM Core · ask to
    join", and the organiser, standing right there, approves the request on
    their phone. An ungated sticker was not chosen: it would undo the
    one-time-invite decision with a door anyone can photograph or peel off.
    - *The server half comes first and needs no Xcode.* A join request from
      a new person is a new kind of request. Today's access requests
      (`app/api/members/access-request/route.ts`) only let an existing name
      back in. It should follow their pattern: unauthenticated by
      necessity, rate-limited, a secret held only by the asking device so
      a blind approval admits the person who asked, and nothing happens
      until a human approves. Built that way, the sticker works on the web
      for Android and iPhone before the clip exists. The clip later opens
      the same request natively.
    - *Where the request lands: both* (Grant, 2026-11-04: "both, push to
      organisers and admin inbox"). It goes into the Command Center inbox
      beside today's access requests (`AccessRequestsCard`), and a push
      goes to the club's organisers (`listOrganisers` in `lib/groups.ts`)
      the moment it is made. A person is standing at the court door, so a
      request nobody sees for an hour has failed. The push carries the
      name the person typed and the club, never anything else (lock-screen
      rule), opens `?tab=admin`, and is tagged per request so a second tap
      replaces the banner instead of stacking. Best-effort after the
      request is stored, like every other push; the inbox is the record.
    - *Recipients come from the club's roster, never a person-level role.*
      Today's access-request push picks every active `Member` with
      `role: 'admin'` across the deployment, which with groups on reaches
      the wrong club's admins and misses the right club's organisers. The
      sticker request must not copy that query. It was fixed in #771
      (`docs/plans/claim-your-name.md`) to read the asking club's roster
      through `rosterMembers`, which is the pattern the sticker request
      follows. The same plan gives a signed-out person a way to name their
      club, the club's claim link, and a request remembers its club
      (`StoredAccessRequest.groupId`). The sticker's request should carry its
      club the same way, from the URL the sticker holds.
    - *What the sticker holds.* One stable URL per club, decided with the
      request route and never changed after the stickers are written.
      Until then the stickers stay blank. NFC Tools' "lock" is permanent,
      so they are never locked: a written URL can be rewritten.
  - *Not used:* Maps place cards and Siri location suggestions. Both tie a
    clip to a place the business operates, and a club renting a school gym
    is not that.

## Shape (intended; nothing below is in the tree yet except where marked)

The App Clip's step-by-step build plan is
`docs/superpowers/plans/2026-11-04-app-clip.md`. Grant set its priorities on
2026-11-04 ("simplify, reliable, and UX priority"), and they cut v1 to this:
one link (`/bpm/j/<token>`) that opens the app, the clip or the website; the
invite as a QR on the organiser's phone; a three-screen clip; and arriving
signed in. The sticker, "log in and join" and the same-night push come after
v1 is used. The web pieces ship first and help every phone before the clip
exists. The Swift waits on the Mac build loop.

| Piece | Where |
| --- | --- |
| Shared Swift package (models, client, tokens, strings) | new, `ios/BPMKit/`, consumed by every target |
| App Clip target | new, `ios/App/BPMClip/`; Info.plist clip marker and the 8-hour notification request; `appclips` entry in the AASA (`proxy.ts` `WELL_KNOWN`, env body `APPLE_APP_SITE_ASSOCIATION`); advanced App Clip experience registered in App Store Connect on the invite link's prefix; the install overlay; the associated App Clip entitlements that let the full app read the clip's keychain |
| "Show as QR" on the Invite card | `lib/useInvites.ts` and the Command Center's Invite card (exist); a QR drawn in the browser, which is a new dependency to choose |
| Clip sign-in and join | existing routes only: `app/api/groups/preview/route.ts`, `lib/inviteSignup.ts`, `app/api/players/recover/route.ts`, `app/api/groups/join/route.ts`, `app/api/players/route.ts`; no new server route |
| Smart App Banner on the join page | `app/layout.tsx` (an `apple-itunes-app` meta carrying the clip bundle id, only when `?join=` is present) |
| Live Activity (score, then session night) | `ios/App/BPMWidget/` (exists; gains an `ActivityAttributes` file compiled into app and extension, `NSSupportsLiveActivities` in the app plist); in-house start/update plugin beside `ios/App/App/BpmWidgetPlugin.swift` |
| Live Activity push | `lib/push.ts` / `lib/fcm.ts` (exist) — see open question |
| Watch app + complications | new, `ios/App/BPMWatch/`; pass handover from the Capacitor app via WatchConnectivity through `lib/widgetBridge.ts`'s plugin |
| Native chrome for Liquid Glass (if tried) | `ios/App/App/MainViewController.swift` (exists; hosts the WebView) |
| Canaries | `__tests__/native-shell-projects.test.ts` pins the hand edits; extend it per target, as it was for the widgets |
| Runbook | `native/README.md` (exists; gains the clip and Watch archive steps) |

## Open questions

- **Does the clip show from WhatsApp?** Apple names Messages, Maps, Safari
  and Safari View Controller, and Spotlight as the surfaces for a link on
  your own domain. WhatsApp on iPhone hands most links to the default
  browser today, so the expected path is Safari plus the Smart App Banner.
  WhatsApp is testing an option to open every link in its own browser
  (TestFlight references, 2026-10-19, not shipped), which could change that.
  Tested on a real phone first; it is the clip's kill switch (above).
- **Which URL the experience claims.** The invite is a `?join=` query on the
  app's own address, and an App Clip experience matches a URL prefix. Claim
  the app's root, and the plain weekly sign-up link raises the card too,
  which suits an account-holder without the app. Or move the invite to a
  path of its own. Developers report prefix matching on sub-paths
  misbehaving, so settle it on a device.
- **How the server reaches a clip.** The same-night notification needs a
  token registered by the clip, and `lib/push.ts` and `lib/fcm.ts` know
  only web subscriptions and FCM tokens for the full app. Whether FCM can
  carry a clip's token or the clip needs APNs direct under its own bundle id
  is not established; settle it before promising the "you're in" push, and
  until then the clip shows the confirmation on screen and nothing relies on
  the push.
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

## Sources (2026-11-04)

- Apple, What's new in App Clips (WWDC23): https://developer.apple.com/videos/play/wwdc2023/10178/ — default App Clip links, launching a clip from any app, the size limits per invocation.
- Apple, App Clips overview: https://developer.apple.com/app-clips
- Apple, `NSAppClipRequestEphemeralUserNotification`: https://developer.apple.com/documentation/bundleresources/information-property-list/nsappclip/nsappcliprequestephemeralusernotification
- Apple, Associating your App Clip with your website: https://developer.apple.com/documentation/appclip/associating-your-app-clip-with-your-website
- Apple, Interacting with App Clip Codes in AR (sample code; App Clip Codes shown on another device): https://developer.apple.com/documentation/appclip/interacting-with-app-clip-codes-in-ar
- Apple Developer Forums, App Clips and Keychain: https://developer.apple.com/forums/thread/650450 — iOS 15.4 clip-to-app keychain access through the associated entitlements.
- 9to5Mac, WhatsApp may soon let iPhone users open any link in an in-app browser (2026-10-19): https://9to5mac.com/2026/10/19/whatsapp-may-soon-let-iphone-users-open-any-link-in-an-in-app-browser/
- iPhone in Canada, Apple opens iPhone NFC payments to third-party apps in iOS 18.1: https://www.iphoneincanada.ca/2024/08/14/apple-opens-iphone-nfc-payments-to-third-party-apps-in-ios-18-1/
