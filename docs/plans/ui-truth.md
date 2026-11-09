# UI truth — a weekly, propose-only UI review

**Track:** none, and deliberately so: it guards already-shipped work (the design system, `.claude/rules/design-system.md`, and the remediation that tokenised it, `docs/plans/design-audit-remediation.md`) rather than starting anything a member sees.
**Status:** in-flight (PR #816; written after the first commit, on review of that PR)
**Review on:** 2026-12-07 — after four weekly runs, what share of `ui-proposal` issues did Grant label `ui-approved`, and did the approved draft PRs merge? Under one in three, or approvals left unmerged, means retire the routine (draft criterion, Grant to confirm).

## Problem

Two kinds of drift, and nothing that looks for either between changes:

- **The UI drifts from the rules**: a screen breaks something
  `.claude/rules/design-system.md`, `DESIGN.md` or `CLAUDE.md` says, and the
  suite cannot see it (jsdom applies no stylesheet).
- **The rules drift from the UI**: a pattern used across the app is written
  down nowhere an AI reads, so the next change reinvents it slightly
  differently.

Grant's words for the general worry, on 2026-11-09 (about the repo, not the UI
alone): "keeping the repo not always changing and getting wrong and more
wrong". The request for this routine itself is not recorded in his words.

## Kill criterion

Draft, for Grant to confirm or replace: the routine earns its weekly run only
if Grant acts on what it files. After four runs (Review on, above), fewer than
one in three proposals approved, or approved draft PRs left unmerged, means
the findings are noise or not worth his time — retire the routine and keep
the pattern miner as a manual tool.

## Non-goals

- Changing UI code or docs without `ui-approved`. The skill proposes; Grant decides.
- Improving the design. A rule it thinks is wrong becomes a `UI rule: …` proposal.
- Screenshots of production. Mock store only; the images are public for good.

## Decisions

- **Propose, never edit** (PR #816): every finding is ONE issue; only a
  `ui-approved` label turns it into a draft PR. The alternative, auto-fixing
  drift, would be the very "repo always changing" the Problem names.
- **Images on an orphan branch** (`ui-truth-shots`): the issue shows a
  wrong-vs-right picture Grant can judge from his phone. The repo is public,
  so the branch is public and permanent — hence the mock-store-only rule.
- **A run does not rebuild an approval** (review of #816, finding 1): an
  issue whose `ui-truth/<n>-*` branch or `Closes #<n>` PR exists is skipped,
  because the issue stays open until the PR merges.

## Shape

| Piece | File |
|---|---|
| The routine | `.claude/skills/ui-truth/SKILL.md` |
| Patterns no doc names | `scripts/ui-patterns.mjs` (tested in `__tests__/ui-patterns.test.ts`) |
| Wrong-vs-right image | `scripts/ui-truth-compare.mjs` |
| Hosting the image | `scripts/ui-truth-publish.sh` → branch `ui-truth-shots` |
