# The score on a foldable's outer screen

**Track:** ROADMAP critical path, "capture game/win-loss data", by way of `docs/plans/foldable-layout.md` step 4 ("the two-screen scoreboard, outer screen faces the players").
**Status:** in-flight (step 1 built 2026-11-16; waits on a store build)
**Review on:** 2026-12-14 — has the probe build reported what Grant's Fold answers for dual-screen mode (UNSUPPORTED / UNAVAILABLE / AVAILABLE)? If UNSUPPORTED, this plan stops at step 1.

## Problem

Grant, 2026-11-13, on a Galaxy Z Fold opened flat, after voice scoring went live (`docs/plans/voice-score.md`): "Can you make it do the scroe shows on the main screen the outter one?"

The courtside board (`components/stats/CourtsideScoreboard.tsx`) puts the score and the +1 buttons on the same inner screen, so the players on court cannot read it unless the phone is half-folded on the bench (the hinge split from foldable-layout step 3). With the phone held open in the hand, the outer screen faces the court and shows nothing.

`foldable-layout.md` step 4 parked this "only if step 3's board gets used at a session". Grant's ask is the first sign of use, but it came from trying the board, not from a court night; say so when deciding.

## What the platform allows (read 2026-11-16)

- **A web page cannot do it.** Chrome and the home-screen app draw on the one display the page is open on. Folding the phone moves the page to the outer screen and turns the inner one off.
- **Android's Jetpack WindowManager has two modes** (`androidx.window.area`, from 1.2.0-beta03; the app has `androidx.window` 1.3.0 already, for `BpmFoldPlugin`):
  - **Dual-screen mode** (`OPERATION_PRESENT_ON_AREA`, `presentContentOnWindowArea`): the app stays on the inner screen and a second view is drawn on the outer one. This is the mode we need. Google documents it as "available on Pixel Fold running Android 14 (API level 34) or higher" and names no other device.
  - **Rear display mode** (`OPERATION_TRANSFER_ACTIVITY_TO_AREA`): the whole app moves to the outer screen and the inner one turns off. Samsung documents this mode for Galaxy Fold from One UI 6.0, and says nothing about dual-screen mode. It does not help here: the scorer would lose the buttons.
- **The phone answers the question, not the docs.** `WindowAreaInfo.getCapability(OPERATION_PRESENT_ON_AREA).status` reads UNSUPPORTED, UNAVAILABLE, AVAILABLE or ACTIVE. Only a build running on Grant's Fold can say which.
- **The system shows a permission dialog** before switching screens, which the app cannot customise.
- **Voice does not exist in the store app.** Android WebView leaves out the Web Speech API, so the store app hides the mic (`lib/useVoiceScore.ts`, `recognitionCtor` returns null under `isNative()`). Voice on an outer-screen board means a native `SpeechRecognizer` plugin and `RECORD_AUDIO`, which the Android manifest does not declare today.

Sources: developer.android.com/develop/adaptive-apps/guides/foldables/support-foldable-display-modes; developer.samsung.com/sdp/blog/en/2024/09/26/unfold-the-potential-of-galaxy-fold-devices-with-windowmanagers-rear-display-mode.

## Kill criterion

- **Step 1 decides it:** if Grant's Fold reports dual-screen mode UNSUPPORTED, stop. Rear display mode is not a substitute, and a Pixel-Fold-only feature is not worth a store release for a club with no Pixel Folds.
- **After it ships:** if no game is kept with the outer screen on in the first four court nights it is available, take the button out of the board.

## Non-goals

- **iPhone.** The plan in `foldable-layout.md` names Apple's scene accessories for the iPhone Duo; nobody in the club has asked, and Grant's phone is Android. Revisit on a request.
- **Rear display mode** (the whole board on the outer screen with the inner one off).
- **Touch on the outer screen.** It shows the score; the scorer taps or speaks on the inner one.
- **A second web page on the outer screen.** A native view fed by the board is smaller, works without a network and cannot drift from a page load.
- **Changing the web board for anyone without the store app.** Browsers keep the hinge split they have today.

## Steps (proposed, nothing built)

