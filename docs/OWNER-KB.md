# Owner Knowledge Base — Grant

Your personal operating manual. Not agent instructions (that's `CLAUDE.md`),
not strategy (that's `ROADMAP.md`). This is *your* reference — maintain it.

---

## The ecosystem (3 repos)

`aigrant` (portfolio) → `bpm-marketing` (marketing site + **public design-system
showcase**) → `badminton-app` (this product). Flow: portfolio → marketing → app.

- Marketing/landing/branding work → **bpm-marketing**, never inside the app
  (Non-Goal per ROADMAP lock).
- In-app `docs/design-system/` is the implementation truth; bpm-marketing
  *presents* it beautifully. Keep them in sync when tokens change.

## Mental model (read the lock)

`ROADMAP.md` top has the 🔒 LOCKED block — North Star, Non-Goals, the gate,
WIP cap, kill-criteria, 30-day checkpoint. **Editing it = deliberate
strategy change.** Critical path: merge #95 → Slice-0 → prove engagement →
game/win-loss data → fan out tracks 1–3 → track 4 (Reach) last.

## What's automated vs what you own

**Automated (don't redo):**
- 30-day drift review — routine `trig_01AaCdW8M3FZ5ntXrLmw12CZ`, 1st of month.
- Flag-deploy sync check, soak tracker, bpm-confirm gate (`.claude/` hooks).
- bpm-next auto-deploys every push to `main`.

**You own (only you can do):**
1. **Progression leveling matrix content** — the ACE skills rubric/levels.
   Agent can't author the real content; hand it the rubric when ready.
2. **Deciding** beta(vnext) vs regular(stable) friend distribution + which
   URL each gets.
3. **Legal/privacy calls** — PIPEDA consent model, affiliate disclosure
   (see `feedback_legal_compliance`).
4. **Secrets rotation timing** — when admins can be logged out.
5. **Monetization intent** (value-hub Decision D) — affiliate? which retailers?

## Equipment catalog — ways to collect it (task noted, your call)

Ranked, lowest-legal-risk first:
1. **Hand-curated seed** (started: `scripts/data/equipment-catalog.json`,
   ~15 rackets). Expand: top ~10 per brand × Yonex/Victor/Li-Ning, strings,
   shoes. Highest quality, slow. Use official manufacturer spec pages.
2. **Crowdsource via the app** — Slice-0's "what's your racket?" free-text
   "Other" → admin promotes to catalog. *This is already the designed
   mechanism.* Friends seed it for you, realistically biased to what they
   actually use.
3. **Manufacturer spec sheets** — Yonex/Victor/Li-Ning official catalogs;
   authoritative, manual entry.
4. ❌ **Scraping retailer sites** — ToS/legal risk; skip (follow-the-law).
5. **Affiliate product feeds** (later, Decision D) — some retailers offer
   structured feeds; revisit only if affiliate is chosen.

**Recommendation:** 1 + 2 together. Curate a solid base, let friends grow it.

## Info the agent needs from you (outside VS Code)

Things not derivable from the codebase — provide when relevant:
- Real ACE progression rubric (levels + criteria).
- Friend-group size + beta/regular split (kill-criteria %s assume a count).
- Which brands/models your friends actually use (realistic catalog seed).
- Affiliate/monetization decision + target retailers.
- PIPEDA/consent posture: OK to store game + gear + AI history? consent UX?
- Secrets-rotation window (when's a safe time to log admins out).
- bpm-marketing: branding, what the intro should say, design-system scope.

## Parked — next session first task

✅ **Org pass complete (2026-05-17):** #95 + #96 merged; Value-Hub milestone (#8)
+ Slice-0/Track epics (#101–105) created; in-app-feedback (#100) + flag-sync
guard (#106) filed; #59 closed; drift triage notes on #76–78.

**Next:** Smoke stable v1.4 (Command Center live since re-deploy `de46b41`) →
Value-Hub Slice-0 build kickoff.

## Key commands

| Need | Command |
|---|---|
| See repo topology | `git log --graph --oneline --decorate --all -20` |
| Roll back stable v1.4 | `gh workflow run deploy-stable.yml -f tag=bpm-stable-v1.3.1` (`bpm confirm`) |
| Promote to stable | tag the *specific* commit → `gh workflow run deploy-stable.yml -f tag=...` (never blind-tag `main`) |
| Local dev | `npm run dev` → localhost:3000/bpm |
| Tests | `npm test -- --run` |
| Drift routine | https://claude.ai/code/routines/trig_01AaCdW8M3FZ5ntXrLmw12CZ |

## Doc map

`ROADMAP.md` = where we're going (+ the lock) · `CHANGELOG.md` = what
shipped · `CLAUDE.md` = how the code works/agent rules ·
`docs/plans/*` = active specs · GitHub milestones = live tasks ·
this file = your operating manual.
