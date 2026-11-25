#!/usr/bin/env node
/**
 * Turn a tour's `e2e-results/results.json` into a short Markdown report: one
 * row per persona, then every finding grouped by kind. CI appends it to the
 * job summary (`$GITHUB_STEP_SUMMARY`), so a run reads at a glance without
 * opening the artifact.
 *
 *   node e2e/summary.mjs [e2e-results/results.json]
 *
 * Prints to stdout. Labels and paths only: a finding never carries a query
 * string, a password or an address (`e2e/capture.ts`).
 */
import { readFileSync } from 'node:fs';

const file = process.argv[2] ?? 'e2e-results/results.json';
let report;
try {
  report = JSON.parse(readFileSync(file, 'utf8'));
} catch {
  console.log(`No tour results at \`${file}\`: the run stopped before any test reported.`);
  process.exit(0);
}

/**
 * Text made safe for one Markdown table cell: colour codes dropped, then
 * backslashes escaped BEFORE pipes, or a message ending in `\` would turn our
 * `\|` back into a column break.
 */
function cell(text) {
  return String(text)
    .replace(/\x1b\[[0-9;]*m/g, '')
    .replace(/[\r\n]+/g, ' ')
    .replace(/\\/g, '\\\\')
    .replace(/\|/g, '\\|');
}

const rows = [];
const findings = new Map(); // "severity kind" -> Set of "[screen] detail"
const walk = (suite) => {
  for (const spec of suite.specs ?? []) {
    for (const t of spec.tests ?? []) {
      const res = t.results?.[t.results.length - 1];
      if (!res) continue;
      let errors = 0;
      let warnings = 0;
      for (const a of res.annotations ?? []) {
        const m = /^(error|warning):(.+)$/.exec(a.type);
        if (!m) continue;
        if (m[1] === 'error') errors += 1;
        else warnings += 1;
        const key = `${m[1]} ${m[2]}`;
        if (!findings.has(key)) findings.set(key, new Set());
        findings.get(key).add(a.description ?? '');
      }
      const stopped = res.status !== 'passed' && errors === 0 ? (res.errors?.[0]?.message ?? '').split('\n')[0] : '';
      rows.push(`| ${cell(spec.title)} | ${res.status === 'passed' ? '✅ passed' : res.status === 'skipped' ? '⏭️ skipped' : '❌ ' + res.status} | ${errors} | ${warnings} | ${Math.round((res.duration ?? 0) / 1000)}s | ${cell(stopped.slice(0, 160))} |`);
    }
  }
  for (const child of suite.suites ?? []) walk(child);
};
for (const s of report.suites ?? []) walk(s);

const out = [];
out.push('## End-to-end tour');
out.push('');
out.push('| Persona | Result | Errors | Warnings | Time | Stopped on |');
out.push('|---|---|---|---|---|---|');
out.push(...rows);
out.push('');
const ordered = [...findings.entries()].sort(([a], [b]) => (a < b ? -1 : 1));
if (ordered.length === 0) {
  out.push('No findings.');
} else {
  for (const [key, details] of ordered) {
    const [severity, kind] = key.split(' ');
    out.push(`<details${severity === 'error' ? ' open' : ''}><summary><b>${severity}</b> · ${kind} (${details.size})</summary>`);
    out.push('');
    for (const d of [...details].slice(0, 30)) out.push(`- \`${d.replace(/`/g, "'")}\``);
    if (details.size > 30) out.push(`- …and ${details.size - 30} more`);
    out.push('');
    out.push('</details>');
  }
}
out.push('');
out.push('Screenshots, traces and the HTML report are in the run\'s `e2e-results` artifact.');
console.log(out.join('\n'));
