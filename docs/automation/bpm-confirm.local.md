---
enabled: true
ops:
  - "git push --force"
  - "git push origin --tags"
  - "git push origin bpm-stable-*"
  - "gh workflow run deploy-stable.yml"
  - "gh pr merge"
  - "git branch -D"
  - "git reset --hard"
---

# High-Risk Ops — `bpm confirm` Gate

Operations that require explicit user authorization via the phrase
**`bpm confirm`** before execution. Surfaced to Claude at SessionStart via
the session-start hook.

## Why this file exists

Memory entry [feedback_high_risk_git_confirm.md](../docs/) encodes the
"one explicit confirmation per high-risk op" rule. This file makes the
list **enumerable** rather than implicit, so:

1. The session-start hook can surface it as fresh context every session
2. New contributors can see at a glance what counts as high-risk in this repo
3. The list can evolve per project without touching memory or CLAUDE.md

## Fields

- `enabled` — flip to `false` to disable the SessionStart surface (does NOT
  disable the actual gate — that's behavioral, not enforced)
- `ops` — string patterns. Match by substring or glob (`*`). Claude reads
  this list and asks for `bpm confirm` before running any matching command.

## Workflow

1. Claude proposes an operation matching one of these patterns
2. Claude pauses and explains the intended action + risk
3. User types `bpm confirm` to authorize ONE execution
4. Claude proceeds. Future identical ops require another `bpm confirm`.
