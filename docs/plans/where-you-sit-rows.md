# Where you sit — compact rows

**Track:** Value-Hub Slice-0 (#101), the Stats → You register, alongside `docs/plans/home-skill-lead.md`.
**Status:** shipped 2026-10-19

## Problem

Grant, reading the card's footnote on 2026-10-19: "Bands only. No names, no leaderboard — and you can turn this off in Profile." — "it sounds like AI". Asked whether the card could be drawn another way, he was shown three options on the Stats design canvas (A: strength and next-step tiles; B: one shared scale; C: compact rows) and picked C, with a footnote of his own.

The old card said everything twice: a sentence ("You're in the top third of the group at Clears & Lifts, and the middle third at Serves & Returns") and then the same two facts again as labelled bars.

## Kill criterion

None of its own. The card's job, and the reading that would take it off the screen, belong to `docs/plans/skill-leads-stats.md`.

## Non-goals

- Changing what is compared, how bands are computed, or the consent gate. `GET /api/stats/club/bands` is untouched.
- More than two skills. The card still shows the sharpest and the weakest rated skill.

## Decisions

- **One row per skill, saying it once.** Each row has the skill, three dots with the member's third lit (bottom → top, left → right) and the third in words. The lede sentence is gone (`stats.club.ledeOne`/`ledeTwo` deleted) and the band labels are sentence-case (`Top third`) because they now stand alone.
- **Tone per band, set once on the row.** `.sit-row[data-band]` sets `--sit-tone`, which both the lit dot and the label read, so they cannot disagree. Top = accent, middle = `--sev-low-text` (the calm blue from the canvas), bottom = `--text-secondary`. Never red: a position is not a score, the rule the old bar already followed.
- **"in the group" moves to the header** as the trailing label, so the rows need not repeat it. It is absent in the private state, where the header carries the Private pill instead.
- **The private state keeps its rows** with no dot lit and no label: the member still sees their own sharpest and weakest skill, as before.
- **The footnote says where the data comes from and how to turn it off**, nothing else: "Based on your latest check-in. You can turn this off in Profile." Grant first wrote "This shows your current skill positioning and how it compares to the players in the group." on the canvas, then settled on this shorter line in the canvas thread. "in the group" already sits in the header, so the footnote does not repeat it.
- **"turn this off" is a link** (Grant, canvas thread): it opens Profile on the Stats & privacy screen, not the top of Profile. `SkillsTab` writes a one-shot sessionStorage marker (`lib/profileView.ts`, the `OFFER_PIN_KEY` shape) and switches tab; `ProfileTab` consumes it once an identity exists. Rendered without a destination, the words stay plain text, like the locked cards' "Sign in".

## Shape

| Piece | File |
|---|---|
| Card | `components/stats/WhereYouSitCard.tsx` |
| Row styles | `app/globals.css` (`.sit-row*`, `.sit-dot*`) |
| Copy | `messages/{en,zh-CN}.json` → `stats.club` |
| Loading height (211 at 390px) | `components/TabFallbacks.tsx` → `STATS_HEIGHTS.whereYouSit` |
| "turn this off" → Stats & privacy | `lib/profileView.ts`, `components/SkillsTab.tsx`, `components/ProfileTab.tsx` |
| Tests | `__tests__/components/WhereYouSitCard.test.tsx`, `__tests__/profile-view.test.ts` |
