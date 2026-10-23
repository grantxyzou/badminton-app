# Native: home-screen widgets

**Track:** the native shell (`docs/plans/native-shell.md`), its second addition after launch (after `native-badge-shortcuts.md`).
**Status:** in-flight
**Review on:** 2026-12-15 — a month after the store build that carries this: how many members added a widget, and how many sign-ups came from its Join?

## Problem

Grant, 2026-10-21: "Can we have widgets with this pwa version or now we are in
App Store what other feature can we look in into". On the Native canvas page
he chose widgets after the badge and shortcuts ("draw the widgets next"), then
asked for two changes to the drawing: "tap to join" — sign up from the widget
itself — and a large widget that shows his skill level ("Skill level?"),
on the large size only ("Only large widget.").

## Kill criterion

If a month after the build ships fewer than one in ten active members has
added a widget, it stops getting new features and the large size goes first.
If Join on the widget produces sign-ups people did not mean (cancelled within
ten minutes, more than one in five), Join goes back to opening the app.

## Non-goals

- A widget for admins (who owes, the bench). Members first.
- Live updates every minute. iPhone decides how often a widget refreshes; the
  app asks for a refresh whenever it closes, and the widget shows "Updated"
  when what it shows is old.
- Chinese copy on the widget. Like push payloads, it is English: there is no
  per-member locale to choose from yet (`Member.locale` is deferred).
- The stringing Live Activity. Drawn on the same canvas page, built later.

## Decisions

- **2026-10-22 — the widget has its own pass, not the WebView's cookie.** A
  widget runs outside the app and cannot read its cookies. The app, signed in,
  calls `POST /api/widget/token` and hands the result to the widget's storage
  (the iOS App Group, Android's private preferences). The pass is a signed
  token with its own audience (`typ: 'widget'`): refused as either session
  cookie, read only from an `Authorization: Bearer` header by the
  `/api/widget` routes, and re-checked against the membership on every read,
  so a removed member's widget goes dark on its next refresh. Sixty days; the
  app re-mints it on every open. Stateless, so there is no per-device revoke:
  signing out clears it from the device, removal from the club stops it
  server-side, and rotating `SESSION_SECRET` stops every pass at once.
- **Join and Undo are the sign-up route, not a copy of it.** `POST` /
  `DELETE /api/widget/join` re-enter `POST` / `DELETE /api/players` as the
  member the pass names (a five-minute member cookie the server builds and
  never sends anywhere). Every rule Home's button meets — sign-ups open, the
  deadline, capacity, the soft hold, the late-cancel fee — the widget meets by
  construction. Both answer with the fresh snapshot, so the widget shows
  "Signed up" only after the server said yes.
- **Undo, for a few minutes.** A widget is easy to brush with a thumb. After a
  Join the widget offers Undo until it next refreshes; Undo is the ordinary
  cancel. A late-cancel window still applies: the widget then opens the app,
  where the fee warning lives.
- **Sizes**: small is the week alone (one tap target on iPhone); medium is the
  week and the balance; large adds the level (Grant: large only). The level is
  the member's own check-in trend — never a club comparison, the "Your skills"
  rule — and absent rather than zero before the first check-in.
- **Money stays off a locked screen.** The lock-screen widgets mark the amount
  private, so iPhone hides it until Face ID; the push rule already keeps
  amounts off a locked phone.
- **One read, the app's own numbers.** `GET /api/widget` (`lib/widget.ts`)
  takes the owed total from `computeOwed` and the level from
  `summarizeAssessmentTrend` — the helpers Home and Stats use — so the widget
  and the app cannot disagree. A failed read is a 503 and the widget keeps
  what it last showed under its "Updated" time.
- **The iOS widget is its own target, added in Xcode.** Its sources are in
  `ios/App/BPMWidget/`; the target is created once with Xcode's own template
  (`native/README.md` has the steps) rather than by hand-editing the project
  file, because a malformed project file would stop every archive, and none of
  this can be built off a Mac. Android's widget lives inside the app module and
  needs no new target.

- **2026-10-23 — the plugin is registered by the controller the app ACTUALLY
  uses.** The first cut named `MainViewController` in `Main.storyboard`, but
  `SceneDelegate.swift` builds the window in code with a bare
  `CAPBridgeViewController()`, so the storyboard's class was never read; on
  Grant's phone `Capacitor.isPluginAvailable('BpmWidget')` answered `false`
  and the widget never got its pass. `SceneDelegate` now creates
  `MainViewController()`, and the shell canary pins it. Found on the first
  device run, through Safari's Web Inspector on the app's own page.
- **A failed read is not "sign in".** With no pass the widget says "Open BPM
  and sign in"; with a pass but a failed read and nothing cached, it says
  "Couldn't load your week" — the first cut showed the sign-in line for both.
- **Sign-out never waits on the phone.** It cleared the badge, the long-press
  menu and the widget with `await Promise.all(...)` before clearing the
  identity, so on the first build carrying all three plugins Sign out did
  nothing at all. `lib/clearDeviceTraces.ts` gives them 1.5 s, then signs out
  regardless; a clear that fails leaves a badge, never a person signed in.
- **The plugin proxy must never resolve a promise.** Capacitor's plugin proxy
  answers every property as a native method, `then` included, so
  `import(...).then(() => registerPlugin('BpmWidget'))` adopted it, called
  `BpmWidget.then()` ("not implemented") and rejected. Every `setSession`,
  `clear` and `reload` was dropped and swallowed: the app never handed the
  widget its pass, and sign-out never cleared it. `lib/widgetBridge.ts` keeps
  the proxy in a `{ widget }` box, and the test's mock is now a proxy of the
  same shape (a plain object hid it). Found in Grant's Web Inspector log: the
  badge and shortcut calls showed, the widget's never did.
- **"Signed up", not "You're in"** (Grant, on the canvas): the widget's word for
  being on the list, on both platforms and the lock screen.

## Shape

| Piece | File |
| --- | --- |
| The pass (mint, verify, the internal member cookie) | `lib/auth.ts` |
| Snapshot and the membership gate | `lib/widget.ts` |
| Routes | `app/api/widget/route.ts`, `app/api/widget/token/route.ts`, `app/api/widget/join/route.ts` |
| App side: mint, hand over, reload, clear on sign-out | `lib/widgetBridge.ts`, mounted in `HomeShell` |
| iOS plugin (App Group storage, timeline reload) | `ios/App/App/BpmWidgetPlugin.swift`, `ios/App/App/MainViewController.swift` |
| iOS widget extension | `ios/App/BPMWidget/` |
| Android plugin and widget | `android/app/src/main/java/com/motioncraft/bpm/BpmWidget*.java`, `res/layout/widget_bpm_*.xml`, `res/xml/bpm_widget_info.xml` |
| Tests | `__tests__/group-widget.test.ts`, `__tests__/widget-bridge.test.ts`, `__tests__/native-shell-projects.test.ts` |
