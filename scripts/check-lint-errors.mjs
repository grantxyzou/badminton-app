#!/usr/bin/env node
/**
 * Lint the file that was just edited, and report ERRORS only.
 *
 * WHY ERRORS ONLY
 * ---------------
 * This repo's baseline is 0 errors / 371 warnings, and the warning count is
 * explicitly NOT a regression signal — CLAUDE.md says so, because the token
 * guardrails are warn-level app-wide and tighten to error only per cleared
 * area. So a warning here would be noise on every single edit, while an error
 * is unambiguous: it was not there before.
 *
 * WHY PER-FILE AND NOT THE WHOLE REPO
 * -----------------------------------
 * `npm run lint` takes tens of seconds. Run on every Edit that would be
 * intolerable, so this reads the edited path from the hook payload on stdin
 * and lints exactly that one file — typically under a second.
 *
 * WHAT IT CATCHES THAT THE SUITE DOES NOT
 * ---------------------------------------
 * Removing a component can strand the imports it was the last consumer of.
 * That happened on 2026-08-27: deleting an inline card from HomeTab left
 * `StatusBadge` and `CardHeader` unused, taking lint from 0 errors to 2. Tests
 * and tsc both stayed green — unused imports are neither a type error nor a
 * behaviour change — so nothing but lint could have said so.
 *
 * Exit codes:
 *   0 — clean, or not a lintable file (silent)
 *   1 — at least one ERROR (prints them)
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

function readStdin() {
  try {
    return readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

const raw = readStdin();
if (!raw.trim()) process.exit(0);

let filePath = null;
try {
  const payload = JSON.parse(raw);
  filePath = payload?.tool_input?.file_path ?? payload?.tool_input?.filePath ?? null;
} catch {
  // A payload shape we do not recognise is not a reason to fail an edit.
  process.exit(0);
}

// Only source files ESLint is configured for. Notably NOT messages/*.json —
// that has its own checker, and linting JSON here would just be noise.
if (!filePath || !/\.(ts|tsx|js|jsx|mjs)$/.test(filePath)) process.exit(0);

let result = null;
let eslintFailed = null;
try {
  // `json`, not `compact`: the compact formatter was removed from core in
  // ESLint 9, and asking for it makes eslint exit 2 with a message on stderr.
  // The first version of this script parsed that as "no errors found" and
  // silently passed everything — a gate that cannot fail is worse than none.
  const out = execFileSync(
    'npx',
    ['eslint', '--format', 'json', '--no-warn-ignored', filePath],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  );
  result = JSON.parse(out);
} catch (err) {
  // eslint exits 1 when it FOUND problems and 2 when eslint ITSELF failed
  // (bad config, unknown formatter, unreadable file). Those are different
  // things and conflating them is how the gate goes quietly blind.
  const stdout = err.stdout ?? '';
  if (err.status === 2 || !stdout.trim()) {
    eslintFailed = (err.stderr ?? '').trim() || `eslint exited ${err.status}`;
  } else {
    try {
      result = JSON.parse(stdout);
    } catch {
      eslintFailed = 'eslint produced output this hook could not parse';
    }
  }
}

if (eslintFailed) {
  console.error(`\nLint gate could not run on ${filePath}:\n  ${eslintFailed}\n`);
  process.exit(1);
}

const errors = (result ?? [])
  .flatMap((file) => (file.messages ?? []).map((msg) => ({ ...msg, filePath: file.filePath })))
  .filter((msg) => msg.severity === 2);

if (errors.length === 0) process.exit(0); // warnings only — that is the baseline

console.error(`\nLint ERRORS introduced in ${filePath}:\n`);
for (const e of errors) {
  console.error(`  ${e.line}:${e.column}  ${e.message}  (${e.ruleId ?? 'unknown'})`);
}
console.error(
  '\nThe repo baseline is 0 errors, so these are new. Warnings are ignored here on purpose.\n' +
    'Most common cause after deleting UI: an import whose last consumer just went away.\n',
);
process.exit(1);
