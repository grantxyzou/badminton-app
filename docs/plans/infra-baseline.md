# Infrastructure baseline: observe, alert, restore

**Track:** none, and deliberately so. Nothing here adds a user-facing surface;
every item makes an already-shipped deployment observable or recoverable
against rules this repo already holds itself to ("never let a failure look like
a fact", "a recorded value nobody compares is not a check"). The precedent is
`docs/plans/ai-governance-and-docs-accuracy.md`.
**Status:** intent
**Review on:** 2026-11-07 — have the five portal pages been read into `docs/azure.md` §9, and does at least one alert rule exist on the App Service?

## Problem

In the owner's words, 2026-10-07: "Help me move from trusting to judging the
infrastructure under my app." And, on what happens today when the database
fails during a session: "you learn it from a player's message."

Nobody has reported an outage. That is worth saying plainly, because the plan
template says a problem only the owner has noticed is a weaker reason to build.
The reason this batch is worth doing anyway is structural, not an incident:

- Every protective mechanism in the repo runs at build time or test time
  (canaries, hooks, the PR gate, `scripts/smoke-prod.mjs` once after a deploy).
  Nothing watches the running app. There are zero alert rules.
- The data (who owes whom, for a club) exists in one copy. The
  `deploy-promotion` skill says "Cosmos point-in-time restore, 7-day retention";
  nothing in the repo shows the account was ever put in continuous mode or that
  a restore was ever tried. A claim is not a backup.
- Six partition keys, the Cosmos firewall mode, the backup mode, the key
  rotation history and the certificate expiry are known only from memory. The
  repo's own rule is that the portal is ground truth for them, and nobody has
  written down what it says.

## Kill criterion

This plan is three observations and two small changes, so the honest failure
conditions are about whether they get done and whether they earn their keep:

- If the five pages have not been read by the review date, the audit was the
  wrong size, not the wrong idea: cut it to the two that matter most (backup
  mode, alert count) and do those.
- If the 5xx alert fires more than twice a month on nothing a player noticed,
  the threshold is wrong; raise it rather than mute it. A muted alert is the
  failure mode this plan exists to prevent.
- If the restore drill cannot be completed in an afternoon with the
  documentation written, the runbook is not good enough to be relied on at
  7 pm on a Thursday, and the drill repeats until it is.

## Non-goals

- Managed identity for Cosmos, Key Vault references, private endpoints. Right
  changes, separate decision (module 5 and 6 of the field guide); this plan
  only records what the portal currently says about them.
- Deployment slots, Redis, a queue and worker, a second region. The capstone
  shape, not this one.
- Moving the rate limiter out of process memory. Correct only once there is a
  second instance, and there is not.
- Any change to the app's code. This is portal and documentation work.

## Decisions

- **The learning sequence lives in `docs/OWNER-KB.md`, not here.** This plan is
  the infrastructure changes a person can check in the portal; the reading
  order and the guide link are the owner's own material.
- **Observations go in `docs/azure.md` §9 under a dated heading**, not in this
  plan. A plan records intent and decisions; the Azure doc records what is
  deployed. Keeping the fact next to the claim it confirms or refutes is what
  stops the claim outliving the fact again.
- **The deploy skill's backup sentence is marked unverified rather than
  deleted** until the Backup & Restore page has been read. Deleting it would
  lose the one place the intent was ever written down.

## Shape

| Piece | Where |
|---|---|
| The five portal pages and what to read on each | `docs/azure.md` §9 (table), and the field guide's "judge's checklist" |
| Observed facts, dated | `docs/azure.md` §9, one sub-heading per look |
| Alert rule: HTTP 5xx count > 0 over 5 minutes, email to owner | Azure portal, App Service → Alerts (not in repo; record the rule name in §9) |
| Health check path | `/bpm/api/releases` — public, Cosmos-backed, answers 503 on a read failure rather than lying; set under App Service → Health check |
| Continuous backup, 7-day tier (no storage charge) | Cosmos → Backup & Restore; record the date switched in §9 |
| Restore drill | Restore to a new account, point `staging-badminton-app` at it with its own connection string, open the ledger, delete the drill account; write the steps into `docs/azure.md` as a "Restore" section |
| Rollback runbook correction | `.claude/skills/deploy-promotion/SKILL.md`, "Rolling back" |
