# The PR review bot — how it went quiet, three times

Moved out of `CLAUDE.md` on 2026-10-11 (it was ~60 lines of history loaded on every turn). The RULES stay in `CLAUDE.md` → Deployment; this is the record they were paid for, kept because each failure was invisible from the check's own colour. Dates are 2026 unless stated.

**The PR review bot** (`claude-code-review.yml`) applies `REVIEW.md` — the review policy: what to check, how to rank it, what not to flag. It posts **inline comments** on the diff (not a PR-level review). Several things about it are not obvious:
- **It silently skips any PR that modifies its own workflow file** — the action requires the file to match `main`. The job still shows green, in ~12s. Reviews resume on the next PR.
- **It reviewed into `/dev/null` from #285 to #301 with a green check every time.** The plugin's `/code-review` writes to the runner terminal unless passed `--comment`, and the SDK denied `gh pr comment` because it wasn't in `claude_args --allowedTools`. The #301 canary run logged 19 turns, $0.84 and `permission_denials_count: 4` — it found things and was refused the tool to say them. Both fixed in #302; proven by canary #303 (3 inline findings, one a real bug). **Don't remove `--comment` or the allowlist.**
- **Silence is never proof.** A run's duration, cost and turn count all looked healthy while it produced nothing. If you change the workflow, prove it with a throwaway PR that plants a `REVIEW.md`-named defect, and confirm it posted inline comments — not that it ran, and not what its denial count was (see below).
- **It could not read the repo until 2026-09-08, REVIEW.md included.** `--allowedTools` listed seven `Bash(...)` patterns and no `Read`/`Grep`/`Glob`, so the agent saw the diff and could not open the file those lines landed in — this repo's own recorded blind spot ("a per-task review scoped to its own diff cannot see cross-file breakage") wired into the gate meant to catch it. It was also being told to do something it had been denied: the prompt says "read REVIEW.md at the repository root" while `Read` was absent, so the review *policy* was unreachable by the reviewer. #331 logged `permission_denials_count: 12` across 3 turns and reported nothing, which is indistinguishable from having looked. Note this is the THIRD way this one job has been quietly not-working (after `read`-only permissions and the missing `--comment`); when it reports nothing, check what it was allowed to do before believing it.
- **A high denial count is NOT the tell, and neither number in the log is trustworthy alone.** Measured across the 45 successful review runs from 2026-09-06 to 2026-09-09: **640 denials** — a median of 12 per run, mean 14. That is the steady state, not a symptom — #342 posted four correct findings on three planted defects while logging 20. The two numbers fail in OPPOSITE directions and one parser produces both: `summarize-review-run.mjs` prints `denials ?` on EVERY run — it has never once extracted the number, confirmed against a run whose result block said `20` and another that said `0` — so the header reports nothing at all; and its NOT-ALLOWED list flags any command whose prefix does not literally match an allowlist entry, so a compound or piped command is listed where no denial occurred and the list OVER-reports (29 patterns / 55 attempts against a reported 20). **The only reliable proof a review happened is inline comments on the diff**, by `claude[bot]`, timestamped inside the run window.
- **The posting tool was never in the allowlist, and that is why it goes quiet.**
  The action starts its inline-comment MCP server ONLY when `--allowedTools`
  names `mcp__github_inline_comment__create_inline_comment`; it never did, so
  **every run printed `No buffered inline comments` — 35 of 35.** The one run
  that ever posted (#342) improvised `gh api .../pulls/342/comments` by hand,
  which `Bash(gh api:*)` happens to permit. That is why posting has been
  INTERMITTENT rather than simply broken: it worked when the agent thought to
  hand-roll it. Added 2026-09-10.
- **`Skill` and `Agent` are NOT the fix, and were reverted the day they were
  added.** Neither is a documented `allowedTools` value for this action. The
  earlier theory here — that the marketplace `/code-review` command is built on
  subagents (three Haiku steps, five parallel Sonnet reviewers, a Haiku
  confidence score per issue) and that denying `Agent` was what silenced the
  bot — is **half right and the wrong half was load-bearing**. The fan-out is
  real, and denying `Skill` really does stop the command executing (`tool
  errors: Execute skill: code-review:code-review`). But allowing both changed
  nothing measurable: runs `34489909359` and `34490515068` on PR #355 logged
  **10 and 18** denials WITH both allowed — at or above the median — and posted
  nothing. And #342 posted four correct findings with `Agent` denied **11**
  times and `Skill` never attempted. A review demonstrably happens with both
  denied. Most denials are not the fan-out at all; they are Claude Code's
  built-in Bash safety (`multiple operations`, output redirection, `mkdir`),
  which **no allowlist entry can grant** — the diagnostic's "Add them to
  `--allowedTools`" advice is wrong for those.
- **High-denial runs cost more per turn, and NOBODY HAS ESTABLISHED WHY.**
  Holding turns roughly constant, runs with ≥10 denials cost **$0.220 per turn**
  against **$0.074** for runs with ≤2. Total across the 45 runs of 2026-09-06 to
  09-09: **$114.34**, mean $2.54 a review. The numbers check out; the mechanism
  first written here did not, and the correction is worth keeping because of how
  it arrived. This file used to say the gap was "because a refused call burns a
  turn and returns nothing". **The review bot itself refuted that, inline on
  #351**: per-turn cost is `total_cost_usd / num_turns`, which is dominated by
  INPUT CONTEXT SIZE, and a refused call adds almost no tokens — so it should be
  CHEAPER per turn, not three times dearer. The stated cause predicted the
  opposite sign from the gap it was explaining. A likelier driver, still
  unmeasured, is context inflation from routing AROUND the refusal: the
  `Read`/`Grep` output that replaces the denied call is carried in every later
  turn. **Do not use this gap to justify widening the allowlist** — that is
  precisely what it was used for, and #357 was reverted the same day.
  The other half of the lesson is the timing: the bot posted that comment at
  11:36 and #357 merged at 14:29, because the check was green and nobody opened
  the comment. **A green `claude-review` is not the review — the comment is.**
- **A canary that announces itself proves nothing.** The plugin's first step is
  an eligibility check that may skip a PR it judges doesn't need review, and its
  step 6 drops any finding scored under 80. A PR titled "DO NOT MERGE — planted
  defect canary" whose body lists the defects gives a zero-comment run an honest
  excuse, so it cannot distinguish a broken gate from a correctly-skipped test
  PR. #356 burned three runs learning this. Plant ONE defect in a genuine,
  wanted PR instead — eligibility passes honestly and the defect is one line to
  fix before merge. See the memory note `feedback-canary-must-not-announce-itself`.

- **Bot-authored PRs are skipped, not reviewed** (`if: github.event.pull_request.user.type != 'Bot'`). The action hard-fails on a non-human actor, which painted a permanent red X on every Dependabot PR — and a check that is always red for a whole class trains you to skim past red where a real failure lives. `verify` is the gate that matters there.
