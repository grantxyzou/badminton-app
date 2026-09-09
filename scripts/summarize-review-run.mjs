#!/usr/bin/env node
/**
 * Say what the PR review bot actually did — especially which tools it was refused.
 *
 * This exists because `claude-code-review` has now been silently not-working in
 * FOUR distinct ways, and every one of them showed a green check:
 *
 *   1. a `read`-only GitHub token (couldn't post)
 *   2. no `--comment`, so the review went to the runner's terminal (#285–#301)
 *   3. no `Read`/`Grep`/`Glob`, so it could not open the file a diff line landed
 *      in — including REVIEW.md, which its own prompt tells it to read (#331)
 *   4. whatever is still wrong after #334: a planted-defect canary on 2026-09-09
 *      (three blocks-merge defects: unstripped pinHash, a lying empty state, sync
 *      `isAdminAuthed` on a mutating POST) produced ZERO comments on every
 *      surface, with `permission_denials_count: 2`.
 *
 * Each diagnosis so far has been a guess confirmed by trial, because the run log
 * prints a denial COUNT and never the tool names, and the action uploads no
 * transcript. Fixing that is worth more than any single fix: it is what turns
 * breakage number five into a five-minute read.
 *
 * The load-bearing part is the last section — tools the agent ATTEMPTED that the
 * allowlist does not cover. That is the sentence nobody has been able to write
 * for four rounds: not "something was denied" but "it wanted X, and X is not
 * allowed."
 *
 * Never fails the job. It is a diagnostic; a broken diagnostic must not turn a
 * red review into a red build, and a check that fails for its own reasons is how
 * you train people to ignore red.
 *
 * Usage:  node scripts/summarize-review-run.mjs <execution-file> [workflow-file]
 */
import { readFileSync, existsSync } from 'node:fs';

const DEFAULT_WORKFLOW = '.github/workflows/claude-code-review.yml';

/**
 * The action writes either a JSON array of SDK messages or newline-delimited
 * JSON, depending on version. Accept both rather than pinning a shape that a
 * dependency bump can silently change — this file exists precisely because
 * silent changes here are expensive.
 */
export function parseTranscript(raw) {
  const text = raw.trim();
  if (!text) return [];
  try {
    const whole = JSON.parse(text);
    return Array.isArray(whole) ? whole : [whole];
  } catch {
    // NDJSON, possibly with partial trailing output.
    return text
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => {
        try {
          return JSON.parse(l);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  }
}

/** Every `tool_use` block in the transcript, in order, with its name. */
export function attemptedTools(messages) {
  const counts = new Map();
  for (const m of messages) {
    const content = m?.message?.content ?? m?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (block?.type !== 'tool_use' || typeof block.name !== 'string') continue;
      // For Bash, the command matters more than the tool: the allowlist is
      // per-command-prefix, so "Bash" alone cannot tell you what was refused.
      const label =
        block.name === 'Bash' && typeof block.input?.command === 'string'
          ? `Bash(${block.input.command.trim().split(/\s+/).slice(0, 3).join(' ')})`
          : block.name;
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }
  }
  return counts;
}

/** Tool results the SDK marked as errors — where a denial surfaces, when it does. */
export function errorResults(messages) {
  const out = [];
  for (const m of messages) {
    const content = m?.message?.content ?? m?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (block?.type !== 'tool_result' || !block.is_error) continue;
      const body =
        typeof block.content === 'string'
          ? block.content
          : Array.isArray(block.content)
            ? block.content.map((c) => c?.text ?? '').join(' ')
            : '';
      const trimmed = body.trim().slice(0, 300);
      if (trimmed) out.push(trimmed);
    }
  }
  return [...new Set(out)];
}

/** The `--allowedTools "..."` string from the workflow, as a list of patterns. */
export function allowedPatterns(workflowSrc) {
  const m = /--allowedTools\s+"([^"]+)"/.exec(workflowSrc);
  if (!m) return null;
  return m[1].split(',').map((s) => s.trim()).filter(Boolean);
}

/**
 * Does the allowlist cover this attempted tool?
 *
 * Deliberately conservative: a `Bash(gh pr comment:*)` pattern covers a
 * `Bash(gh pr comment ...)` attempt, and a bare `Read` covers `Read`. Anything
 * it cannot match confidently is REPORTED rather than assumed fine — a
 * diagnostic that quietly decides something is covered is the failure mode this
 * whole file exists to end.
 */
export function isCovered(label, patterns) {
  if (!patterns) return true;
  if (patterns.includes(label)) return true;
  const bash = /^Bash\((.+)\)$/.exec(label);
  if (!bash) return false;
  const attempted = bash[1];
  return patterns.some((p) => {
    const pm = /^Bash\((.+?):?\*?\)$/.exec(p);
    if (!pm) return false;
    const prefix = pm[1].replace(/:\*$/, '').trim();
    return attempted === prefix || attempted.startsWith(prefix + ' ');
  });
}

export function summarize(messages, patterns) {
  const result = messages.find((m) => m?.type === 'result') ?? {};
  const attempted = attemptedTools(messages);
  const uncovered = [...attempted.keys()].filter((t) => !isCovered(t, patterns));
  return { result, attempted, errors: errorResults(messages), uncovered };
}

function main() {
  const [, , file, workflow = DEFAULT_WORKFLOW] = process.argv;

  if (!file || !existsSync(file)) {
    console.log(`review-run: no execution file at ${file ?? '(none given)'} — nothing to summarise.`);
    console.log('  The action did not produce one. That itself is worth knowing: it means the');
    console.log('  agent never ran, rather than ran and stayed quiet.');
    process.exit(0);
  }

  const messages = parseTranscript(readFileSync(file, 'utf8'));
  const patterns = existsSync(workflow) ? allowedPatterns(readFileSync(workflow, 'utf8')) : null;
  const { result, attempted, errors, uncovered } = summarize(messages, patterns);

  console.log('── review run ──────────────────────────────────────────');
  console.log(
    `  turns ${result.num_turns ?? '?'} · $${(result.total_cost_usd ?? 0).toFixed(2)} · ` +
      `denials ${result.permission_denials_count ?? '?'} · ${result.subtype ?? '?'}`,
  );

  console.log('\n  tools attempted:');
  if (attempted.size === 0) {
    console.log('    (none — the agent produced no tool calls at all)');
  } else {
    for (const [name, n] of [...attempted].sort((a, b) => b[1] - a[1])) {
      console.log(`    ${String(n).padStart(3)}×  ${name}${uncovered.includes(name) ? '   ← NOT ALLOWED' : ''}`);
    }
  }

  if (errors.length) {
    console.log('\n  tool errors:');
    for (const e of errors) console.log(`    - ${e.replace(/\n/g, ' ')}`);
  }

  if (uncovered.length) {
    console.log('\n  ⚠  These were attempted and the allowlist does not cover them:');
    for (const t of uncovered) console.log(`       ${t}`);
    console.log('     Add them to `--allowedTools` in the workflow, or accept that the');
    console.log('     review cannot do that thing. A denied reporting tool is how this job');
    console.log('     has looked green while saying nothing, four times now.');
  } else if (patterns) {
    console.log('\n  every attempted tool is covered by the allowlist.');
  }
  console.log('────────────────────────────────────────────────────────');
  process.exit(0);
}

if (process.argv[1] && process.argv[1].endsWith('summarize-review-run.mjs')) main();
