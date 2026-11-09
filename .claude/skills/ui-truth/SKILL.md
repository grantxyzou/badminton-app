---
name: ui-truth
description: Keep the UI true to the design system and keep the design docs true to the UI — look at the screens that changed, find patterns no doc an AI reads mentions, and PROPOSE fixes as GitHub issues. Never changes UI code or docs until Grant approves. Use on the weekly "UI truth" routine, when asked to check the UI against the design system, or to act on approved ui-proposal issues.
---

# UI truth

Two kinds of drift, one loop:

- **The UI drifts from the rules.** A screen breaks something
  `.claude/rules/design-system.md`, `DESIGN.md` or `CLAUDE.md` says.
- **The rules drift from the UI.** A pattern used across the app is written
  down nowhere an AI reads, so the next change reinvents it slightly differently.

## The one rule: propose, then wait

This skill **never edits UI code or docs on its own**.

- Every finding becomes ONE GitHub issue labelled `ui-proposal`. Opening the
  issue is the notification: GitHub emails Grant.
- **`ui-approved`** → the next run makes exactly that change as a **draft** PR.
- **`ui-declined`** → close it, and never propose it again.
- **No label** → still waiting. Leave it, and don't re-file it.

A run that finds nothing new files nothing.

## Run

### 1. Act on approvals first

```bash
gh issue list --label ui-approved --state open --json number,title,body
```

For each one:
1. Branch `ui-truth/<issue>-<slug>`.
2. Make **exactly** the proposed change, nothing extra.
3. Run `npm test && npm run lint && npm run typecheck`.
4. Screenshot the screen (`verify-ui`).
5. Open a draft PR with `Closes #<issue>`.

If the change turns out bigger than proposed, comment on the issue instead.

Close each open `ui-declined` issue with "Won't propose again."

### 2. Look at what changed

```bash
git log --since="7 days ago" --name-only --pretty=format: -- components app/globals.css | sort -u
```

Use `verify-ui` (mock store, `playwright-isolated`, 430×932, navigate by
clicking) on every screen those files render, plus Home. Check both themes.
Sign in as Lin / 2468, and as Grant / 1130 if admin files changed.

Check the written rules, not taste:
- containers are fills with no outer stroke;
- radius ≤ 16, except field cards;
- type and spacing come from the ladders;
- accent only on the primary button, the one link and the active tab;
- red only for failure;
- a card-sized skeleton while loading;
- no raw i18n key paths;
- nothing flush against anything;
- tap targets ≥ 44px.

**Screenshots:** run browser steps one at a time (parallel calls lose their
order) and save under `.playwright-mcp/uitruth/`. Hide the dev badge with a
`nextjs-portal{display:none!important}` style. Check `innerWidth` is 430
before trusting a shot.

### 3. Find patterns nobody wrote down

```bash
node scripts/ui-patterns.mjs      # 🆕 = new since the last run on this machine
```

It lists things that appear in 3+ files and in no doc an AI reads
(CLAUDE.md, DESIGN.md, `.claude/rules/`, nested CLAUDE.md):
- globals.css classes;
- inline style objects repeated word for word;
- className lists repeated word for word.

Read 2–3 of the files each pattern names, then decide:

- **Document:** the pattern is consistent and intended. Propose one terse
  line for `.claude/rules/design-system.md`: when to use it and what not to do
  instead. That file is cut off past 40,000 characters, so check
  `wc -c .claude/rules/design-system.md` first.
- **Codify:** the same inline style is hand-typed everywhere. Propose a class
  in `globals.css` or a primitive, plus the doc line.
- **Fix:** the instances disagree, so one of them is drift. That's a UI
  proposal.
- **Leave:** a coincidence such as `flex: 1; minWidth: 0`. Say so in the
  report and file nothing.

File at most **one "UI patterns to document" issue per run**, covering up to 5
patterns.

### 4. Propose

First check for duplicates and declines:

```bash
gh issue list --label ui-proposal --state all --limit 200 --json number,title,state,labels
```

```
Title: UI: <screen> — <what is untrue>     |     UI patterns to document — <date>

**Rule:** <the doc line it breaks, quoted>  (patterns: "Not written down anywhere an AI reads")
**Where:** <file:line(s)>; <screen, theme, viewport>
**Evidence:** <what you saw, or the pattern's count and files>
**Proposed change:** <exact and minimal — for a pattern, the doc line ready to paste>
**Risk:** <what else reads this class/token; any canary it touches>
**Size:** S (<10 lines) / M / L

Label `ui-approved` to have it made as a draft PR, or `ui-declined` to never see it again.
```

`gh` can't attach images. Describe what you saw precisely enough that Grant can
find it on his phone.

### 5. Report

List what you did:
- approvals acted on, with PR links;
- issues filed, with links;
- each new pattern and its decision;
- the screens you **actually looked at**.

If the browser was locked or a screen wasn't reached, say so.

## Don'ts

- No edit, commit or PR without `ui-approved`.
- Don't improve the design. A rule you think is wrong becomes a `UI rule: …`
  proposal.
- Never touch or import `docs/design-system/`.
- Never screenshot production. Use the mock store only.
