---
name: docs-truth
description: Audit the repo's deployment and owner docs against the code and open a draft PR correcting what is stale. Use monthly, after a deployment-topology change, or whenever a doc is suspected of describing something that no longer exists. Verifies only what the repository can prove; marks portal-only claims rather than guessing.
---

# Docs truth audit

**Why this exists.** Stale documentation is the burn this repo records most
often: `docs/azure.md` named a deleted app service as the deploy target for six
weeks, `CLAUDE.md` listed 8 containers when there were 23, `docs/OWNER-KB.md`
told the owner to roll back with a workflow that no longer existed. The
`docs-canary` test catches a path that stops resolving; it cannot catch a
sentence that stops being true. This skill is the sentence-level check, done by
reading the code, and its output is a draft PR the owner reads.

## Scope

Audit these, in this order:

1. `docs/azure.md` — all sections except §9 "Observed in the portal", which
   records what a person saw and is never edited by this audit.
2. `docs/OWNER-KB.md` — every section.
3. `CLAUDE.md` — the "Deployment", "Feature Flags" and "Testing" sections only.
   The rest is architecture prose maintained with the code it describes.
4. `.claude/skills/deploy-promotion/SKILL.md` — the rollback and verification
   sections.

## What counts as verifiable

Only a claim the repository can settle. For each kind, where to look:

| Claim kind | Verify against |
|---|---|
| A file, script or workflow exists / is named | the tree (`ls`, `Glob`) |
| What a workflow does (steps, env, target app, auth method) | `.github/workflows/*.yml` |
| An env var is required / optional / build-time | `.env.local.example`, `lib/flags.ts`, the workflow's `env:` |
| Container names and partition keys | `lib/containers.ts` |
| Model ids, token limits, rate limits | `lib/aiModels.ts`, `lib/claudeLimits.ts`, the route's `checkRateLimit` call |
| Which routes call an external SDK | `grep` for the import |
| A route's auth and body shape | the route file's handler |
| A count (tests, containers, items, hooks) | count it |
| A routine exists and is enabled | `list_triggers` (claude-code-remote), by id |
| A feature flag's state in production | `deploy-next.yml` `env:` |

**Not verifiable from the repo, so mark and leave:** anything that lives only in
the Azure portal — tier, region, resource group, instance count, firewall mode,
backup mode, key rotation, certificate expiry, alert rules, the real partition
key of the six hand-made containers. Mark the row with a dagger (†) and a
"last observed" date if one is known. Never replace a portal claim with a guess.

## Procedure

1. Start from `main`. Branch `docs/truth-audit-YYYY-MM`.
2. Read each file in scope once, end to end. For every sentence that makes a
   checkable claim, check it. Keep a list: *said X; code says Y; evidence
   `file:line`*.
3. Correct in place. Keep the author's structure and voice; change the fact,
   not the paragraph. Where a claim was true and is now false because something
   was deleted or renamed, say what replaced it, not only that it is gone.
4. Where a date appears ("as of 2026-09-28"), update the date only if you
   re-verified the claim it stamps.
5. Add or refresh a "Last verified against the repo: YYYY-MM-DD" line at the
   top of `docs/azure.md` and `docs/OWNER-KB.md`.
6. Run `npm test` and `npm run lint`. The `docs-canary` and `hooks/scripts`
   tests are the ones most likely to care. The repo baseline is 0 lint errors.
7. If the list of corrections is empty, open no PR. Say so and stop.
8. Otherwise commit with a message that is the list, push, and open a **draft**
   PR titled `docs: truth audit YYYY-MM`. The body is the list, one line per
   correction, with `file:line` evidence. Never merge; never mark ready.

## What not to do

- Do not edit §9 of `docs/azure.md`, `ROADMAP.md`, `CHANGELOG.md`, or any
  `docs/plans/*.md`. Plans record intent and decisions; a stale plan is a
  record, and the `Review on:` mechanism owns it.
- Do not widen into code changes. If a doc is right and the code is wrong (a
  comment contradicts a rule the doc states), note it in the PR body as a
  finding for the owner and leave the code alone.
- Do not delete a claim you cannot verify. Mark it.
- Do not re-order sections or rewrite prose that is merely dated in style.
