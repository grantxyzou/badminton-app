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

### 0. Stop if a fix of ours broke something

```bash
git fetch origin
git log origin/main --since="5 weeks ago" --format='%h %s' | grep -iE '^[0-9a-f]+ revert.*ui-truth:'
```

Any output, or a production problem Grant has tied to a `ui-truth/*` PR:
**do nothing else this run.** Report what was reverted and why, and wait for
Grant. A fix of ours getting through means a guard failed; the next run is not
the fix (`docs/plans/ui-truth.md`, Kill criterion).

### 1. Act on approvals first

```bash
git fetch origin
gh issue list --label ui-approved --state open --json number,title,body
```

An approved issue stays open until its PR merges, so the next run sees it
again. **Skip one that is already being made**, or the next run builds a
second identical PR:

```bash
git ls-remote --heads origin "ui-truth/<issue>-*"      # any output: skip it
gh pr list --state open --search '"Closes #<issue>" in:body' --json number,url   # any result: skip it
```

For each one not already being made:
1. Make a worktree from a fresh `origin/main`, never from the branch you are
   on or the last approval's branch:
   `git worktree add .claude/worktrees/ui-truth-<issue> origin/main -b ui-truth/<issue>-<slug>`
   (copy `.env.local` in, and give it a real `node_modules`).
2. Make **exactly** the proposed change, nothing extra.
3. Run `npm test && npm run lint && npm run typecheck`.
4. Screenshot the screen (`verify-ui`).
5. Open a draft PR titled `ui-truth: <what it fixes>` with `Closes #<issue>`.
   The title prefix is what Step 0 finds if it is ever reverted.
6. Comment on the issue with the PR link. That comment, the branch and the
   PR are what tell the next run it's handled.

If the change turns out bigger than proposed, comment on the issue instead.

**Before Step 2, go back to an up-to-date `main` with a clean tree**
(`git status --porcelain` prints nothing). Step 2 photographs what ships,
not an approval that hasn't merged.

Close each open `ui-declined` issue with "Won't propose again."

### 2. Look at what changed

```bash
git log --since="7 days ago" --name-only --pretty=format: -- components app messages lib | sort -u
```

A `messages/*.json` change is new words on a screen. A `lib/` file counts
only when a screen renders what it returns (a sentence like `courtLine`, a
class name); skip server-only ones.

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
before trusting a shot, and read the computed style before calling something
wrong: a "different-looking" label can be identical underneath.

**Side by side — every proposal about something you can SEE carries one.**
Take the "wrong" shot as it ships. Then make "right" from the first of these
that exists:
1. **Preview the fix.** Only on a clean tree: `git status --porcelain` must
   print nothing first, because the undo below throws away EVERY uncommitted
   edit in the file, not only the preview. Edit, let hot reload apply it, and
   take the shot (re-open the sheet if the reload closed it). Then
   `git checkout -- <file>` and confirm `git status` shows the file clean
   **before anything else**. That edit is a camera, never a commit. Never
   `git stash` around it: the stash is shared with every other session.
2. Use the same component done right on another screen.
3. Use the specimen at `/bpm/design/*`.

```bash
node scripts/ui-truth-compare.mjs --wrong .playwright-mcp/uitruth/<n>-wrong.png \
  --right .playwright-mcp/uitruth/<n>-right.png --crop "x,y,w,h" \
  --title "<screen> — <what is untrue>" --rule "<the rule, quoted, + theme/viewport>" \
  --wrong-label "Wrong — <what>" --right-label "Right — <what> (preview)" \
  --out .playwright-mcp/uitruth/<n>.png
scripts/ui-truth-publish.sh <n>-<slug> .playwright-mcp/uitruth/<n>.png   # prints ![..](url)
```

`--crop` cuts the same region from both shots and enlarges it. Use it when the
defect is a few pixels: a 20px vs 18px glyph is invisible on a full phone
screen. Centre the crop on the element, say the enlargement in `--rule`, and
**open the composed image and look at it** before filing. The publish script
pushes to the orphan branch `ui-truth-shots`, which is never merged or
deployed; the repo is public, so the raw URL renders in the issue.

Behaviour (a key that does nothing) and timing (a duration) get no image. Say
so in the issue rather than attach a still that proves nothing.

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

![<n>](<url from ui-truth-publish.sh>)      ← the side by side; omit only for behaviour/timing

**Rule:** <the doc line it breaks, quoted>  (patterns: "Not written down anywhere an AI reads")
**Where:** <file:line(s)>; <screen, theme, viewport>
**Evidence:** <what you saw, or the pattern's count and files>
**Proposed change:** <exact and minimal — for a pattern, the doc line ready to paste>
**Risk:** <what else reads this class/token; any canary it touches>
**Size:** S (<10 lines) / M / L

Label `ui-approved` to have it made as a draft PR, or `ui-declined` to never see it again.
```

The image comes first, so Grant can judge from his phone without opening the app.

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
- Never screenshot production. Use the mock store only. This rule is the ONLY
  guard: `ui-truth-publish.sh` pushes to a public repo, and a pushed image
  stays in its history for good. Check every image for real names before
  publishing.
