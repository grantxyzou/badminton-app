---
name: backlog-audit
description: Re-verify the BPM Backlog artifact (roadmap, rank order, every tracked idea and task) against the code, GitHub and the plan docs, update the page in place, and notify the owner only about what changed. Use on the scheduled "review the BPM repo document ideas and tasks" routine, or when asked to review, audit or refresh the backlog.
disable-model-invocation: false
---

# Backlog audit

There is ONE tracker: the **BPM Backlog** artifact,
https://claude.ai/artifact/7oJobvyJSTew4jbuMCu415. Never create a second one.
It holds the roadmap in Asana's format (since 2026-11-23), the full backlog
(~370 items) and the links to docs, design system, templates and assets.
Each backlog item carries a `v` note — the result of its last check, dated —
and the page's Mark done / Drop / Reopen buttons write to the artifact's
shared `marks` collection (`ArtifactData`, collection `marks`, doc id = the
item id).

The roadmap is five constants in the page's script, rendered by the page:

- `GOAL` — the one goal, its status (`on` | `risk` | `off`) and key results.
- `STATUS` — the dated status update: status, one-line summary, `did`
  (what shipped), `block` (blockers), `next` (next steps).
- `MILESTONES` — `M1`..`M5`, each `{id, t, due, st, x}` (`x` = done when).
- `TL` — the timeline: phase bars and its date range.
- `SECS` — sections Now / Next / Later / Parked, each holding tasks
  `{n, o, pr, st, e, due, m, dep, note, iss, d}` in global rank order:
  `n` name (starts with a verb), `o` owner (Grant | Claude), `pr` priority
  (High | Medium | Low), `st` status (`none` | `prog` | `on` | `risk` |
  `off` | `done`), `e` effort (S | M | L), `m` milestone id, `dep` what it
  waits on, `iss` / `d` issue, PR and doc links.

The page works out "today" from the viewer's clock in Vancouver time, so
overdue marks never wait on a run; a task past its `due` shows Off track on
its own. Never hard-code `TODAY` again.

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
   by hand from those. Then update the roadmap constants, by hand, only
   where the evidence moved:
   - **Tasks:** a task whose PR merged, flag is gone or issue closed gets
     `st:"done"`; one with an open PR on it gets `st:"prog"`. A finished task
     stays one run as done, then leaves `SECS`. A new item worth a rank goes
     into the right section at the right rank, with every field filled.
   - **Milestones:** re-rate each from its tasks: `done` when its "done
     when" test holds, `off` when a High task under it is past due, `risk`
     when one is due within 7 days and not started, otherwise `on`.
   - **Goal:** the worst status among the key-result milestones (M2, M3).
   - **Status update:** rewrite `STATUS` (date, summary, did, block, next)
     only when a task, milestone or the goal changed. Otherwise leave it.
   Then `Artifact` → `publish` to the same URL. Omit `capabilities` so the
   `db` and `downloads` declaration carries forward. When the last save came
   from another session, the first publish is refused once and hands back
   the live version: check that its diff holds only your own edits (merge
   anything else in), then publish the same file again.

5. **Mirror the roadmap to Asana, when Asana is reachable.** The page stays
   the source of truth; Asana is a copy for working from day to day. Look for
   the claude.ai **Asana** connector's tools (`ToolSearch` for "asana").
   None loaded, or every call refused: skip this step silently. That is
   normal for a cloud run and is never worth a notification.
   - **Find or create the project** named **BPM Roadmap** in the one
     workspace. If none exists, create it with sections Milestones, Now,
     Next, Later, Parked, and the project description "Mirror of
     https://claude.ai/artifact/7oJobvyJSTew4jbuMCu415; the page is the
     source of truth."
   - **Match tasks by name** against `SECS` and `MILESTONES`. Never create a
     second task with the same name. Each task gets its section, its `due`,
     and notes holding the task's `note`, `dep`, its links, then one line
     `Owner · Priority · Status · Effort · Milestone · Rank`. Set custom
     fields of those names instead where the project has them. Assign
     Owner = Grant tasks to the connector's signed-in user, leave Claude
     tasks unassigned, and make the five milestone rows milestones where the
     connector allows.
   - **Done:** a task the page marks `done` is completed in Asana. A task
     that left `SECS` is completed, never deleted. A task completed in Asana
     but still open on the page is reported back, not reopened: the
     person may have finished something the repo cannot see, so it goes in
     the notification as "done in Asana, not in the repo: mark it on the
     page?".
   - **Status update:** when this run rewrote `STATUS`, post it as the
     project's status update (green `on`, yellow `risk`, red `off`), titled
     with its status and date. Otherwise post nothing.
   - Write only to the BPM Roadmap project. If a write fails, keep going and
     put one line about it in the run's summary; never retry in a loop.

6. **Notify only on change.** Send a `PushNotification` when the run found
   an item or roadmap task newly done, an item whose facts changed, a
   milestone or the goal changing status, a plan review newly overdue, a
   flag past its date, a red CI on an open PR, or a new open PR or issue.
   Lead with the one thing to act on. If nothing moved, send nothing.

7. **New items.** Anything new found in a plan, an issue or a PR goes INTO
   the page's item array (same shape) and into its umbrella issue
   (#518–#537), never only into a doc.

## Don'ts

- Don't rewrite notes that still hold; only a re-check changes a note.
- Don't hard-code a date into the page's script; it reads the clock.
- Don't mark an item done because its date passed. Done means the work is in
  the tree, the issue is closed, or the flag is gone.
- Don't overwrite an owner mark. A `marks` doc wins over the audit.
- Don't let Asana decide anything on the page: it mirrors the page, and
  the page changes only on evidence from the code, GitHub, a plan or a mark.
- Don't run `npm test` as the check for a code claim; grep is enough and the
  cloud clone usually has no `node_modules`.
