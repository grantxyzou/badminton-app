# Contributing

> **AI coding assistants**: read [`CLAUDE.md`](CLAUDE.md) first. It contains architecture, conventions, security rules, and gotchas that this file intentionally doesn't duplicate.

## Quick start

```bash
npm install
cp .env.local.example .env.local  # if it exists, otherwise create manually
npm run dev
# → http://localhost:3000/bpm
```

Omit `COSMOS_CONNECTION_STRING` to use the in-memory mock store — all routes work offline. See [`README.md`](README.md#environment-variables) for the full env var list.

## Before you push

```bash
npm test             # 251 tests, 30 suites — must pass before PR
npm run build        # verify production build + TypeScript
npm run lint         # eslint
```

Tests gate CI on both deployment workflows. A failing `npm test` means `bpm-next` won't even attempt to deploy.

## Branching + deployment model

**Push goes to next. Tag goes to stable.**

- Commit to a feature branch, open a PR into `main`
- Once merged, `bpm-next` auto-deploys in ~3 min via `.github/workflows/deploy-next.yml`
- `bpm-stable` stays frozen at the last `bpm-stable-v*` tag — only updates on explicit tag + manual workflow dispatch

Full runbook: [`docs/deployment-model.md`](docs/deployment-model.md).

## Conventions

- **Commit format**: Conventional Commits (`feat(scope): summary`, `fix(scope): summary`, `docs: summary`). Skim `git log --oneline -20` for the house style.
- **Code conventions**: captured in [`CLAUDE.md`](CLAUDE.md). Coding-assistant-focused but useful for humans too.
- **Design conventions**: [`DESIGN.md`](DESIGN.md) + [`docs/design-system/`](docs/design-system/).
- **Feature flags**: every flag in `lib/flags.ts` must have a `plannedRemoval` date. Two weeks after a stage promotes, delete the flag and its `off` branch. No long-lived flags.
- **Schema changes**: additive-only while `bpm-next` and `bpm-stable` share the Cosmos DB. Never remove or rename a field until both deployments have migrated past needing it.

## Opening a PR

1. Push the branch with an upstream: `git push -u origin <branch>`
2. `gh pr create --base main --head <branch>` — include a test plan as a checklist
3. The preview environment `bpm-next` will redeploy when the PR merges, not when it's opened

For friend-group-visible changes, coordinate the follow-up tag promotion:
1. Update `CHANGELOG.md` — move items from "Unreleased" into a dated section
2. Tag: `git tag -a bpm-stable-vX.Y -m "vX.Y — summary"`
3. Push tag: `git push origin bpm-stable-vX.Y`
4. GitHub Actions → `deploy-stable.yml` → Run workflow → enter the tag

## Further reading

- [`README.md`](README.md) — architecture overview, features, API routes
- [`CLAUDE.md`](CLAUDE.md) — instructions for AI coding assistants (also useful for humans)
- [`DESIGN.md`](DESIGN.md) — design principles
- [`ROADMAP.md`](ROADMAP.md) — what's shipped, staged, deferred
- [`docs/azure.md`](docs/azure.md) — infrastructure details
- [`docs/deployment-model.md`](docs/deployment-model.md) — two-deployment promotion runbook
- [`docs/design-system/`](docs/design-system/) — canonical bundle (tokens, specimens, UI-kit refs)
- [`CHANGELOG.md`](CHANGELOG.md) — release history
