---
paths:
  - "components/HomeTab.tsx"
  - "components/home/**"
  - "components/UnpaidSessionsCard.tsx"
  - "components/stringing/StringingSteps.tsx"
  - "__tests__/components/HomeTab*.test.tsx"
---

# Home tab layout

<!-- Moved word for word from the root CLAUDE.md "Gotchas" on 2026-11-09, to keep the always-loaded file short. -->

- **HomeTab is TWO GROUPS, not a card list** (design "Home Hierarchy", 2026-08-27). `.bpm-home-stack` holds `.bpm-home-group` sections at `--home-group-gap` (28px); cards inside a group sit at `--home-stack-gap` (10px). Group 1 = *this week's session* (tiles → announcement → sign-up); group 2 = *your account* (balance → stringing → PrevPaymentReminder). Proximity is what says "these belong together" without giving every card a heading; five evenly-spaced cards read as five unrelated errands. The balance briefly sat ABOVE sign-up earlier the same day — the hierarchy pass moved it back, because shrinking it to a one-line row carrying its own figure removed the reason it needed the top slot.
- **Accent is currency on Home.** Green marks exactly three things: the primary button, the one link, the active tab. Tile labels, "Sign up", "Your balance" and "Stringing service" are all neutral (`.section-label-muted`, `--text-secondary`) — spending accent on labels that never change left nothing to mark the one thing worth tapping. Red likewise means failure only: the sign-up close date is `--text-muted`, escalating to `--sev-warn` inside 24 hours, never `text-red-400`.
- **`.btn-primary` vs `.cc-btn-primary` on Home**: the sign-up submit uses **`.btn-primary`** (filled gradient, white text). `.cc-btn-primary` is the tinted *admin* action (18% green fill, green text) and had been wearing the app's most prominent CTA. The stringing CTA is a `.bpm-row-link` — label + arrow, no fill — so it cannot outweigh the week's actual decision from the group below it.
- **The stringing rail waits for a job.** `StringingSteps` renders only when there is an active job; four steps and ~90px describing a process nobody had started was an explanation charged against a card with nothing to report.
- **`UnpaidSessionsCard` is Home-only** (since 2026-08-27). The Profile copy was removed rather than kept in sync — two cards reading the same endpoint is two chances to disagree about money. It is now a receipt: session lines, stringing lines, one total. Group headings ("Badminton" / "Stringing") appear only when both kinds exist. **Its "See details" opens Profile → Account balance** (`components/profile/AccountBalancePage.tsx`, 2026-11-09, Grant: "this is the detailed view"), which reads the SAME answer through `useBalance` (`sharedFetch(unpaidPath(name))`) rather than a second endpoint, so the two still cannot disagree. **Beside it, "Have a code?"** (2026-11-12, spec Q2) opens Profile → Credit the same way (`requestProfileView('gift-cards')`), only while `NEXT_PUBLIC_FLAG_STORE_CREDIT` is on; there is still one redeem page.
