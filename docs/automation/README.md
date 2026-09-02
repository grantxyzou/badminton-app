# Per-Project Automation Settings

This project uses the [plugin-settings pattern](https://docs.claude.com/en/docs/claude-code/plugins-marketplaces#plugin-settings):
hooks and scripts read configuration from `.claude/<name>.local.md` files
containing YAML frontmatter + markdown body.

The `.local.md` files are **gitignored** (per-machine state). Templates live
here. Copy each template to `.claude/` and customize.

## Files

| Template | Copy to | Read by |
|----------|---------|---------|
| `flag-sync.local.md` | `.claude/flag-sync.local.md` | `scripts/check-flag-sync.mjs` (PostToolUse hook, and once at SessionStart via `.claude/hooks/session-start.sh`) |

Two templates used to live here — `soak.local.md` ("what's soaking on
bpm-next") and `bpm-confirm.local.md` (the high-risk-ops confirmation list).
Both concepts were retired in August 2026 (one deployment since 2026-08-25; the
confirm gate removed 2026-08-21) and were deleted rather than kept as
`enabled: false` stubs, because the SessionStart hook had gone on announcing an
expired soak for ~68 days after the thing it tracked stopped existing. A
reminder for a retired process trains you to ignore reminders.

## Quickstart

```bash
cp docs/automation/flag-sync.local.md .claude/flag-sync.local.md
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
