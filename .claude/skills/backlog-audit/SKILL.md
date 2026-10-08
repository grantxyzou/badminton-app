---
name: backlog-audit
description: Re-verify the BPM Backlog artifact (roadmap, rank order, every tracked idea and task) against the code, GitHub and the plan docs, update the page in place, and notify the owner only about what changed. Use on the scheduled "review the BPM repo document ideas and tasks" routine, or when asked to review, audit or refresh the backlog.
disable-model-invocation: false
---

# Backlog audit

There is ONE tracker: the **BPM Backlog** artifact,
https://claude.ai/artifact/7oJobvyJSTew4jbuMCu415. Never create a second one.
It holds the phased roadmap, the ranked order (27 rows, tiers 0–4), the full
backlog (~185 items in six sections) and the links to docs, design system,
templates and assets. Each backlog item carries a `v` note — the result of
its last check, dated — and the page's Mark done / Drop / Reopen buttons
write to the artifact's shared `marks` collection (`ArtifactData`, collection
`marks`, doc id = the item id).

The audit took 143 items on 2026-10-07 and found 11 done, 15 with wrong
facts and 23 unverifiable from the repo. A run is worth doing only if it
re-checks what it can and stays silent when nothing moved.

## Procedure

1. **Read the current page** (`Artifact` → `read` with the URL) — it may have
   been edited since the last run. Extract the items:
   `node .claude/skills/backlog-audit/extract.mjs <saved.html> items.json`.
   Also `ArtifactData list marks` so an item the owner marked done or dropped
   is skipped, not re-opened by the audit.

2. **Find what moved since the stamp.** The header line names the last PR
   checked. `git fetch origin main && git log --oneline <that-sha>..origin/main`
   is the first evidence: a merged PR usually finishes an item outright.

3. **Re-check the checkable items.** Split the open, unmarked items by
   section and hand each batch to an `Explore` agent (read-only) with this
   contract: for each `{id, t, r, v}` return
   `{id, verdict: open|done|stale|cannot, note}`; the note starts with the
   date, is ≤220 chars, has no double quotes, and names its evidence (a
   `path:line`, a count, a PR number from `git log`). The previous `v` note
   says exactly what to re-run. Sections and what verifies them:
   - **Calendar** — `grep -rn "Review on" docs/plans/*.md` for dates;
     `lib/flags.ts` for flags (done when the flag is gone, not when the date
     passes).
   - **Tidy up** — GitHub: `list_issues`, `pull_request_read` (mergeable
     state) and `actions_list` on `pr-ci.yml` for CI by head sha.
   - **Ready to build** — the code claim in the note.
   - **Needs you / Parked** — mostly `cannot`; still check whether a plan's
     Decisions section, a flag in `deploy-next.yml`, or a merged PR settled
     it.
   Things only the repo cannot answer (Azure, store consoles, production
   data, a phone, a member's opinion) stay `cannot` — say what would verify.

4. **Apply and publish.**
   `node .claude/skills/backlog-audit/apply.mjs saved.html results.json next.html "Audited <date> · … · code through PR #<n>"`
   prints `{done, stale, reopened, unknown}`. Refresh the **Start here** list
   by hand from those, then `Artifact` → `publish` to the same URL. Omit
   `capabilities` so the `db` declaration carries forward.

5. **Notify only on change.** Send a `PushNotification` when the run found
   an item newly done, an item whose facts changed, a plan review newly
   overdue, a flag past its date, a red CI on an open PR, or a new open PR or
   issue. Lead with the one thing to act on. If nothing moved, send nothing.

6. **New items.** Anything new found in a plan, an issue or a PR goes INTO
   the page's item array (same shape) and into its umbrella issue
   (#518–#537), never only into a doc.

## Don'ts

- Don't rewrite notes that still hold; only a re-check changes a note.
- Don't mark an item done because its date passed. Done means the work is in
  the tree, the issue is closed, or the flag is gone.
- Don't overwrite an owner mark. A `marks` doc wins over the audit.
- Don't run `npm test` as the check for a code claim; grep is enough and the
  cloud clone usually has no `node_modules`.
