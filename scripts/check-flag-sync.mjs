#!/usr/bin/env node
/**
 * Check that every flag in lib/flags.ts's FlagName union is also wired up
 * in .github/workflows/deploy-next.yml.
 *
 * Why: NEXT_PUBLIC_* env vars are baked at build time, so a flag registered
 * in TypeScript but absent from the deploy workflow stays silently off on
 * bpm-next forever. This bit us with NEXT_PUBLIC_FLAG_SETTLE (registered
 * during v1.4, never enabled on next for ~2 weeks).
 *
 * There used to be a second workflow (deploy-stable.yml) which this script
 * deliberately did NOT check, since a flag absent from it read as off there.
 * That workflow and its app service were deleted 2026-08-25 — deploy-next.yml
 * is now the only deploy target, so this check covers everything that ships.
 *
 * Wired as a PostToolUse hook on Edit|Write — see .claude/settings.json.
 * The script is intentionally cheap (two file reads, two regex passes) so
 * running it on every edit is free.
 *
 * Exit codes:
 *   0 — synced (silent)
 *   1 — drift detected (prints actionable diff)
 */
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FLAGS_FILE = join(ROOT, 'lib/flags.ts');
const SETTINGS_FILE = join(ROOT, '.claude/flag-sync.local.md');
const DEFAULT_WORKFLOW = '.github/workflows/deploy-next.yml';
/**
 * CI must BUILD what production builds. This script only ever read the deploy
 * workflow, so pr-ci.yml drifted unnoticed until 2026-08-28 — by then it was
 * missing THIRTEEN flags, meaning every PR compiled a materially different app
 * than the one that ships, and a flag-gated build break could pass CI and fail
 * on deploy.
 */
const CI_WORKFLOW = '.github/workflows/pr-ci.yml';

/**
 * Plugin-settings pattern: read `.claude/flag-sync.local.md` for per-project
 * overrides. Returns null if no file (use defaults), returns a frontmatter map
 * otherwise. Quietly tolerates malformed input — silence > noise for a
 * config file most contributors won't think about.
 */
function readSettings() {
  if (!existsSync(SETTINGS_FILE)) return null;
  try {
    const src = readFileSync(SETTINGS_FILE, 'utf8');
    const m = src.match(/^---\n([\s\S]*?)\n---/);
    if (!m) return {};
    const out = {};
    for (const line of m[1].split('\n')) {
      const kv = line.match(/^([a-z_]+):\s*(.+?)\s*$/);
      if (!kv) continue;
      let value = kv[2];
      if (value === 'true') value = true;
      else if (value === 'false') value = false;
      out[kv[1]] = value;
    }
    return out;
  } catch {
    return {};
  }
}

function extractFromFlagsTs(src) {
  const unionMatch = src.match(/export type FlagName\s*=([\s\S]*?);/);
  if (!unionMatch) return new Set();
  const out = new Set();
  const re = /'(NEXT_PUBLIC_FLAG_[A-Z0-9_]+)'/g;
  let m;
  while ((m = re.exec(unionMatch[1]))) out.add(m[1]);
  return out;
}

function extractFromWorkflow(src) {
  const out = new Set();
  const re = /^\s+(NEXT_PUBLIC_FLAG_[A-Z0-9_]+):/gm;
  let m;
  while ((m = re.exec(src))) out.add(m[1]);
  return out;
}

/**
 * Flags whose removal date has passed.
 *
 * Reported, never blocking. Being late to delete a flag is a backlog item, not
 * a broken build — and a hook that failed on it would be muted within a week,
 * which is how the previous system died: eleven flags said "after X is promoted
 * to stable", that promotion stopped existing on 2026-08-25, and nothing
 * anywhere could tell.
 */
