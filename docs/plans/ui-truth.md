# UI truth — a weekly, propose-only UI review

**Track:** none, and deliberately so: it guards already-shipped work (the design system, `.claude/rules/design-system.md`, and the remediation that tokenised it, `docs/plans/design-audit-remediation.md`) rather than starting anything a member sees.
**Status:** in-flight (PR #816; written after the first commit, on review of that PR)
**Review on:** 2026-12-07 — of the four weekly runs, how many filed a fix Grant approved that merged and stayed (no revert)? Fewer than two such runs retires the routine; any ui-truth PR that broke production stopped it already (Kill criterion).

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

Grant, 2026-11-09: "make sure its not burning token without getting correct
fixes and breaking prod prematurely". Two tests, from those two worries:

- **Breaking production — stop at once, don't wait for the review.** If a
  merged `ui-truth/*` PR is reverted, or a production problem is traced to
  one, pause the weekly run and tell Grant what got through. The routine
  cannot ship on its own (it opens DRAFT PRs only; Grant merges; `verify`
  must pass; deploys are batched three times a day), so one getting through
  means a guard failed, and that is the thing to look at, not the next run.
- **Burning tokens — judged at the review.** A *good run* files at least one
  proposal that Grant approves and whose PR merges and stays. A run that
  files nothing, or only proposals that are declined or turn out wrong when
  checked, cost tokens for no fix. Fewer than two good runs out of the first
  four: retire the scheduled routine and keep `scripts/ui-patterns.mjs` as a
  tool run by hand.

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
