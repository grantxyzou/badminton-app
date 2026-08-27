---
name: verify-ui
description: Boot the app on the mock store and LOOK at a screen — screenshot it, at a phone viewport, signed in as whoever the screen needs. Use after any visible UI change, and before claiming a screen works. The test suite cannot see layout.
disable-model-invocation: false
---

# Verify UI

Boot the app offline, drive a real browser to one screen, and look at it.

## Why this exists

**jsdom applies no stylesheet.** Every computed margin in the vitest suite is
`0px`, so every spacing assertion measures nothing. On 2026-08-27 ten cards
shipped with the primary button jammed flush against the subtitle while 2244
tests passed — the tests assert on *text*, and text is blind to layout.

Three more bugs that week were invisible for related reasons: a button in a
branch that never renders (no test navigates), an admin receiving the wrong
response shape on a player card (no test crossed a real response with a real
component), and a crash from a missing i18n key (only visible on screen).

All four were found by a person looking at the app. This skill makes looking
cheap enough that it happens by default.

## Boot

```bash
PORT=3100 npm run dev:next:mock
```

`dev:next:mock` forces the in-memory store and seeds the `fresh-thursday`
scenario, so **production data is never touched**. Wait for the log line
`Mock store only.` — that is the proof you are offline. All flags are on.

Seeded identities: admin **Grant / 1130**; player **Lin / 2468**.

## Take the shot

Use the **Playwright MCP**, not headless Chrome.

`--virtual-time-budget` advances past `load` but terminates in-flight fetches,
so data-heavy tabs render a false offline banner. Worse, the app reads `?tab=`
*after* hydration, so a headless screenshot of `?tab=profile` reliably captures
**Home** instead — a documented trap in CLAUDE.md that has produced misleading
"proof" before.

```
browser_resize     430 x 932        # iPhone-class. Mobile-first app; desktop lies.
browser_navigate   http://localhost:3100/bpm
browser_click      <the bottom-nav tab>          # navigate by CLICKING
browser_take_screenshot
```

**If the browser is already in use**, that is the single-instance lock. See
`.claude/mcp-notes.md` for the `--isolated` fix; do not fall back to headless
Chrome and present the result as verification.

## Reaching a gated screen

- **Admin**: Profile → sign in as Grant / 1130 → Profile → `Admin tools →`
- **Player with data**: Profile → sign in as Lin / 2468
- **Flag-gated UI**: already on under `dev:next:mock`

Sign-in is rate-limited **5/hr per (name, IP)** and fails *silently into a
wrong-looking UI* — a card that looks missing is often just a throttled
sign-in. If a screen looks unexpectedly empty, check that first.

## What to actually look at

Assert with your eyes on the things the suite structurally cannot see:

- **Gap under a card header.** `CardHeader` sets no bottom margin by design;
  the card supplies `space-y-3`. Missing it is the exact bug above.
- **Anything flush against anything.** Buttons touching text, text touching
  card edges.
- **Raw key paths.** `admin.stringing.newJob` rendered as literal text means an
  i18n block landed under the wrong parent. `scripts/check-i18n-keys.mjs`
  catches this too, and faster.
- **Both themes.** Toggle it. Light-mode overrides are per-class, so a new
  colour class can be unreadable in one theme and fine in the other.
- **A long name and an empty state.** Most layouts are only tested with
  convenient data.

## Report honestly

Say what you looked at and at what viewport. If the browser was locked, or you
only reached one of two states, **say so** — "verified" for a screen you did not
actually see is worse than no claim, because it stops anyone else looking.
