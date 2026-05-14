---
enabled: true
workflow_path: .github/workflows/deploy-next.yml
---

# Flag-Deploy Sync Hook

Per-project settings for `scripts/check-flag-sync.mjs`, fired as a PostToolUse
hook on every Edit/Write/MultiEdit.

## Fields

- `enabled` — set to `false` to temporarily silence the hook without editing
  `.claude/settings.json`. Use during noisy refactors where you know flags
  aren't ready yet.
- `workflow_path` — the deploy workflow checked for flag presence. Defaults
  to `.github/workflows/deploy-next.yml`. Don't change unless the deploy
  pipeline structure moves.

## Why this exists

`NEXT_PUBLIC_*` env vars are baked at build time per CLAUDE.md, so a flag
registered in TypeScript but absent from the deploy workflow stays silently
off on bpm-next forever. The hook catches the drift on the same commit that
introduces it.
