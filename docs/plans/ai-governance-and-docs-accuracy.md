# AI governance + documentation accuracy

**Track:** none, and deliberately so. Every item here repairs already-shipped work
against a rule this repo already holds itself to — it adds no user-facing surface,
so ROADMAP's Change Rule (aimed at new surfaces that serve no track) does not apply.
Naming a track to satisfy the form would be the drift the rule exists to catch.
**Status:** shipped 2026-09-07

## Problem

Nobody reported these. That is worth stating plainly, because this file's own
template says a problem only you have noticed is a weaker reason to build than one
somebody reported — and it is the right caveat for four of the five items.

The exception, and the reason the batch was worth doing at all, is written in the
code itself. `emptyPayload`'s docstring in `app/api/stats/insight/route.ts` audited
its own callers and said, in the file, that three of them were failures wearing an
empty payload and "should become 503s". The app's stated cardinal sin — PRODUCT.md
#4, "never let a failure look like a fact" — was being committed knowingly, in
writing, and left. The audit had also gone stale: its line numbers had drifted, it
counted a site that no longer existed, and it MISSED the worst path, where a thrown
member lookup answered `account: false` and told a signed-in member they had no
account because Cosmos blipped.

The rest came out of a review of how AI operates in the app (7 Sep 2026), asked for
after a question about what rules and laws govern it:

- `lib/aiPersona.ts` opened by claiming every player-facing prompt prepends the
  shared voice. One of three call sites did. The other two publish announcements and
  release notes — text every player reads — in whatever tone their prompt string
  happened to ask for.
- `/api/claude` spends API budget behind the cheap signature-only admin check, which
  the convention reserves for reads. An admin cookie outlives a demotion by 30 days.
- Two model IDs pinned in two files with nothing connecting them, guarded only by a
  denylist that can describe the last retirement and not the next.
- `CLAUDE.md` documented 8 Cosmos containers. There are 23.

## Kill criterion

There is no metric to read here; these are defects, and the honest failure condition
is about the fixes rather than their uptake:

- **The persona flag is the one to watch.** It is opt-in, so a fourth player-facing
  caller can simply forget it and the claim in `aiPersona.ts` goes false again in the
  same way. If that happens even once, opt-in was the wrong shape — make the field
  required and let the type system carry it.
- If the Stats 503 produces a support question ("why does it say couldn't load"),
  the error copy is wrong, not the decision to show it. Silence was the alternative
  and silence is what caused this.
- If either new canary is ever edited to make a build pass rather than to record a
  deliberate exception, it has become ceremony and should be deleted rather than
  carried.

## Non-goals

- Changing how the AI is *used* — no new prompts, no new surfaces, no model upgrade.
  Only the governance around the two calls that already exist.
- Rewriting `lib/auth.ts` so a Cosmos failure reads as 503 rather than 401. Correct,
  and 31 routes wide; not this change.
- Making `SkillTrendCard`'s chip explain its own absence. It is an enhancement, and
  an error pill where an enhancement would have been is worse than silence.
- Verifying the six inferred partition keys. Ground truth is the Azure portal, not
  this repo; the documentation now says which six and why.

## Decisions

- **The persona is opt-in per caller, not applied to every prompt.** Always-on beat
  it on safety and lost on honesty: a caller may legitimately want unstyled output,
  and a voice contract applied silently to a data extraction is a surprise rather
  than a standard. The cost — a new caller can forget — is written at the definition
  along with the trigger for revisiting it.
- **The prompt length cap keeps measuring the caller's string.** The persona adds
  ~700 characters the caller did not write and cannot shorten; capping the composed
  prompt would reject a request for text the server added.
- **`/api/claude` accepts the fresh-role check's known cost.** It folds a Cosmos
  failure into `authed: false`, so an outage tells an admin they are unauthorized —
  on the route whose error design exists to stop exactly that. Accepted because
  `app/api/push/test` already made the identical trade for the identical reason, and
  a second answer to one question is worse than a known-imperfect first one.
- **Only 5xx renders on Stats.** A 429 or a flag-off 404 still shows nothing, which
  keeps the documented "additive component stays quiet" decision intact for every
  case it was written about. 5xx is different in kind: the server is asserting its
  own failure, which is a true statement and can be put on screen.
- **The container list is documented with its uncertainty.** Six partition keys are
  inferred from call sites rather than declared anywhere in the repo. Marking them as
  inferred beats presenting inference as fact, and beats omitting them.
- **`VOICE_STYLE` deleted rather than wired in.** It had zero importers. Adopting it
  would have meant editing a shipped player-facing prompt to retire a dead export —
  changing what players read in order to tidy a file.

## Shape

| Piece | Where |
|---|---|
| Sub-processor disclosure (AI, both locales) | `messages/{en,zh-CN}.json` → `legal.privacy` |
| Governing-doc path canary | `__tests__/docs-canary.test.ts` |
| Container list + its canary | `CLAUDE.md` Coding Conventions · same test |
| Model-ID single owner | `lib/aiModels.ts` · `__tests__/ai-model-owner-canary.test.ts` |
| Fresh admin re-check | `app/api/claude/route.ts` |
| Shared voice reaching all callers | `app/api/claude/route.ts` · both admin components |
| Honest insight failures | `app/api/stats/insight/route.ts` · `lib/useInsight.ts` · `components/stats/SummaryGreeting.tsx` |

The map of how AI operates in the app, drawn during the review that produced this:
https://claude.ai/code/artifact/87e259ac-984e-4abd-81fe-188ba85dcd78
