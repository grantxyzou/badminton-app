---
enabled: true
items:
  - release: v1.4
    pushed: 2026-05-13
    soak_until: 2026-05-20
    notes: Command Center + unified Home auth + Send-the-bill workflow
  - release: v1.5/A
    pushed: 2026-05-13
    soak_until: 2026-05-20
    notes: writtenOff PATCH + Cover ActionRow on PaymentsCard
---

# Currently Soaking on bpm-next

This file lists releases pushed to `main` (auto-deployed to bpm-next) that
are still in their smoke window before being eligible for promotion to
`bpm-stable`.

A SessionStart hook reads this file and reminds you what's awaiting eyes.

## Schema

- `enabled` — flip to `false` to silence the reminder without deleting items
- `items` — list of soak entries:
  - `release` — version label (e.g., `v1.4`, `v1.5/A`)
  - `pushed` — date pushed to main (YYYY-MM-DD)
  - `soak_until` — earliest promotion-eligible date (YYYY-MM-DD)
  - `notes` — what's in the release (one line)

## Workflow

1. On every push of a release-worthy bundle, add an entry here with a 5-7
   day soak window
2. SessionStart shows you what's still soaking and the days remaining
3. When `soak_until` passes and no issues surfaced, remove the entry and
   tag for stable
4. If a fix is required during soak, push it to main (which extends the
   real soak naturally) and bump `pushed` + `soak_until` in this file
