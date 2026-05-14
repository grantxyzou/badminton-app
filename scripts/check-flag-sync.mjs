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
 * Stable workflow is NOT checked — flags absent from deploy-stable.yml are
 * intentionally "off in stable" by virtue of `undefined` reading as off.
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

  const missingFromDeploy = [...registered].filter((f) => !deployed.has(f)).sort();
  const staleInDeploy = [...deployed].filter((f) => !registered.has(f)).sort();

  if (missingFromDeploy.length === 0 && staleInDeploy.length === 0) {
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
  process.exit(1);
}

main();
