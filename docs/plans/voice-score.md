# Voice scoring on the courtside board (proof of concept)

**Track:** ROADMAP critical path — "capture game/win-loss data". The courtside board (`components/stats/CourtsideScoreboard.tsx`) is how a game's score reaches Add a game; a board that keeps itself while everyone plays is more games captured.
**Status:** in-flight
**Review on:** 2026-12-11 — ask Grant: has a whole game been kept by voice on a court night, and did the board ever score a rally from another court's call?

## Problem

Grant, 2026-11-13: "The score counting widget, can we make a in pwa poc same functionality but there is mic feature where when we announce the score the phone will keep the score?"

The board needs a free hand at every rally. Courtside, the person keeping score is usually the one sitting out, and when nobody is, the score is called out loud and not kept at all. The call is already said on every rally; the phone could listen to it.

## Kill criterion

The POC fails if, on a real court night (other courts calling scores within earshot), either:

- the board scores a rally nobody on THIS court called (a neighbouring court's call accepted) more than once in a game, or
- a call made at normal volume is missed more often than it is caught (the person ends up tapping anyway).

Either one means voice costs more attention than the +1 buttons it replaces. Kill the flag; keep the parser only if a native speech plugin is next.

## Non-goals

- **Voice in the store apps.** The Capacitor shell's WebViews have no speech recognition, the iOS app declares no microphone permission and the Android app no `RECORD_AUDIO`. Making it work there is a native plugin and a store release; this POC hides the mic in the shell (`isNative()`).
- **Chinese calls.** English only for the POC (Grant, 2026-11-13). The strings are translated; the recogniser listens in `en-US`.
- **Voice commands** ("undo", "new game"). The buttons stay; a misheard command is worse than a misheard score.
- **Saving anything about the audio.** Nothing is recorded or stored by us; the transcript is matched on the phone and dropped.
- **A server-side speech service.** It would fix iPhone home-screen apps, but it is a new paid dependency and a new data flow; not for a POC.

## Decisions

- **The existing board, not a copy** (Grant, 2026-11-13). It already has the umpire's rules (`lib/scoreRules.ts`), the fold split, the wake lock, haptics and Save → Add a game; a second board would be a second set of rules to keep in step.
- **The score call, server's score first, and only one rally on** (Grant chose "The score call" over "point A / B"). The rally winner serves next, so a call `X Y` claims "the side now on X just won". It is accepted only when it is exactly one rally on from the board. A neighbouring court's call is almost never one rally on from ours, so it is shown as "Heard …" and ignored, never scored. A side call ("point A") would have matched every court's call.
- **A level score asks.** At 5 all, "six five" fits either side. The board says which score it heard and offers two big buttons ("A side won", "B side won") rather than guess. "Service over" in the call settles it (the side NOT serving won), and "X all" never needs asking (the side that was one behind won).
- **Hands-free where it works, tap-to-speak where it does not** (Grant chose "Hands-free + tap fallback"). Chrome (Android) listens continuously and is restarted after the silence that ends it. iOS WebKit's continuous mode is reported unreliable (WebKit bug 225298, developer reports), so on iPhone/iPad the mic is a tap: tap, say the score, it stops. A continuous session that keeps ending at once also drops to tap.
- **Off in production by default.** `NEXT_PUBLIC_FLAG_VOICE_SCORE` is `'false'` in `deploy-next.yml`, `'true'` in `dev:next`. Turning it on is one line, but first the privacy policy needs a sentence: Chrome sends the audio to Google's speech service and Safari to Apple's, and `legal.privacy` mentions neither audio nor speech today.
- **`Permissions-Policy: microphone=(self)`.** It was `microphone=()`, which refuses the mic to every page. `self` lets our own pages ask; the browser still prompts the person, and `camera=()` and `geolocation=()` stay shut.

## Shape

| Piece | File |
| --- | --- |
| The call parser and the one-rally-on matcher (pure) | `lib/voiceScore.ts`, `__tests__/voice-score.test.ts` |
| The recogniser: support check, continuous vs tap, restart | `lib/useVoiceScore.ts` |
| The mic, "Heard …", the which-side chooser | `components/stats/CourtsideScoreboard.tsx`, `.courtside-voice*` in `app/globals.css`, strings `stats.courtside.voice` |
| The flag | `lib/flags.ts`, `.github/workflows/deploy-next.yml`, `package.json` `dev:next` |
| The mic permission | `next.config.js` `Permissions-Policy` |
