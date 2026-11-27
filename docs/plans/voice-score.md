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
- **Off in production by default.** `NEXT_PUBLIC_FLAG_VOICE_SCORE` was `'false'` in `deploy-next.yml`, `'true'` in `dev:next`. The plan was a privacy-policy sentence first: Chrome sends the audio to Google's speech service and Safari to Apple's, and `legal.privacy` mentions neither audio nor speech.
- **On in production, 2026-11-13** (Grant: "Just on now fast"), ahead of that sentence, so it can be tried courtside. Every signed-in member sees the mic on Keep score in a browser that has a recogniser; there is no per-person switch. The `legal.privacy` sentence is still owed.
- **`Permissions-Policy: microphone=(self)`.** It was `microphone=()`, which refuses the mic to every page. `self` lets our own pages ask; the browser still prompts the person, and `camera=()` and `geolocation=()` stay shut.

- **A glued call is two scores** (2026-11-13, the first try on a phone, Chrome on Android: the board said "Didn't catch a score" to a plain call). Chrome writes "one zero" as "10" and "two one" as "21". When the words as written hold no score, a two-digit run is read as two (`tokens(text, glued)`), so "10 8" still reads ten–eight. A miss now shows the words heard ("Heard “…”: no score in that"), so the next one says what the phone understood.

- **One phrase per session, restarted; never Chrome's continuous mode** (2026-11-17, Grant on the Fold: "Voice doesn't not work when I say 2-0 or 1-1 after first call it stops working"). Hands-free asked Chrome for `continuous = true`, which Android Chrome does not honour reliably (react-speech-recognition's maintainers call it an Android limitation; the common workaround is `continuous = false` and a restart from `onend`). Now every session hears one phrase in both modes and `onend` starts the next while the mic is wanted; a session that has neither heard a phrase nor ended after `SESSION_WATCHDOG_MS` (15 s) is dropped and replaced, for a session that goes quiet without ending. Android Chrome may beep at each restart. Not yet confirmed on the phone.

- **Who serves is asked first, and "zero zero" starts the game** (Grant, 2026-11-27: "The score counting feature on the web app is bad flow. When user say "zero zero" that's start but before that ask which side serves."). With voice on offer the board opens on "Which side serves first?"; the tap that answers turns the mic on, so there is no separate "Listen" tap, and the board shows the server from the first rally. Nothing scores until "zero zero" or "love all" is heard (`isStartCall`): before, a neighbouring court's "one zero" was one rally on from an empty board. A tapped +1 starts the game too, and New game asks again. Knowing the first server also lets "service over" settle the very first rally.
- **A level score still asks, and now the board flashes** (Grant, same day, asked how the phone should tell "6-5" for one side from "6-5" for the other at 5 all: "When that happens: light up the screen flashing ask which side. Keep the button"). Knowing who served first cannot settle it: the winner serves next and the server's score is said first, so both outcomes are the same words. The court-facing half and the two +1 buttons flash "Which side won?" (`.courtside[data-ask]`) until one of the answer buttons, or a +1, is tapped. Saying the first server's score first all game, and requiring "service over", were both offered and not chosen.

## Shape

| Piece | File |
| --- | --- |
| The call parser and the one-rally-on matcher (pure) | `lib/voiceScore.ts`, `__tests__/voice-score.test.ts` |
| The recogniser: support check, continuous vs tap, restart | `lib/useVoiceScore.ts` |
| The mic, "Heard …", the which-side chooser | `components/stats/CourtsideScoreboard.tsx`, `.courtside-voice*` in `app/globals.css`, strings `stats.courtside.voice` |
| The flag | `lib/flags.ts`, `.github/workflows/deploy-next.yml`, `package.json` `dev:next` |
| The mic permission | `next.config.js` `Permissions-Policy` |
