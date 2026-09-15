# Sign-in hand-off: the two takeovers

**Track:** Store launch — Sign in with Apple is required once the native app offers Google, and it rides the same hand-off, so it would open a second door into both gaps below.
**Status:** shipped 2026-09-15 — #430, #435; pop-up sign-in confirmed on Grant's iPhone
**Review on:** 2026-10-01 — did any member get stuck on the typed code, or report Google/Apple not signing them in?

## Problem

Nobody has reported this; it came from the 2026-09-11 security scan (findings
F3, F4, F13 in `Coding projects/badminton-security-report-20260911/`, outside
this repo). PR #425 (`6d166dd`, 2026-09-14) closed the easier paths. Two remain,
and each is a **full account takeover, admins included**. Both were already open
before #425 — it made nothing worse.

Grant's question, and the answer: *"if I have Sign in with Apple will it fix the
issue?"* — **No.** Apple uses the same hand-off as Google, so it has the same two
gaps, and turning it on adds a second way in.

Both need someone who knows a member to send them a crafted link and get them to
follow it. For a friends' club that is unlikely; the damage if it happens is not.

### Gap 1 — the fake "choose your name" screen

1. The attacker starts a Google sign-in with **their own** Google account and
   stops just before it finishes.
2. They send that half-finished link to a member — say Lin.
3. Lin opens it. The app asks her to choose a name. She types "Lin", is told the
   name is taken, and is asked for her PIN. She types it.
4. The attacker's Google account is now attached to Lin's account. They can sign
   in as Lin with Google whenever they like.

Where: `app/api/auth/claim-name/route.ts` links the pending provider identity to
whoever proves a name, and nothing ties that browser to the person who started
the sign-in. The route carries a `KNOWN GAP` comment.

**Why #425 does not close it:** a refusal was built and reverted before merge. On
the installed iOS home-screen app, a PIN-only member adding Google for the first
time goes through exactly this step, so refusing it would have locked nearly the
whole roster out of adding Google (Grant: *"this will stop everyone to sign up"*).

### Gap 2 — the fake Google sign-in link

1. The attacker starts a sign-in on their own phone and copies the Google page
   link it opens.
2. They send it to a member, who taps it and picks their own Google account —
   which looks completely normal.
3. The attacker's phone is signed in as that member.

Where: the parked-state branch of `lib/oauthCallback.ts`. The full argument is
in `lib/authHandoff.ts`'s docblock ("WHAT IS STILL OPEN").

**The victim can use anything** — a browser tab, Android, iOS. What matters is
that their browser never started this sign-in, so it holds no state cookie, and
that is exactly what a real iOS home-screen sign-in looks like to the server.

**Why the server allows it:** on an installed iOS home-screen app, Google/Apple sign-in
finishes in Safari, and iOS gives Safari no way back into the app. The hand-off
secret proves who **started** a sign-in, never who **finished** it, and on this
path there is no channel to carry proof back. The native app does have one
(`bpm://auth/return`), which is why #425 could close the native variant with a
return code.

## Who is affected today

**Any member who follows a crafted link** — for Gap 1 by also typing their name
and PIN, for Gap 2 by picking their Google (or, once live, Apple) account. What
app or browser they use does not matter. A member who never follows a link sent
by someone else is not exposed.

An earlier explanation (2026-09-14, in conversation) said Gap 2 was limited to
iOS home-screen users. That was wrong: the iOS home-screen app is why the server
must accept this path, not a condition on who the victim is.

## Options

### Gap 1 — take the PIN in the app, not on the page the link opened

When the name is taken, the page says "go back to the app", and the **app** asks
for the PIN. The attacker holds the hand-off secret but not the victim's PIN; the
victim's app has no pending sign-in, so there is nothing to type it into.

- Costs nobody a new step — people already know their PIN.
- Needs a pending provider identity parked for the app to collect, a claim that
  accepts a PIN, and a PIN field in both signed-in and signed-out shells.
- **Open question:** a website-in-a-browser member has no "app" — their flow is
  the ordinary cookie path, which is not affected, so they keep typing the PIN
  where they are. Confirm that stays true.

### Gap 2 — pick one

- **(a) Typed code.** Safari shows a 6-digit code after sign-in; the member types
  it into the home-screen app. The claim refuses without it, which closes it for
  every victim. Every sign-in method keeps working. Costs one step
  on this one path. The code needs an attempt cap (e.g. 5 wrong → the sign-in is
  burned), because the attacker holds the hand-off secret and can guess.
