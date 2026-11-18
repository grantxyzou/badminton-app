#!/usr/bin/env node
/**
 * Before `gh pr create`, warn when the branch touches sign-in, money or an
 * admin power, and say to run Claude Security's "Scan changes" first.
 *
 * WHY A HOOK
 * ----------
 * The 2026-11-17 scan found 32 issues, and every HIGH one was in those three
 * areas. The review bot answered "No issues found" on all five PRs that fixed
 * them, while the scan and a local review found real holes, twice in the
 * fixes themselves. So the bot is not the security check, and remembering to
 * scan is exactly what slips (`.claude/rules/security.md`).
 *
 * WHY A WARNING, NOT A BLOCK
 * --------------------------
 * A scan costs real money (Grant, 2026-11-18: "Warning only"). A hard block
 * would push scans onto PRs that do not need one, and a gate that fires on
 * work it should not stop gets muted.
 *
 * WHAT IT DOES
 * ------------
 * Only for a Bash command containing `gh pr create`. It lists the files the
 * branch changes against its base (`origin/main`, else `main`), committed or
 * not, and if any matches `SENSITIVE` it prints one JSON object: a
 * `systemMessage` for the person and `additionalContext` for Claude. It never
 * sets a permission decision, so the normal permission flow is untouched.
 *
 * Exit code: always 0. A git failure (no base, not a repo) is silence.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

export const SENSITIVE = [
  // Sign-in and the caller's identity.
  /^lib\/auth[\w.-]*\.ts$/,
  /^lib\/(pinLockout|emailProof|emailCode|onBehalfGuard|accountPad|memberRecoveryCode|passwordHash|recoveryHash|operator|oauthCallback|authHandoff|askSecret)\.ts$/,
  /^proxy\.ts$/,
  /^app\/api\/auth\//,
  /^app\/api\/players\/(route\.ts$|recover\/|reset-access\/)/,
  /^app\/api\/members\//,
  // Admin and operator powers.
  /^app\/api\/admin\//,
  /^app\/api\/operator\//,
  /^app\/api\/groups\/members\//,
  // Money.
  /^lib\/(paymentsInbox|etransfer\w*|cardPay|ledger\w*|aliases|owedBalance|credit\w*)\.ts$/,
  /^app\/api\/(payments|aliases|ledger|credit)\//,
];

function readStdin() {
  try {
    return readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

function changedFiles(cwd) {
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  for (const base of ['origin/main', 'main']) {
    try {
      const mergeBase = git('merge-base', 'HEAD', base);
      const names = git('diff', '--name-only', mergeBase);
      return names ? names.split('\n') : [];
    } catch {
      // try the next base
    }
  }
  return [];
}

function main() {
  const raw = readStdin();
  if (!raw.trim()) return;
  let command = '';
  let cwd = process.cwd();
  try {
    const payload = JSON.parse(raw);
    command = payload?.tool_input?.command ?? '';
    cwd = payload?.cwd ?? cwd;
  } catch {
    return;
  }
  if (!/\bgh\s+pr\s+create\b/.test(command)) return;

  const hits = changedFiles(cwd).filter((f) => SENSITIVE.some((re) => re.test(f)));
  if (hits.length === 0) return;

  const shown = hits.slice(0, 8).join(', ') + (hits.length > 8 ? `, and ${hits.length - 8} more` : '');
  process.stdout.write(
    JSON.stringify({
      systemMessage:
        `Security: this PR touches sign-in, money or admin code (${shown}). ` +
        'The review bot is not a security review: run Claude Security "Scan changes" on it before merging.',
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        additionalContext:
          `This branch changes security-sensitive files: ${shown}. ` +
          '.claude/rules/security.md says such a PR runs Claude Security "Scan changes" before merge; ' +
          'the cheaper one-pass review is the security-reviewer agent (.claude/agents/security-reviewer.md). ' +
          'The PR body should say which ran.',
      },
    }),
  );
}

main();