1. **Probe.** `BpmFold` (or a new `BpmOuterScreen` plugin) reports the dual-screen capability status to the page; the board shows it on its Preview line in the store app. Ships with the next store build (`versionCode` 8). Needs Grant's machine: the Play upload is signed there.
2. **Outer score, tap only.** If step 1 reads AVAILABLE or UNAVAILABLE (available when unfolded), the store app's board gets a "Show on outer screen" button. The plugin opens a dual-screen session and draws a native view on the outer screen: the two scores, the server's dot, the status line ("Game point · A side"), dark, as large as the screen allows. The board pushes each change to the plugin. Closing the board, leaving the app or the system dismissing it ends the session.
3. **Voice in the store app** (only if 2 is used): a native speech plugin (`SpeechRecognizer`, restarted after each result, as `lib/useVoiceScore.ts` restarts the browser's), `RECORD_AUDIO` declared and asked for, feeding the same `parseCall` / `matchCall` in `lib/voiceScore.ts`. A second store build.

## Questions for Grant before step 2

- ~~Which Fold model and One UI version is the phone?~~ Answered 2026-11-16, see Decisions.
- ~~Held open in the hand, or on the bench?~~ Answered 2026-11-16, see Decisions.
- ~~Does the outer screen need voice (step 3)?~~ No, answered 2026-11-16, see Decisions.

## Decisions

- **The phone is a Galaxy Z Fold 8 on One UI 9** (Grant, 2026-11-16). Newer than anything Google or Samsung document for dual-screen mode (Google names only the Pixel Fold; Samsung documents rear display mode from One UI 6.0), so the docs neither promise nor rule it out. Step 1's probe is still the only answer.
- **Held open in the hand** (Grant, 2026-11-16), not on the bench. The hinge split from foldable-layout step 3 does not serve this: with the phone open flat in the hand, the outer screen is the only one facing the court. This is the case the plan exists for.
- **No voice** (Grant, 2026-11-16: "build step 1, no voice"). Step 3 is dropped: the outer screen shows the score and the scorer taps on the inner one. The store app keeps hiding the mic.
- **Step 1 is a line on the board, not a flag** (2026-11-16). The probe lives in the existing `BpmFold` plugin (`getDualScreen`), not a new one, because it reads the same WindowManager the fold does. The board shows one Preview line only when the store app reports an outer screen; a browser, an iPhone build (no `getDualScreen`, the call rejects) and Android builds up to versionCode 7 show nothing, and a one-screen phone shows nothing because the plugin reports `outerScreen: false`. So no flag is needed to keep it from members who cannot use it, and step 2 replaces the line with the button.
- **The window-area API needs an opt-in** (2026-11-16). Every class in `androidx.window.area` 1.3.0 carries `@ExperimentalWindowApi`, so `BpmFoldPlugin` carries `@OptIn(markerClass = ExperimentalWindowApi.class)` (from `annotation-experimental`, which `appcompat` → `core` puts on the compile path), pinned by `__tests__/native-shell-projects.test.ts`. The plugin was compiled here against the real androidx.window 1.3.0, core 1.13 and Kotlin jars with stand-ins for Capacitor's classes; the release build on Grant's machine is the first full Android build of it.

## Reading the probe (step 1)

1. Build and upload the Android shell as `native/README.md` says ("Android: the signed bundle, from the shell"), bumping `versionCode` from what the Play Store holds.
2. On the Fold 8, update the app from the Play Store, open it unfolded, then Stats → Play → Keep score.
3. The line under the buttons reads one of:
   - "Outer screen: this phone can show the score there." (`available`): go to step 2.
   - "… supported, but not right now. Open the phone flat and try again." (`unavailable`): open it flat and reopen the board; supported, so step 2 too.
   - "… this phone can't show the score there." (`unsupported`): the kill criterion. Stop, and record it here.
   - No line at all: the app is still the old build, or the phone reported no outer screen; say which.

## Shape

| Piece | File |
| --- | --- |
| The probe (step 1): `getDualScreen` → `{ outerScreen, dualScreen, rearDisplay }` | `android/app/src/main/java/com/motioncraft/bpm/BpmFoldPlugin.java` |
| The page's side: `dualScreenFromNative`, `getDualScreen`, `useDualScreen` | `lib/fold.ts`; tests `__tests__/fold-dual-screen.test.ts` |
| The Preview line (step 1); the button and the pushes (step 2, proposed) | `components/stats/CourtsideScoreboard.tsx`, strings `stats.courtside.outer`; tests `__tests__/components/CourtsideScoreboard.outer.test.tsx` |
| Native view on the outer screen (step 2, proposed) | inside the plugin; the score widget's layouts (`BpmScoreWidgetProvider.java`) are the closest existing drawing of a big native score |
