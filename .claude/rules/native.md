---
paths:
  - "ios/**"
  - "android/**"
  - "native/**"
  - "capacitor.config.ts"
  - "lib/native.ts"
  - "lib/authHandoff.ts"
  - "lib/handoffClient.ts"
  - "lib/authMigration.ts"
  - "lib/migrationKey.ts"
  - "lib/widget*.ts"
  - "lib/appBadge.ts"
  - "lib/appShortcuts.ts"
  - "lib/calendarEvent.ts"
  - "lib/addToCalendar.ts"
  - "lib/fcm.ts"
  - "lib/usePush.ts"
  - "lib/fold.ts"
  - "lib/paneMode.ts"
  - "lib/scoreRules.ts"
  - "lib/gameIntent.ts"
  - "lib/shareImage.ts"
  - "lib/shareText.ts"
  - "lib/sheetStack.ts"
  - "components/NativeBridge.tsx"
  - "components/auth/**"
  - "app/api/widget/**"
  - "app/api/auth/**"
  - "app/migrate/**"
  - "app/auth/**"
  - "__tests__/native*.test.ts"
---

# Native Shell (App Store / Google Play)

<!-- Moved word for word from the root CLAUDE.md "Native Shell" section on 2026-11-08 (it was over the 150k-character limit). The root keeps the always-follow rules; this file loads when Claude touches a matching path. -->

