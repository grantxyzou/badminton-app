#!/usr/bin/env node
/**
 * Refuse a `git commit` whose STAGED diff carries a secret, or stages a file
 * that should never be committed.
 *
 * WHY A HOOK AND NOT A MEMORY NOTE
 * --------------------------------
 * This repo leaked a real credential once: `sed -i.bak` on `.env.local` left
 * `.env.local.bak` beside it, `.gitignore` covered `.env.local` and not the
 * backup, and it went out in a release commit. `*.bak` is gitignored now, but
 * that fixes one spelling of the mistake. The general shape — a copy of a
 * secret-bearing file under a name the ignore list did not anticipate — is
 * exactly what a person will not notice at commit time, because they were
 * looking at the change, not the file list.
 *
 * Every other hook in scripts/ was written after a burn. This one was the
 * only recorded burn with no hook.
 *
 * WHAT IT CHECKS (staged content only — the working tree is not the question)
 * ------------------------------------------------------------------------
 *   1. Paths: anything named like an env file (`.env`, `.env.local`,
 *      `.env.production`, …) or a backup (`*.bak`, `*.orig`, `*~`).
 *      `.env.local.example` is allowed by name — it is the documented template.
 *   2. Content: added lines matching well-known credential shapes — a Cosmos
 *      `AccountKey=`, an Anthropic `sk-ant-`, a GitHub `ghp_`/`github_pat_`,
 *      a private-key PEM header, or a `SESSION_SECRET` / `VAPID_PRIVATE_KEY` /
 *      `*_CONNECTION_STRING` assignment with a real-looking value.
 *
 * Deliberately narrow. A broad entropy scan would flare on every hash in
 * `package-lock.json` and be muted within a week — the fate of any gate that
 * fires on legitimate work.
 *
 * Wired as a PreToolUse hook on Bash — see .claude/settings.json. Only acts
 * when the command is a `git commit`; everything else passes untouched.
 *
 * Exit codes:
 *   0 — allowed (silent)
 *   2 — blocked, with the reason
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

let command = '';
let cwd = process.cwd();
try {
  const payload = JSON.parse(raw);
  command = payload?.tool_input?.command ?? '';
  cwd = payload?.cwd ?? cwd;
} catch {
  process.exit(0);
}
if (!/\bgit\b[^|;&]*\bcommit\b/.test(command)) process.exit(0);

function git(args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
}

let paths = '';
let diff = '';
try {
  paths = git(['diff', '--cached', '--name-only', '--diff-filter=ACMR']);
  diff = git(['diff', '--cached', '-U0', '--diff-filter=ACMR']);
} catch {
  // Not a git repo, or nothing staged — nothing this hook can say.
  process.exit(0);
}

const FORBIDDEN_PATH = /(^|\/)\.env(\.[^/]*)?$|\.(bak|orig)$|~$/;
const ALLOWED_PATH = /(^|\/)\.env\.local\.example$/;
const badPaths = paths
  .split('\n')
  .filter(Boolean)
  .filter((p) => FORBIDDEN_PATH.test(p) && !ALLOWED_PATH.test(p));

const SECRET_LINE = [
  { re: /AccountKey=[A-Za-z0-9+/=]{20,}/, what: 'a Cosmos DB account key' },
  { re: /sk-ant-[A-Za-z0-9_-]{20,}/, what: 'an Anthropic API key' },
  { re: /\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}/, what: 'a GitHub token' },
  { re: /-----BEGIN (RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/, what: 'a private key' },
  { re: /\b(SESSION_SECRET|VAPID_PRIVATE_KEY|[A-Z_]*CONNECTION_STRING)\s*[=:]\s*["']?[A-Za-z0-9+/=_.:;-]{16,}/, what: 'a secret assignment' },
];
const hits = [];
let file = '';
for (const line of diff.split('\n')) {
  if (line.startsWith('+++ ')) {
    file = line.slice(4).replace(/^b\//, '');
    continue;
  }
  if (!line.startsWith('+') || line.startsWith('+++')) continue;
  for (const { re, what } of SECRET_LINE) {
    if (re.test(line)) {
      hits.push(`${file}: ${what}`);
      break;
    }
  }
}

if (badPaths.length === 0 && hits.length === 0) process.exit(0);

console.error('\nBlocked: this commit would publish a secret.\n');
for (const p of badPaths) console.error(`  - staged file that must never be committed: ${p}`);
for (const h of [...new Set(hits)]) console.error(`  - added line looks like ${h}`);
console.error(
  '\nUnstage it (`git restore --staged <path>`) and, if the value is real, treat it\n' +
    'as exposed: rotate it. A secret in a commit that never gets pushed is still\n' +
    'a secret in a reflog. This hook only reads the STAGED diff, so a clean\n' +
    'working tree is not the question — the index is.\n',
);
process.exit(2);
