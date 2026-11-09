---
name: ui-truth
description: Keep the running UI true to the design system on a schedule — measure drift, LOOK at the screens that changed, find patterns the docs never wrote down, and PROPOSE fixes as GitHub issues with wrong-vs-right screenshots. Never changes UI code or docs until Grant approves a proposal. Use on the weekly "UI truth" routine, when asked to check the UI against the design system, or to act on approved ui-proposal issues.
---

# UI truth

This skill does three things:
- keeps what players see true to `app/globals.css`, `DESIGN.md`, `CLAUDE.md`
  and `.claude/rules/design-system.md`;
- keeps those docs true to what the UI has actually become;
- tells Grant **before** anything changes.

## The one rule: propose, then wait

This skill **never edits UI code or docs on its own**. Each run has two halves:

1. **Find and propose** — read-only. Every finding becomes (or updates) ONE
   GitHub issue labelled `ui-proposal`, with a wrong-vs-right image. Nothing is
   changed.
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

For each one:
1. Create a branch `ui-truth/<issue>-<slug>`.
2. Make **exactly** the change the issue proposed. A proposal is a contract:
   nothing extra. For a pattern issue, that means only the doc lines and any
   class the issue named.
3. Run the full gate: `npm test && npm run lint && npm run typecheck`.
4. Re-shoot the screen as in step 5 and compose a new before/after image.
5. Open a **draft** PR with `Closes #<issue>` and that image.

If the change turns out bigger than proposed, stop and comment on the issue
instead of widening the PR.

Close `ui-declined` issues with a comment "Won't propose again." — their titles
are the decline list for step 6.

### 2. Measure (deterministic)

```bash
node scripts/ui-truth-report.mjs
```

The output is the design-token lint by kind and area, the UI canaries, and the
UI files changed since the last run, each with its delta from that run. A failing
canary is a break, not drift. Propose its fix first.

### 3. Look (the part tests cannot do)

jsdom applies no stylesheet, so the suite can't see layout. Use the `verify-ui`
skill: the mock store, Playwright, a 430×932 viewport, and navigating by clicking.

- **Which screens:** every tab in the "UI files changed" list, plus Home on
  every run.
- **How:** in both themes, as a player (Lin / 2468) and, if admin files changed,
  as admin (Grant / 1130).
- **What to check:** the written rules, not taste.
  - Containers are fill-only, with no outer stroke.
  - Radius is ≤ 16, except field cards.
  - Type and spacing come from the ladders.
  - Accent goes only on the primary button, the one link and the active tab;
    red only means failure.
  - While a card loads, its place is a skeleton the size of the card.
  - No raw i18n key paths on screen.
  - Nothing flush against anything, and tap targets are ≥ 44px.

### 4. Find patterns nobody wrote down

An AI learns this UI from the docs. A pattern that lives only in code gets
reinvented slightly differently by the next change, which is how drift starts.

```bash
node scripts/ui-patterns.mjs        # 🆕 marks what is new since the last run
```

It reports three things that appear in at least 3 files:
- globals.css classes that no doc names;
- inline style objects typed out the same way in several places;
- the same className combinations repeated.

For each NEW one, read two or three of the files it names and decide:

- **Document it.** The pattern is consistent and intended. Propose a terse
  line for `.claude/rules/design-system.md`, saying when to use it and what
  not to do instead. Check the size first: `wc -c .claude/rules/design-system.md`
  must stay under 40,000, or the rule file is cut off when it loads.
- **Codify it.** The same inline style is typed out by hand everywhere. Propose
  a class in `globals.css` or a primitive, plus the doc line.
- **Leave it.** It's a coincidence, not a pattern (e.g. `flex: 1; minWidth: 0`).
  Say so in the report and file nothing.
- **Fix it.** The instances disagree, so one of them is drift. That's a fix
  proposal, with screenshots.

Batch these: at most **one "Patterns to document" issue per run**, listing up to
5 patterns. Each pattern gets the evidence (count, files), a screenshot of one
instance with the element marked, and the exact doc line proposed.

### 5. Screenshots: what is wrong vs what is right

Every proposal about something visible carries ONE comparison image. It should
make the case on its own: someone who looks only at the picture should know
what is wrong and what right looks like.

**Take the shots** (the `verify-ui` setup, `playwright-isolated`):

1. **Run browser steps one at a time.** Never batch them: parallel tool calls
   don't keep their order, and the "right" shot ends up wearing the "wrong"
   shot's mark.
2. Save under `.playwright-mcp/uitruth/` (gitignored). The browser server can
   write only inside the repo.