A **Capacitor 8 WebView that loads the LIVE URL** (`capacitor.config.ts` →
`server.url`). There is no native build of the web app: a web deploy is already
a native update, and no `cap sync` or native build runs in CI — the shell is
archived locally a few times a year (`native/README.md` is the runbook; intent
and decisions in `docs/plans/native-shell.md`). Built 2026-09-03 on
`feat/native-shell`; live on both stores since 2026-10-07 (#549), archived and
submitted by Grant on device.

- **`lib/native.ts` `isNative()` is the seam.** It imports nothing and reads
  `window.Capacitor` at runtime — this build has no env of its own, so no
  `NEXT_PUBLIC_FLAG_*` can tell it apart. `false` means unknown (the
  `lib/standalone.ts` contract). **Every `@capacitor/*` package is a dynamic
  `import()` inside an `isNative()` branch**; `__tests__/native-imports.test.ts`
  fails the build on a static one, so the web bundle gains only unloaded chunks.
- **Branch points**: `InstallBanner` + the Profile install row (native counts as
  installed); `lib/shareImage.ts` (Filesystem → Share — Android's WebView has no
  `navigator.share` and `a.download` no-ops there); `lib/shareText.ts` (the
  sign-up link); `components/auth/ProviderButtons.tsx`; `lib/usePush.ts`;
  `components/NativeBridge.tsx` (renders nothing; `appUrlOpen`, `bpm:resume`,
  the Android back button, status-bar style, push-tap routing);
  `lib/sheetStack.ts` (which sheets are open, for the back button) and
  `lib/pageStack.ts` (which in-tab page is open — an admin page, a Profile
  sub-screen, a Stats page — so back steps out of it before leaving the tab;
  `docs/plans/back-navigation.md`). **Admin keeps a TRAIL of pages, not one
  page** (`AdminDashboard`, `lib/viewTrail.ts`): Back pops one, so a page
  opened from another returns to it.
- **OAuth runs in the SYSTEM browser sheet** — Google answers
  `disallowed_useragent` in an embedded WebView. That is a separate cookie jar,
  the exact split `lib/authHandoff.ts` already bridges. `/start?native=1`
  records `HandoffDoc.native` (read from the STASH, never the callback URL), the
  landing carries `?native=1`, and `HomeShell` renders "Back to the BPM app" →
  `bpm://auth/return` — a **custom scheme, not a universal link**, because a
  same-domain link opens in place. The bridge closes the sheet and dispatches
  `bpm:resume`; the handoff claim listens for it (a modal sheet inside the app
  fires neither `visibilitychange` nor `focus`). **Apple's routes gained the
  same handoff Google had** the same day — `apple/start` never parked `?hr=`,
  so an installed-PWA Apple sign-in came back signed out.
  **The handoff ref proves who STARTED a sign-in, never who finished it**
  (security scan F3/F4/F13): whoever calls `/start` picks it. So a stash is
  completed only when the callback needed it (state cookie absent) or the stash
  is `native` or `popup`; when the APP finishes (parked state, or a pop-up) the
  completing browser gets no `member_session`, never links, and never names a
  new account — the identity is parked on the stash and the claim sets the
  pending-signup cookie in the app's jar. **Every completed stash needs a code
  to claim**: a 64-hex return code where a machine carries it home
  (`bpm://auth/return?c=`, or the pop-up's `postMessage`), a 6-digit typed code
  where only a person can (5 attempts, counted under an etag before comparing).
  **The installed iOS web app signs in through a POP-UP** (`openSignInPopup` in
  `lib/handoffClient.ts`, `/start?popup=1&po=<origin>`): its landing
  `/bpm/auth/done` posts the return code to the opener's origin — checked
  against `APP_ORIGIN` and Azure's `WEBSITE_HOSTNAME`, because home-screen
  installs exist on both hosts — and shows the typed code when nothing
  acknowledges; `HandoffCodeSheet` takes it in both shells. Codes ride in URL
  FRAGMENTS, never the query. `lib/authHandoff.ts`'s docblock carries the full
  argument; `docs/plans/oauth-handoff-gaps.md` the history and decisions.
- **Push is one server transport for both platforms**: `@capacitor-firebase/messaging`
  hands back an FCM token on iOS and Android (Firebase relays to APNs), and
  `lib/fcm.ts` sends via FCM HTTP v1 with zero dependencies. `PushSubscriptionDoc`
  gained additive `platform`/`token` (absent = web); `endpointHash` is the sha256
  of whichever credential the doc holds. **Only a dead token reports `gone`**
  (404/`UNREGISTERED`, or a 400 naming the token); 429/5xx keep it, asserted both
  ways. An unconfigured arm is skipped and logged once, never counted failed.
  Env `FCM_SERVICE_ACCOUNT_JSON` (App Settings; carries a `private_key`).
  `MainActivity` creates the `bpm` channel every message names — a push to a
  missing channel is dropped silently on Android 8+.
- **The migration link** (`lib/authMigration.ts`, `POST /api/auth/migrate/{start,claim}`,
  `MigrateSheet` / `MigrateCodeSheet` / `app/migrate`) carries a signed-in PWA
  identity into the shell. Flag `NEXT_PUBLIC_FLAG_NATIVE_MIGRATE`, **ON since
  2026-10-07**, the day both store listings were live. Direction inversion from the OAuth handoff: the link
  IS a bearer credential, so it is contained by a live `member_session` to mint,
  a 5-minute TTL, single use (both sibling docs deleted first) and per-IP rate
  limits; point reads only. **The claim re-mints `deleteToken`**, and the route test asserts the
  returned token is the one on the doc. `DELETE /api/players` also accepts the
  row's own member's `member_session` since 2026-09-29 (the token lives in one
  browser's storage, so members who switched to the installed app or a new
  phone could not cancel — admins never saw it, their cookie skips the check).
- **The icon badge and the long-press menu** (`docs/plans/native-badge-shortcuts.md`,
  2026-10-21; capawesome's Badge and App Shortcuts plugins, v8): `lib/appBadge.ts`
  counts what is owed and FROZEN — settled sessions not reported paid, plus
  stringing charges — from the read `UnpaidSessionsCard` already makes, and
  sets it only after a read that SUCCEEDED (unknown is not zero). It never
  prompts, and clears to zero only from a badge that showed something,
  because a zero badge on iOS also clears delivered notifications. The web
  app on a home screen gets the same badge through `navigator.setAppBadge`.
  `lib/appShortcuts.ts` keeps the menu (Sign up for <day>, What I owe,
  Request stringing) current from Home's own reads; a tap routes in place
  through `NativeBridge`, and Request stringing opens the form via the
  stringing intent's `'open'` marker. Sign-out clears both. iOS needs
  `SceneDelegate.swift` to forward the tap (pinned by the shell canary).
  **They ship with the next store build** — the web half is harmless on the
  current binary, which answers `hasNativePlugin() === false`.
- **Home-screen widgets** (`docs/plans/native-widgets.md`, 2026-10-22): the
  widget runs outside the WebView with no cookies, so it reads and acts with
  its OWN pass — a signed token with audience `typ: 'widget'` (`lib/auth.ts`
  `mintWidgetToken` / `verifyWidgetToken`), refused as either session cookie,
  sent only as `Authorization: Bearer` to `/api/widget*`, and re-checked
  against the membership on every read (`requireWidgetMember` in
  `lib/widget.ts`). The app mints it (`POST /api/widget/token`) and hands it to
  the in-app `BpmWidget` plugin (`lib/widgetBridge.ts`; iOS
  `BpmWidgetPlugin.swift` via `MainViewController`, Android
  `BpmWidgetPlugin.java` via `MainActivity`), which keeps it in the App Group /
  private prefs; sign-out clears it AND revokes it on the server
  (`DELETE /api/widget/token` stamps `widgetPassNotBefore` on the membership,
  `Member` with groups off; `requireWidgetMember` refuses a pass minted
  earlier, 2026-10-24), because a stateless sixty-day pass copied off the
  phone would otherwise outlive the sign-out. A widget tap re-mints at once
  (`NativeBridge`), so a second phone of the same person is dark only until
  it is tapped. **Join and Undo are the sign-up route**:
  `/api/widget/join` re-enters `POST` / `DELETE /api/players` as the member
  (`memberCookieHeaderFor`, a five-minute cookie never sent anywhere), so every
  rule Home's button meets, the widget meets. Taps open a TAB through
  `bpm://open?tab=` (`widgetOpenTarget`), never a path — the one query it
  carries besides the tab is `game=21-18` from the SCORE widget's Save game,
  which `lib/gameIntent.ts` parks for `SteppedGameLoggerSheet` to open
  prefilled (Swap sides, because the widget cannot know which side was yours);
  the sheet's save calls `markWidgetGameSaved(score)` so the widget marks
  that game saved. The score widget's game never touches the server before
  that save; it has two sizes (the large is the court-side scoreboard with
  tonight's games, a list kept on the phone and cleared at midnight); its
  rules are `lib/scoreRules.ts` (umpire's terms: game point, "20 all", "29
  all · next point wins", Interval at 11; sides are A side and B side), and the
  Swift and Java ports are held to `__tests__/score-rules.test.ts`. The large
  widget's stringing section reads the bench through `lib/stringingOrder.ts`
  (shared with the jobs route) and wears strings by TIME against
  `RESTRING_AFTER_WEEKS`, never by sessions. The header mark is the launch screen's shuttle image (`BPMShuttle` in the
  extension's catalog, `widget_bpm_shuttle.png` on Android), never a redrawn
  mark (Grant, 2026-10-25). The iOS extension's sources are in
  `ios/App/BPMWidget/` (both widgets, one bundle) and its TARGET is created
  once in Xcode (`native/README.md`), never by hand in the project file. It
  was made on Grant's Mac and COMMITTED on 2026-10-24 (#716), so a fresh
  checkout builds the widgets; Xcode had raised the app's minimum iOS to its
  "recommended" variable while doing it, and `native-shell-projects` now pins
  the floors (app 15.0, widget 17.0). Store build 5 (#719) is the first that
  carries the widgets, the icon badge and the shortcuts; build 7 on the iPhone
  and 6 on Android (#748, 2026-10-28) add Add to calendar. Bump from whatever
  the store holds, not from what the project says. **The widget pass stays
  where it was made** (audit, 2026-11-05): both plugins hand it only to the
  app's own hosts (`bpm.grantzou.com`, the Azure host, and `motioncraft-bpm.com`
  ahead of the move — the same list in Swift and Java, pinned to
  `capacitor.config.ts`), Android's backup and phone-to-phone transfer leave
  `bpm_widget.xml` out, and iOS stores the phone's `identifierForVendor`
  beside the pass and ignores a pass restored onto another phone; a restored
  widget is dark until the app is opened and mints its own. **The migration
  link asks before it signs in** (same day): a link is minted by whoever is
  signed in on the web, so one sent to someone else signed THEIR app in as the
  sender on arrival; `MigrateClaim` now shows who would be signed out and
  claims only on the tap.
- **Add to calendar** (`docs/plans/add-to-calendar.md`, 2026-10-28): the
  sign-up banner's one action. In the store app it is the in-house
  `BpmCalendar` plugin (iOS `BpmCalendarPlugin.swift`, Android
  `BpmCalendarPlugin.java`), which opens the platform's OWN New Event screen
  filled in — nothing is written without the person tapping Add; on the web it
  is `GET /api/session/calendar`, a members-only `text/calendar` URL.
  `lib/calendarEvent.ts` builds the event for both. iOS 17+ needs no calendar
  access; 15–16 asks once (`NSCalendarsUsageDescription`, canary-pinned). A
  store build without the plugin shows no button rather than a dead one.
