---
name: bpm-status
description: Print current BPM deployment + workstream status — the live build, in-flight branches, open PRs, soak status, the North Star, drift-routine next run. User-invoked via /bpm-status.
disable-model-invocation: true
---

# bpm-status

Read-only "where am I" snapshot for the badminton-app (one deployment: `main` → production).
Run the commands below, then present a tight summary (no prose padding —
the user wants it scannable).

## Steps

1. **Deploy state:**
   ```bash
   gh run list --workflow=deploy-next.yml --limit 1
   echo "main: $(git rev-parse --short origin/main 2>/dev/null || git rev-parse --short main)"
   ```
   A merge is live only after the next deploy run, so report whether `main` is ahead of the last one.

2. **In-flight local branches (WIP-cap signal — >2 = converge):**
   ```bash
   git for-each-ref --format='%(refname:short)' refs/heads | grep -v '^main$'
   ```

3. **Open PRs:**
   ```bash
   gh pr list --state open --json number,title,headRefName -q '.[]|"#\(.number) \(.headRefName) — \(.title)"' 2>&1 | head -10
   ```
   (If `gh` fails with a TLS/`OSStatus -26276` error, note it's the known
   sandbox issue and retry with the sandbox disabled.)

4. **Soak status:** read `.claude/soak.local.md` if present (raw print).

5. **North Star:** print it from `ROADMAP.md`:
   ```bash
   grep -n 'North Star:' ROADMAP.md
   ```

6. **Drift routine:** remind that a monthly drift review runs as a scheduled
   routine on the 1st of the month. Its ID is deliberately NOT recorded here —
   this repo is public and a routine ID is an account-linked identifier. Run
   `/schedule` to list the maintainer's routines.

## Output format

A compact block: Deploy (last run @hash · main @hash) · Branches (n
in-flight, list) · PRs (list) · Soak (summary) · North Star · Drift (next run). Flag if >2 in-flight branches (WIP-cap breach
per the ROADMAP lock). No recommendations unless asked — this is a
status readout, not a planning session.