3. Hide the dev badge before any shot:

   ```js
   () => { const s = document.createElement('style'); s.dataset.uiTruth = 'hide';
     s.textContent = 'nextjs-portal{display:none!important}'; document.head.appendChild(s); }
   ```

4. Mark the offending element with an OVERLAY, never an `outline` (app CSS
   overrides outlines). It dims the rest of the page:

   ```js
   () => { const el = document.querySelector('<selector>'); const r = el.getBoundingClientRect();
     const b = document.createElement('div'); b.dataset.uiTruth = 'mark';
     Object.assign(b.style, { position: 'fixed', left: r.left - 4 + 'px', top: r.top - 4 + 'px',
       width: r.width + 8 + 'px', height: r.height + 8 + 'px', border: '3px solid #ef4444',
       borderRadius: '14px', boxShadow: '0 0 0 9999px rgba(0,0,0,0.25)', pointerEvents: 'none',
       zIndex: 2147483647 }); document.body.appendChild(b); }
   ```

   Remove it with `document.querySelectorAll('[data-ui-truth=mark]').forEach(n => n.remove())`.
5. Check the viewport is 430 wide (`innerWidth`) before trusting a shot. A
   resize can land on a different tab than the one you're shooting.

**Where "Right" comes from**, in order of preference:

1. **A preview of the proposed fix.** Make the edit in the working tree, let
   hot reload apply it, take the shot, then `git checkout -- <file>` and confirm
   `git status` is clean. That edit is a camera, not a change: it is never
   committed or pushed, and it comes out before the next step.
2. **A conforming instance elsewhere in the app.** The same component done
   right on another screen.
3. **The specimen** at `/bpm/design/*`, the design system's own rendering.

Label "Right" with which of these it is (`Proposed fix (preview)`,
`Same card on Stats`, `Design system specimen`).

**Compose and publish:**

```bash
node scripts/ui-truth-compare.mjs \
  --wrong .playwright-mcp/uitruth/<slug>-wrong.png \
  --right .playwright-mcp/uitruth/<slug>-right.png \
  --title "<screen> — <what is untrue>" \
  --rule "<the rule, quoted, with its doc>" \
  --right-label "<where Right came from>" \
  --out .playwright-mcp/uitruth/<slug>.png
scripts/ui-truth-publish.sh <slug> .playwright-mcp/uitruth/<slug>.png   # prints the ![..](url) line
```

`ui-truth-publish.sh` pushes to the orphan branch `ui-truth-shots`, which
shares no history with `main`, is never merged and is never deployed. The repo
is public, so the raw URL renders in the issue. **Open the composed image and
look at it before filing**: a mark on the wrong element is worse than no image.

### 6. Propose

One issue per **distinct** finding. Group the same fix across files into one
issue, and never file a finding that matches a `ui-declined` title or an
open `ui-proposal`. Before filing:

```bash
gh issue list --label ui-proposal --state all --limit 200 --json number,title,state,labels
```

Issue template:

```
Title: UI: <screen> — <what is untrue>      (or: UI patterns to document — <date>)

![<slug>](<url from ui-truth-publish.sh>)

**Rule:** <the line in CLAUDE.md / DESIGN.md / .claude/rules/design-system.md / globals.css it breaks, quoted>
  (pattern issues: "Not written down anywhere an AI reads")
**Where:** <file:line(s)>, <screen + theme + viewport>
**Wrong:** <one sentence: what the left image shows>
**Right:** <one sentence: what the right image shows, and where it came from>
**Proposed change:** <exact, minimal — the diff in words or a short code block;
  for a pattern, the doc line itself, ready to paste>
**Risk:** <what else reads this class/token; any canary it touches>
**Size:** S (<10 lines) / M / L

Label `ui-approved` to have it made as a draft PR, or `ui-declined` to never see it again.
```

Lint-only drift (counts with no visible defect) is NOT an issue per warning: file
at most one "token sweep" proposal per area per month, and only when its count rose.

### 7. Report

End with a short summary covering:
- approvals acted on, with PR links;
- new proposals, with issue links and each one's image;
- drift totals, with deltas;
- new patterns found, and what you decided for each;
- screens you **actually looked at**.

If the browser was locked or a screen was not reached, say so. "Verified" for a
screen nobody saw is worse than no claim.

## Don'ts

- Don't edit, commit or open a PR for anything without `ui-approved`. The only
  edit allowed before approval is a "Right" preview, and it comes out at once.
- Don't "improve" design: this checks the UI against the system as written. A
  rule you think is wrong is a proposal titled `UI rule: …`, not a code change.
- Don't touch `docs/design-system/` (pristine reference) or import it.
- Don't screenshot production — the mock store only.
