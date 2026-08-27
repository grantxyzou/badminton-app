#!/usr/bin/env node
/**
 * Warn when a field disappears from `lib/types.ts`.
 *
 * WHY REMOVAL IS THE DANGEROUS DIRECTION
 * --------------------------------------
 * This repo deploys trunk-based: every push to `main` goes to production, and
 * a rollback re-dispatches the deploy workflow at an older SHA. That older
 * build runs against the SAME live Cosmos database — nothing is migrated
 * backwards. So the rule in CLAUDE.md is "additive and optional only", and the
 * reason is specifically about rollback: a field this build stopped writing is
 * a field the build you roll back TO still expects.
 *
 * Adding is safe. Renaming is a removal plus an addition, and reads as the
 * dangerous half here, correctly.
 *
 * WHY IT WARNS AND DOES NOT BLOCK
 * -------------------------------
 * Removals are sometimes right — a field that was never written to production,
 * or one being retired deliberately after a soak. A hook cannot tell those from
 * a mistake, and a gate that fires on legitimate work gets disabled. So it
 * exits 0 and prints; the point is that nobody removes a field without SEEING
 * that they did.
 *
 * Compares the working tree against HEAD, so it only ever speaks about the
 * change actually being made.
 *
 * Wired as a PostToolUse hook on Edit|Write — see .claude/settings.json.
 */
import { execFileSync } from 'node:child_process';

const FILE = 'lib/types.ts';

function gitShow(ref) {
  try {
    return execFileSync('git', ['show', `${ref}:${FILE}`], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return null;
  }
}

let current;
try {
  current = execFileSync('cat', [FILE], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
} catch {
  process.exit(0);
}
const previous = gitShow('HEAD');
// No git history to compare against (fresh clone, initial commit) — nothing to say.
if (previous === null || previous === current) process.exit(0);

/**
 * Field names declared in each interface.
 *
 * Deliberately crude — a regex over `  name?: type;` lines rather than a TS
 * parse. It only has to notice that a NAME went away; getting the type right
 * is not part of the question, and a parser here would be a dependency and a
 * maintenance cost for no extra signal.
 */
function fields(src) {
  const out = new Map();
  const blocks = src.split(/\n(?=export (?:interface|type) )/);
  for (const block of blocks) {
    const name = /export (?:interface|type) (\w+)/.exec(block)?.[1];
    if (!name) continue;
    const names = new Set();
    for (const m of block.matchAll(/^\s{2}(\w+)\??:/gm)) names.add(m[1]);
    out.set(name, names);
  }
  return out;
}

const before = fields(previous);
const after = fields(current);

const removed = [];
for (const [iface, names] of before) {
  const now = after.get(iface);
  // The whole interface going away is a bigger change than this hook is
  // scoped to judge, and is usually a deliberate deletion. Only report fields
  // vanishing from an interface that still exists.
  if (!now) continue;
  for (const n of names) if (!now.has(n)) removed.push(`${iface}.${n}`);
}

if (removed.length === 0) process.exit(0);

console.error('\nA field disappeared from lib/types.ts:\n');
for (const r of removed) console.error('  - ' + r);
console.error(
  '\nSchema changes here must be ADDITIVE AND OPTIONAL. Every push to main deploys,\n' +
    'and a rollback runs OLDER code against the SAME live database — so a field this\n' +
    'build stopped writing is one the build you roll back to still expects.\n' +
    'If the removal is deliberate (never written to production, or retired after a\n' +
    'soak), carry on — this is a warning, not a gate.\n',
);
process.exit(0);
