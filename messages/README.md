# Translation files

- `en.json` — source of truth. All keys must exist here.
- `zh-CN.json` — Simplified Chinese. Missing keys fall back to English at runtime.

## Canary translation status (C1)

The 10 keys in this directory are **first-pass Chinese translations** generated during C1 to prove the pipeline. They must be reviewed by a native Mandarin speaker before C2 content sweep ships.

Review checklist:
- Register (formal vs. conversational) appropriate for a community badminton group
- Measure words / numeric formatting match local convention
- Punctuation follows zh-CN norms (full-width `：` instead of `:`, etc.)
