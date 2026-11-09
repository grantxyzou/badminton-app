---
name: ui-truth
description: Keep the running UI true to the design system on a schedule — measure drift, LOOK at the screens that changed, and PROPOSE fixes as GitHub issues. Never changes UI code until Grant approves a proposal. Use on the weekly "UI truth" routine, when asked to check the UI against the design system, or to act on approved ui-proposal issues.
---

# UI truth

Keeps what players see true to `app/globals.css`, `DESIGN.md` and the design
rules in `CLAUDE.md` — and tells Grant **before** anything changes.

## The one rule: propose, then wait

This skill **never edits UI code on its own**. Each run has two halves:

1. **Find and propose** — read-only. Every finding becomes (or updates) ONE
   GitHub issue labelled `ui-proposal`. Nothing is changed.
2. **Act on approvals only** — an issue Grant has labelled `ui-approved` gets a
   draft PR. An issue labelled `ui-declined` is closed and never proposed again.

An unlabelled proposal is a question still waiting for an answer: leave it,
don't re-file it, don't act on it. Opening the issue IS the notification —
GitHub emails Grant, and a run with nothing new files nothing.

## Run

### 0. Labels (once; idempotent)

```bash
gh label create ui-proposal --color FBCA04 --description "UI truth: proposed change, awaiting Grant" 2>/dev/null
gh label create ui-approved --color 0E8A16 --description "UI truth: Grant approved — make a draft PR" 2>/dev/null
gh label create ui-declined --color B60205 --description "UI truth: Grant declined — never re-propose" 2>/dev/null
```

### 1. Act on approvals first

```bash
gh issue list --label ui-approved --state open --json number,title,body
```

For each one: branch `ui-truth/<issue>-<slug>`, make **exactly** the change the
issue proposed (nothing extra — a proposal is a contract), run the full gate
(`npm test && npm run lint && npm run typecheck`), screenshot the screen with
the `verify-ui` skill, then open a **draft** PR with `Closes #<issue>` and the
before/after shots. If the change turns out bigger than proposed, stop and
comment on the issue instead of widening the PR.

Close `ui-declined` issues with a comment "Won't propose again." — their titles
are the decline list for step 4.

### 2. Measure (deterministic)

```bash
node scripts/ui-truth-report.mjs
```

The output is the design-token lint by kind and area, the UI canaries, and the
UI files changed since the last run, each with its delta from that run. A failing
canary is a break, not drift. Propose its fix first.

### 3. Look (the part tests cannot do)

jsdom applies no stylesheet, so the suite can't see layout. Use the
`verify-ui` skill (mock store, Playwright, 430×932, navigate by clicking):

- **Every tab** in the "UI files changed" list, plus Home every run.
- **Both themes**, as a player (Lin / 2468) and, if admin files changed, as
  admin (Grant / 1130).
- Check against the written rules, not taste: containers fill-only (no outer
  stroke), radius ≤ 16 except field cards, type and spacing from the ladders,
  accent only on the primary button / one link / active tab, red only for
  failure, a skeleton the size of the card while loading, no raw i18n key paths,
  nothing flush against anything, ≥ 44px tap targets.

### 4. Propose

One issue per **distinct** finding. Group the same fix across files into one
issue, and never file a finding that matches a `ui-declined` title or an
open `ui-proposal`. Before filing:

```bash
gh issue list --label ui-proposal --state all --limit 200 --json number,title,state,labels
```

Issue template:

```
Title: UI: <screen> — <what is untrue>

**Rule:** <the line in CLAUDE.md / DESIGN.md / globals.css it breaks, quoted>
**Where:** <file:line(s)>, <screen + theme + viewport>
**Proposed change:** <exact, minimal — the diff in words or a short code block>
**Risk:** <what else reads this class/token; any canary it touches>
**Size:** S (<10 lines) / M / L

Label `ui-approved` to have it made as a draft PR, or `ui-declined` to never see it again.
```

Attach the screenshot. Lint-only drift (counts with no visible defect) is NOT an
issue per warning: file at most one "token sweep" proposal per area per month,
and only when its count rose.

### 5. Report

End with a short summary: approvals acted on (PR links), new proposals (issue
links), drift totals with deltas, and screens you **actually looked at**. If the
browser was locked or a screen was not reached, say so — "verified" for a screen
nobody saw is worse than no claim.

## Don'ts

- Don't edit, commit or open a PR for anything without `ui-approved`.
- Don't "improve" design: this checks the UI against the system as written. A
  rule you think is wrong is a proposal titled `UI rule: …`, not a code change.
- Don't touch `docs/design-system/` (pristine reference) or import it.
- Don't screenshot production — the mock store only.
