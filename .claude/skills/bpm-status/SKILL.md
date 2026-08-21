---
name: bpm-status
description: Print current BPM deployment + workstream status — stable vs next version, in-flight branches, open PRs, soak status, parked next task, drift-routine next run. User-invoked via /bpm-status.
disable-model-invocation: true
---

# bpm-status

Read-only "where am I" snapshot for the badminton-app dual-deploy workflow.
Run the commands below, then present a tight summary (no prose padding —
the user wants it scannable).

## Steps

1. **Deploy state:**
   ```bash
   # --sort=-v:refname, NOT `| tail -1`: a plain lexical sort ranks
   # bpm-stable-v1.10 BELOW v1.8, so the readout would silently report a
   # stale tag as current the first time a minor version reaches double
   # digits. Same version-sort footgun as blind-tagging main.
   T=$(git tag -l 'bpm-stable-*' --sort=-v:refname | head -1)
   echo "stable tag: $T"
   echo "stable tag commit: $(git rev-list -n1 "$T" 2>/dev/null | cut -c1-7)"
   echo "main (= bpm-next): $(git rev-parse --short origin/main 2>/dev/null || git rev-parse --short main)"
   ```

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

5. **Parked next task + lock:** print the `▶ NEXT SESSION` line and the
   `🔒 LOCKED` North Star from `ROADMAP.md`:
   ```bash
   grep -n '▶ NEXT SESSION\|North Star:' ROADMAP.md
   ```

6. **Drift routine:** remind that a monthly drift review runs as a scheduled
   routine on the 1st of the month. Its ID is deliberately NOT recorded here —
   this repo is public and a routine ID is an account-linked identifier. Run
   `/schedule` to list the maintainer's routines.

## Output format

A compact block: Deploy (stable vN @hash · next @hash) · Branches (n
in-flight, list) · PRs (list) · Soak (summary) · Parked (the next-task
line) · Drift (next run). Flag if >2 in-flight branches (WIP-cap breach
per the ROADMAP lock). No recommendations unless asked — this is a
status readout, not a planning session.