- **(b) Hide Google/Apple in the iOS home-screen app.** Members there use PIN or
  email; the server then refuses this path entirely — which closes it for every
  victim, not only iOS users. Least code and least attack
  surface. Anyone on iOS home-screen who only has Google must sign in some other
  way (Safari tab, or the native app once it ships).

Gap 1's fix and option (a) could share the same "enter it in the app" screen.

## Kill criterion

This failed if either:

- a member reports they could not add or use Google/Apple sign-in because of the
  fix, or
- Sign in with Apple ships while either gap is still open.

## Non-goals

- Changing PIN sign-in, name-only sign-up or email sign-up.
- Reworking the native return code #425 shipped.
- The Apple button's visual spec — separate, and already noted in
  `components/auth/ProviderButtons.tsx`.

## Decisions

- **2026-09-14 — partial fix first** (Grant), over a typed code or hiding the
  buttons. Shipped as #425.
- **2026-09-14 — `claim-name` refusal reverted before merge** (Grant). It closed
  Gap 1 but locked PIN-only iOS home-screen members out of adding Google.
- **2026-09-14 — spike: a pop-up can report back** (#428, Grant's iPhone, iOS
  18.7, installed home-screen app). `window.open` + `window.opener.postMessage`
  worked both same-site and through Google's real consent screen. That opened a
  third option neither (a) nor (b) had: sign in through a pop-up, so the
  sign-in comes home by itself and nobody types anything on the normal path.
- **2026-09-14 — build it** (Grant). Both gaps closed together:
  - **Gap 2:** every completed stash needs a code to claim. The pop-up posts a
    64-hex code to the app; the native shell already had one; the full-page
    Safari trip, or a pop-up that cannot report back, shows **6 digits** the
    person types into the app. That is option (a) as the fallback, not the
    main road. Capped at 5 attempts, counted under an etag before comparing, so
    parallel guesses cannot share one count; a fresh stash needs a fresh victim
    completion, so guessing does not scale.
  - **Gap 1:** a new Google/Apple identity on a hand-off is named **in the
    app**. The completing browser gets no pending-signup cookie; the facts wait
    on the stash, and the claim (preimage + code) sets the cookie in the app's
    own jar, where the name step and `claim-name`'s PIN run as usual. PIN-only
    members still add Google — they just type the PIN in the app.
  - The pop-up posts only to an origin of ours, recorded at `/start`, because
    Grant's home-screen app runs on the Azure host, not `bpm.grantzou.com`.
- **2026-09-15 — first device test failed, then passed** (#435). The pop-up
  reported back but the app never claimed: opening the pop-up fired a claim
  before `/start` had parked anything, and its `none` cleared the hand-off id.
  Found in App Insights, not guessed. The client now disbelieves a `none` for
  two minutes after a tap.
- **2026-09-15 — legacy paths removed:** the `handedOff` notice and
  `PendingSignup.parked`, once the last pre-#430 pending cookie (30-minute TTL)
  had expired.
- **The typed-code rate limit is per HAND-OFF, not per IP** (advisor, before
  merge). The club signs in from one gym's wifi; a per-IP cap would have
  locked the venue out after ten typed sign-ins, and shown it as a cold
  start. The stash's own 5-attempt cap is what bounds guessing.
- **Left on purpose:** the device-code phishing every such flow has — someone
  talking a member into reading out their code. The code page says nobody from
  the club will ask for it. Cancelling in a pop-up lands on the app's own error
  notice inside the pop-up rather than closing it.

## Shape

| Piece | File |
|---|---|
| Hand-off store, return code, the full security argument | `lib/authHandoff.ts` |
| The three rules (`viaParkedState`) | `lib/oauthCallback.ts` |
| Callbacks that set `viaParkedState` | `app/api/auth/google/callback/route.ts`, `app/api/auth/apple/callback/route.ts` |
| Why `claim-name` is safe now | `app/api/auth/claim-name/route.ts` |
| Pop-up opener, landing parser, claim | `lib/handoffClient.ts`, `components/auth/ProviderButtons.tsx` |
| Pop-up landing / typed code shown | `app/auth/done/page.tsx`, `components/auth/HandoffDone.tsx` |
| Typed code entered | `components/auth/HandoffCodeSheet.tsx`, `lib/useHandoffCollect.ts` |
| Own-origin allowlist | `lib/appOrigin.ts` |
| `parked` on the pending-signup cookie | `lib/pendingSignup.ts` |
| Claim (preimage + return code) | `app/api/auth/handoff/claim/route.ts` |
| Client: staging, return code, landing link | `lib/handoffClient.ts`, `components/NativeBridge.tsx` |
