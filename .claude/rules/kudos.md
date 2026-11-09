---
paths:
  - "lib/kudos*.ts"
  - "app/api/kudos/**"
  - "components/stats/*Kudos*.tsx"
  - "components/home/WhoElseIsIn.tsx"
  - "__tests__/kudos*.test.ts"
  - "__tests__/components/*Kudos*.test.tsx"
---

# Kudos

<!-- Moved word for word from the root CLAUDE.md on 2026-11-09 (step 2 of the trim), to keep the always-loaded file short. -->

Positive-only peer recognition (unconditional; `NEXT_PUBLIC_FLAG_KUDOS` retired 2026-09-10, #352). Two entry points, one sheet: `GiveKudosCard` on Stats → **Play**, and a per-name button on each row of Home's sign-up roster (the opened `WhoElseIsIn` list). Both open `GiveKudosSheet`; passing `recipient` fixes the person and hides the picker.

- **Eligibility is anyone you shared a roster with in the last `CO_PLAY_LOOKBACK_SESSIONS` (8) sessions**, not the active one. `lib/ kudosEligibility.ts` is the SINGLE owner, shared by the POST that enforces it and `GET /api/kudos/eligible` that lists it — when those were separate, the card built its list one way and the server refused it another. Rebuilt from real feedback: the old rule was "both on the ACTIVE roster", and the owner advances the session minutes after play, so the people you had just played with stopped being eligible almost immediately. Reported as "kudos goes away with the session too fast"; it was actually instantly.
- **`recentSessionIds` puts the ACTIVE id FIRST.** That is the only way the legacy `'current-session'` id is reachable — it does not match `session-YYYY-MM-DD`, so a prefix filter alone silently excludes the session most people just played. Its `sessions` query is bounded with `ORDER BY ... LIMIT` in SQL, not only by the JS slice: that container is partitioned by `/sessionId`, so an unbounded `SELECT` is a cross-partition scan on every card mount and every send. **The per-session roster reads it leads to run CONCURRENTLY** (2026-10-21), one `@sessionId` query per session merged in session order — never one `ARRAY_CONTAINS` query, which the mock would answer with every row — and the POST path proves by every roster first, reaching for the game logs (again all at once) only when no roster did.
- **`GiveKudosCard` must never return `null`.** It renders loading / expired / error / honest-empty / ready, always. Returning null when there was nobody to thank is what made the feature unfindable — a player asked "how do I give kudos to other people?" and the owner's own answer was wrong, because nobody could see the rule. **A 401 is NOT "signed out"** (that returns before the fetch): it can only mean a `member_session` expired past its 30-day TTL while `badminton_identity` persisted, so it renders a re-auth line, never the empty state.
- **`raterName` is a DOCUMENTED EXCEPTION to the strip-canary rule, and only alongside a note.** `raterMemberId` remains strip-only. A bare tag stays anonymous; a NOTE is signed, because "someone noticed" is worth much less than "Lin noticed" and praise nobody can ask about is not much of a gift. `visibleNotes()` is the only path that carries it and drops every kudos without a note, so an unsigned tag can never become attributable by sitting next to one that is. The `KudosNote` type has no `raterMemberId` field at all — it is structurally impossible to leak one through it.
- **"Your kudos" is a page in Play** (`KudosAllPage`, opened from "All your kudos" on `GiveKudosCard`, shown in place of the register's cards like Your fit). It reads the same `GET /api/kudos`, whose additive `months` field carries a bare tag only as a count in its month — never a date, an order or a name (`kudosByMonth` in `lib/kudos.ts`).
- **Dedupe is per ISO WEEK** (`isoWeekKey`), not per session. Per-session stopped meaning anything once eligibility left the session behind.
