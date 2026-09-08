#!/usr/bin/env node
/**
 * Report plan docs whose review date has passed.
 *
 * Why this exists, in one sentence from CLAUDE.md: "a written criterion with no
 * scheduled read date is a note, not a gate."
 *
 * `docs/plans/value-hub-slice-0.md` is the worked example of the failure. It
 * carried a real kill criterion, written honestly and in advance, and it went
 * unread for about nine weeks — long enough that three of the four tracks it was
 * meant to gate had already shipped, so the fan-out decision got made by
 * building rather than by reading. Nothing was wrong with the criterion. Nothing
 * surfaced it.
 *
 * This is the flag-retirement mechanism generalised. Flags used to carry prose
 * conditions ("after X is promoted and lived-in for two weeks") and eleven of
 * them became un-retireable when the promotion event stopped existing — nobody
 * notices a sentence quietly becoming false, whereas anybody notices a date in
 * the past. Swapping prose for `plannedRemoval` dates plus a script that reports
 * overdue ones is what fixed it. Plans have the same shape of promise and had
 * none of the machinery.
 *
 * REPORTS, never blocks. Being late on a read is a backlog, not a broken build,
 * and a check that failed the suite over an overdue doc would be muted within a
 * week — which is exactly how you end up with a gate that reads as on and does
 * nothing. Silent when there is nothing to say, so a clean repo starts a quiet
 * session.
 *
 * Wired into .claude/hooks/session-start.sh beside check-flag-sync.mjs.
 *
 * Exit codes:
 *   0 — nothing overdue (silent)
 *   1 — at least one plan is due (prints which, and why it matters)
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PLANS_DIR = join(ROOT, 'docs/plans');

/** `**Review on:** 2026-10-07` — the whole contract. */
const REVIEW_LINE = /^\*\*Review on:\*\*\s*(\d{4}-\d{2}-\d{2})/m;
/** Optional one-liner saying what the reader is being asked to decide. */
const REVIEW_ASK = /^\*\*Review on:\*\*\s*\d{4}-\d{2}-\d{2}\s*—\s*(.+)$/m;

/**
 * A real calendar day, not merely a well-shaped string. `2026-06-31` matches the
 * regex above and is not a date; the flags test learned this the same way.
 */
function isRealDate(iso) {
  const d = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso;
}

export function overduePlans(dir, today) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.md') || name === 'TEMPLATE.md') continue;
    const src = readFileSync(join(dir, name), 'utf8');
    const m = REVIEW_LINE.exec(src);
    // No review line is not a violation. Plenty of plans are finished records
    // with nothing left to decide, and demanding a date on all of them would
    // make the field ceremonial — which is the failure this is meant to avoid,
    // not reproduce.
    if (!m) continue;
    const due = m[1];
    if (!isRealDate(due)) {
      out.push({ plan: name, due, ask: 'the review date is not a real day', malformed: true });
      continue;
    }
    if (due <= today) {
      const ask = REVIEW_ASK.exec(src);
      out.push({ plan: name, due, ask: ask ? ask[1].trim() : null, malformed: false });
    }
  }
  return out.sort((a, b) => a.due.localeCompare(b.due));
}

function main() {
  const today = new Date().toISOString().slice(0, 10);
  const due = overduePlans(PLANS_DIR, today);
  if (due.length === 0) process.exit(0);

  console.error(`ℹ️  ${due.length} plan(s) are due for a review:`);
  for (const { plan, due: d, ask, malformed } of due) {
    console.error(`    - docs/plans/${plan}  (${malformed ? 'BAD DATE' : `due ${d}`})`);
    if (ask) console.error(`        ${ask}`);
  }
  console.error('');
  console.error('   Read it, act or decide, then move the date forward or remove the line.');
  console.error('   A criterion nobody reads back is a note, not a gate.');
  process.exit(1);
}

// Importable for tests; only self-executes when run directly.
if (process.argv[1] && process.argv[1].endsWith('check-plan-reviews.mjs')) main();
