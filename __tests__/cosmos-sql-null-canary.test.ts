import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * `!= null` IN A COSMOS QUERY MATCHES NOTHING, AND NO RUNTIME TEST CAN SEE IT.
 *
 * Cosmos evaluates a comparison between two different JSON types to Undefined,
 * and a WHERE clause excludes rows that evaluate to Undefined. So
 * `c.archivedAt != null` against a String column compares String-vs-Null,
 * yields Undefined for every row that HAS a value, and returns zero results —
 * the exact opposite of what it reads as.
 *
 * The suite is structurally blind to this. The mock store does not parse SQL at
 * all: it applies one filter per parameter NAME it recognises and ignores the
 * WHERE clause, so a predicate like this binds no parameter and is invisible.
 * The archive view shipped this way and passed every test in its own PR.
 *
 * `= null` is NOT flagged: Null-vs-Null is a same-type, well-defined
 * comparison, and `(NOT IS_DEFINED(c.x) OR c.x = null)` is the correct idiom
 * for "absent or explicitly null". Only the negation is broken.
 *
 * The fix is always `NOT IS_NULL(c.field)`.
 */
const ROOT = join(__dirname, '..');
const SCAN_DIRS = ['app', 'lib'].map((d) => join(ROOT, d));

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (full.endsWith('.ts') || full.endsWith('.tsx')) out.push(full);
  }
  return out;
}

describe('Cosmos SQL null comparisons', () => {
  it('never uses `!= null` in a query string', () => {
    const offenders: { file: string; snippet: string }[] = [];

    for (const file of SCAN_DIRS.flatMap(walk)) {
      // Comments first. The fix for this very bug carries a docblock quoting
      // the broken form in backticks to explain it, and a scanner that reads
      // prose reports the explanation as the defect.
      const src = readFileSync(file, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
      // Quoted string literals (single, double, or template) that look like a
      // Cosmos query. Comments are excluded by requiring the SQL shape inside
      // the same quoted run.
      for (const m of src.matchAll(/(['"`])((?:(?!\1)[\s\S])*?)\1/g)) {
        const body = m[2];
        // A Cosmos predicate, not necessarily a whole query: `ARCHIVED_SQL` is
        // a FRAGMENT interpolated into a template later and contains no
        // `FROM c` at all. Requiring one is how the first cut of this canary
        // sailed straight past the very bug it was written for — caught only
        // by re-introducing the bug and watching it stay green.
        if (!/\bc\.[A-Za-z_]/.test(body)) continue;
        if (/!=\s*null/i.test(body) || /<>\s*null/i.test(body)) {
          offenders.push({ file: file.replace(ROOT + '/', ''), snippet: body.trim().slice(0, 120) });
        }
      }
    }

    const message =
      offenders.length === 0
        ? ''
        : 'Cosmos `!= null` matches ZERO rows in production and passes every test:\n' +
          offenders.map((o) => `  - ${o.file}\n      ${o.snippet}`).join('\n') +
          '\nUse `NOT IS_NULL(c.field)` instead.';
    expect(offenders, message).toEqual([]);
  });
});
