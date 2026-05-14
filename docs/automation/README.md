# Per-Project Automation Settings

This project uses the [plugin-settings pattern](https://docs.claude.com/en/docs/claude-code/plugins-marketplaces#plugin-settings):
hooks and scripts read configuration from `.claude/<name>.local.md` files
containing YAML frontmatter + markdown body.

The `.local.md` files are **gitignored** (per-machine state). Templates live
here. Copy each template to `.claude/` and customize.

## Files

| Template | Copy to | Read by |
|----------|---------|---------|
| `flag-sync.local.md` | `.claude/flag-sync.local.md` | `scripts/check-flag-sync.mjs` (PostToolUse hook) |
| `soak.local.md` | `.claude/soak.local.md` | `.claude/hooks/session-start.sh` |
| `bpm-confirm.local.md` | `.claude/bpm-confirm.local.md` | `.claude/hooks/session-start.sh` |

## Quickstart

```bash
cp docs/automation/flag-sync.local.md .claude/flag-sync.local.md
cp docs/automation/soak.local.md .claude/soak.local.md
cp docs/automation/bpm-confirm.local.md .claude/bpm-confirm.local.md
```

Then restart Claude Code so hooks pick up the new state.

## Why this pattern

- **Per-machine state, shared schema** — each contributor's `.local.md` reflects
  their own working context (currently soaking what, currently confirmed
  what) without conflicting in git
- **Quick toggles** — `enabled: false` silences a hook without editing
  `.claude/settings.json` (which requires a restart)
- **Documented intent** — the markdown body of each file documents WHY the
  hook exists, not just WHAT it does, so future-you doesn't have to
  reconstruct the reasoning

## Adding a new hook

1. Write the script (Node, Bash, or anything else) — read its config from
   `.claude/<name>.local.md` if it has tunable behavior
2. Add a template `<name>.local.md` here
3. Register the hook in `.claude/settings.json`
4. Document it in this README

See `.claude/hooks/session-start.sh` for a representative example.