function overdueFlags(src, today) {
  /* Split on entry headers FIRST, then read each block in isolation.
     A single `NEXT_PUBLIC_FLAG_X: {[\s\S]*?plannedRemoval: '<date>'` regex is
     wrong and looked right: non-greedy bounds how far it searches, not where it
     stops, so an entry whose own value is not a date (DESIGN_PREVIEW: 'never')
     let the scan run on into the NEXT entry and pair one flag's name with
     another flag's date. It reported DESIGN_PREVIEW as due on COMMAND_CENTER's
     date and dropped COMMAND_CENTER entirely — with a plausible-looking count. */
  const out = [];
  const blocks = src.split(/^  (?=NEXT_PUBLIC_FLAG_[A-Z_]+: \{)/m);
  for (const block of blocks) {
    const name = block.match(/^(NEXT_PUBLIC_FLAG_[A-Z_]+): \{/);
    if (!name) continue;
    const due = block.match(/plannedRemoval:\s*'(\d{4}-\d{2}-\d{2})'/);
    if (due && due[1] < today) out.push({ flag: name[1], due: due[1] });
  }
  return out.sort((a, b) => (a.due < b.due ? -1 : 1));
}

function main() {
  const settings = readSettings() ?? {};
  if (settings.enabled === false) process.exit(0);
  const workflowPath = settings.workflow_path || DEFAULT_WORKFLOW;
  const workflowFile = join(ROOT, workflowPath);

  let registered, deployed;
  try {
    registered = extractFromFlagsTs(readFileSync(FLAGS_FILE, 'utf8'));
    deployed = extractFromWorkflow(readFileSync(workflowFile, 'utf8'));
  } catch (err) {
    console.error(`[flag-sync] could not read source files: ${err.message}`);
    process.exit(0);
  }

  // The CI workflow is compared against the DEPLOY workflow, not against
  // flags.ts: its job is to mirror what ships, and a flag deliberately absent
  // from deploy should be absent here too.
  let ciDrift = [];
  try {
    const ci = extractFromWorkflow(readFileSync(join(ROOT, CI_WORKFLOW), 'utf8'));
    ciDrift = [...deployed].filter((f) => !ci.has(f)).sort();
  } catch {
    // No CI workflow is not an error — this hook must never block on absence.
  }

  const missingFromDeploy = [...registered].filter((f) => !deployed.has(f)).sort();
  const staleInDeploy = [...deployed].filter((f) => !registered.has(f)).sort();

  const overdue = overdueFlags(
    readFileSync(FLAGS_FILE, 'utf8'),
    new Date().toISOString().slice(0, 10),
  );
  if (overdue.length > 0) {
    console.error('');
    console.error(`\u2139\ufe0f  ${overdue.length} feature flag(s) are past their removal date:`);
    for (const { flag, due } of overdue) console.error(`    - ${flag}  (due ${due})`);
    console.error('');
    console.error('  \u2192 Not a failure. Retiring one means deleting the flag from');
    console.error('    lib/flags.ts, both workflows, and its `off` branch in the code.');
    console.error('');
  }

  if (missingFromDeploy.length === 0 && staleInDeploy.length === 0 && ciDrift.length === 0) {
    process.exit(0);
  }

  console.error('');
  console.error('⚠️  Feature flag / deploy-next.yml drift detected:');
  console.error('');
  if (missingFromDeploy.length > 0) {
    console.error('  Registered in lib/flags.ts but MISSING from deploy-next.yml:');
    for (const flag of missingFromDeploy) console.error(`    - ${flag}`);
    console.error('');
    console.error('  → These features are silently OFF on bpm-next. Add them to');
    console.error('    .github/workflows/deploy-next.yml under env: with the value');
    console.error("    'true' (or 'false' if you want them off but tracked).");
    console.error('');
  }
  if (staleInDeploy.length > 0) {
    console.error('  Listed in deploy-next.yml but NOT in lib/flags.ts FlagName union:');
    for (const flag of staleInDeploy) console.error(`    - ${flag}`);
    console.error('');
    console.error('  → These flags were retired in code but the workflow still');
    console.error('    references them. Remove from deploy-next.yml.');
    console.error('');
  }
  if (ciDrift.length > 0) {
    console.error('  In deploy-next.yml but MISSING from pr-ci.yml:');
    for (const flag of ciDrift) console.error(`    - ${flag}`);
    console.error('');
    console.error('  → PR builds are compiling a DIFFERENT app than the one that');
    console.error('    ships, so a flag-gated build break can pass CI and fail on');
    console.error('    deploy. Mirror them into .github/workflows/pr-ci.yml.');
    console.error('');
  }
  process.exit(1);
}

main();
