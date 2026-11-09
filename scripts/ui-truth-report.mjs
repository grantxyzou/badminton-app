#!/usr/bin/env node
// UI truth report — the deterministic half of the `ui-truth` skill.
//
// Reads, never writes code: runs the design-token lint and the UI canaries,
// and compares the counts with the previous run so a scheduled review can say
// what CHANGED rather than re-listing the same backlog every week.
//
//   node scripts/ui-truth-report.mjs            # print markdown, save snapshot
//   node scripts/ui-truth-report.mjs --no-save  # print only
//   node scripts/ui-truth-report.mjs --json     # machine-readable
//
// The snapshot lives in .claude/ui-truth.local.json (gitignored by the
// `.claude/*.local.json` rule), so each machine compares against its own last run.

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();
const SNAPSHOT = '.claude/ui-truth.local.json';
const args = new Set(process.argv.slice(2));

// The canaries that hold the UI to the design system. A source scan is the only
// way the suite can see layout (jsdom computes every length as 0px).
export const UI_CANARIES = [
  'design-canary',
  'spacing-canary',
  'card-spacing-canary',
  'loading-canary',
  'sheet-size-canary',
  'sheet-close-canary',
  'foldable-layout-canary',
  'glass-hover-canary',
  'touch-feel-canary',
  'tab-fallback-canary',
  'scroll-jank-canary',
  'voice-canary',
];

// Map an ESLint token-guardrail message to a short category.
export function categorize(message) {
  if (/hex color/i.test(message)) return 'hex colour';
  if (/border-radius/i.test(message)) return 'radius';
  if (/font-size/i.test(message)) return 'font size';
  if (/rgba/i.test(message)) return 'rgba';
  if (/text-size class/i.test(message)) return 'text class';
  if (/spacing value/i.test(message)) return 'spacing';
  return null;
}

function area(file) {
  const rel = relative(ROOT, file);
  const parts = rel.split('/');
  if (parts.length > 2 && (parts[0] === 'components' || parts[0] === 'app')) return `${parts[0]}/${parts[1]}`;
  return parts.length > 1 ? `${parts[0]}/ (root)` : parts[0];
}

function lintDrift() {
  const res = spawnSync('npx', ['eslint', 'app', 'components', 'lib', '-f', 'json'], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  let results;
  try {
    results = JSON.parse(res.stdout);
  } catch {
    return { error: 'eslint did not return JSON', total: null, byCategory: {}, byArea: {} };
  }
  const byCategory = {};
  const byArea = {};
  let total = 0;
  let errors = 0;
  for (const f of results) {
    for (const m of f.messages) {
      if (m.ruleId !== 'no-restricted-syntax') continue;
      const cat = categorize(m.message);
      if (!cat) continue;
      total++;
      if (m.severity === 2) errors++;
      byCategory[cat] = (byCategory[cat] ?? 0) + 1;
      const a = area(f.filePath);
      byArea[a] = (byArea[a] ?? 0) + 1;
    }
  }
  return { total, errors, byCategory, byArea };
}

function canaries() {
  const files = UI_CANARIES.map((c) => `__tests__/${c}.test.ts`).filter((p) => existsSync(p));
  const outFile = join(tmpdir(), `ui-truth-${process.pid}.json`);
  spawnSync('npx', ['vitest', 'run', ...files, '--reporter=json', `--outputFile=${outFile}`], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  try {
    const out = JSON.parse(readFileSync(outFile, 'utf8'));
    rmSync(outFile, { force: true });
    const failing = out.testResults
      .filter((t) => t.status !== 'passed')
      .map((t) => relative(ROOT, t.name));
    return { ran: files.length, failing };
  } catch {
    return { ran: files.length, failing: ['(vitest output unreadable — run the canaries by hand)'] };
  }
}

function changedUiFiles(sinceIso) {
  if (!sinceIso) return [];
  try {
    const out = execFileSync(
      'git',
      ['log', `--since=${sinceIso}`, '--name-only', '--pretty=format:', '--', 'app/globals.css', 'components', 'app'],
      { encoding: 'utf8' },
    );
    return [...new Set(out.split('\n').filter(Boolean))];
  } catch {
    return [];
  }
}

export function delta(now, before) {
  if (before == null || now == null) return '';
  const d = now - before;
  return d === 0 ? ' (=)' : d > 0 ? ` (+${d})` : ` (${d})`;
}

function main() {
  const prev = existsSync(SNAPSHOT) ? JSON.parse(readFileSync(SNAPSHOT, 'utf8')) : null;
  const lint = lintDrift();
  const canary = canaries();
  const changed = changedUiFiles(prev?.at);
  const snap = { at: new Date().toISOString(), lint, canary };

  if (args.has('--json')) {
    console.log(JSON.stringify({ ...snap, previous: prev?.at ?? null, changedUiFiles: changed }, null, 2));
  } else {
    const lines = [];
    lines.push(`## UI truth report — ${snap.at.slice(0, 10)}`);
    lines.push(prev ? `Compared with ${prev.at.slice(0, 10)}.` : 'First run — no previous snapshot.');
    lines.push('');
    lines.push(`**Canaries:** ${canary.ran} run, ${canary.failing.length} failing`);
    for (const f of canary.failing) lines.push(`- ❌ ${f}`);
    lines.push('');
    lines.push(`**Token drift (lint):** ${lint.total ?? '?'}${delta(lint.total, prev?.lint?.total)} — ${lint.errors ?? 0} errors`);
    for (const [k, v] of Object.entries(lint.byCategory).sort((a, b) => b[1] - a[1])) {
      lines.push(`- ${k}: ${v}${delta(v, prev ? prev.lint?.byCategory?.[k] ?? 0 : null)}`);
    }
    lines.push('');
    lines.push('**Where:**');
    for (const [k, v] of Object.entries(lint.byArea).sort((a, b) => b[1] - a[1]).slice(0, 10)) {
      lines.push(`- ${k}: ${v}${delta(v, prev ? prev.lint?.byArea?.[k] ?? 0 : null)}`);
    }
    if (changed.length) {
      lines.push('');
      lines.push(`**UI files changed since last run (${changed.length})** — screens to look at:`);
      for (const f of changed.slice(0, 25)) lines.push(`- ${f}`);
    }
    console.log(lines.join('\n'));
  }

  if (!args.has('--no-save')) writeFileSync(SNAPSHOT, JSON.stringify(snap, null, 2) + '\n');
  // Exit non-zero only on a failing canary: drift is a backlog, not a break.
  process.exitCode = canary.failing.length ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
