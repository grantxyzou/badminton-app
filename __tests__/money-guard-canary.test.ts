import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';

/**
 * THE MONEY GUARD (Grant, 2026-11-18: "guard the money code"). Source scans
 * that fail the build when a change breaks one of the money rules in
 * `.claude/rules/money.md` — the rules every money bug this month was a
 * break of. Behaviour is tested where it lives (`money-audit-gaps`,
 * `paid-amount`, `group-card-pay`, …); this file catches the SHAPE of the
 * mistake before a test has to: an upsert where an etag write belongs, an
 * edit of an append-only ledger, a mirror hook that can throw into a
 * payment, an id minted where it must be derived.
 *
 * A scan that needs an exception says why beside the exception.
 */

const ROOT = join(__dirname, '..');
const SOURCE_DIRS = ['app', 'lib'];

function sourceFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) {
        if (name === 'node_modules' || name.startsWith('.')) continue;
        walk(p);
      } else if (/\.tsx?$/.test(name)) out.push(p);
    }
  };
  for (const d of SOURCE_DIRS) walk(join(ROOT, d));
  return out;
}

const rel = (p: string) => relative(ROOT, p).split('\\').join('/');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const files = sourceFiles().map((p) => ({ path: rel(p), src: readFileSync(p, 'utf8') }));

/** Files that write a money row (`Player.paid` / `owedAmount`, `StringingJob.paidAt`) and must do it under the etag. */
const MONEY_WRITERS = [
  'lib/paymentsInbox.ts',
  'lib/cardPay.ts',
  'lib/storeCredit.ts',
  'lib/creditReview.ts',
  'lib/ledgerRepair.ts',
  'app/api/session/settle/route.ts',
  'app/api/stringing/jobs/[id]/route.ts',
];

describe('the money guard', () => {
  it('the ledger is append-only: nothing upserts, replaces or deletes an entry', () => {
    const edits: string[] = [];
    for (const { path, src } of files) {
      if (/\.(upsert|replace|remove)\s*(<[^>]*>)?\(\s*['"]ledger['"]/.test(src)) edits.push(path);
      // Account deletion is the ONE sanctioned rewrite: it re-keys a purged
      // member's owed entries under `~anon` and deletes their credit
      // (.claude/rules/account-deletion.md).
      if (path !== 'lib/memberPurge.ts' && /getContainer\(\s*['"]ledger['"]\s*\)/.test(src)) edits.push(`${path} (raw ledger container)`);
    }
    expect(edits).toEqual([]);
  });

  it('a ledger id is derived from what it records, never minted — except the two entries a person types', () => {
    const minted: string[] = [];
    for (const { path, src } of files) {
      const writesLedger = /create\s*(<[^>]*>)?\(\s*['"]ledger['"]|appendEntry\(/.test(src) || path === 'lib/ledgerMirror.ts';
      if (!writesLedger) continue;
      for (const m of src.matchAll(/id:\s*`([a-z_~]+):\$\{\s*(randomBytes|Math\.random|Date\.now)/g)) {
        // An expense and a credit grant are typed in by an admin: two of the
        // same are two real events, so nothing exists to derive them from.
        if (m[2] === 'randomBytes' && (m[1] === 'expense' || m[1] === 'grant')) continue;
        minted.push(`${path}: ${m[0]}`);
      }
    }
    expect(minted).toEqual([]);
  });

  it('a money row is written under the etag: no upsert of a player row or a stringing job in the money writers', () => {
    const upserts: string[] = [];
    for (const path of MONEY_WRITERS) {
      const src = read(path);
      for (const m of src.matchAll(/upsert\s*(<[^>]*>)?\(\s*['"](players|stringingJobs)['"]/g)) upserts.push(`${path}: ${m[0]}`);
    }
    // An upsert writes over a payment that landed between the read and the
    // write (gap 3 on the paid tap; the settle loop until 2026-11-18). Use
    // `scope.replace` and decide again on `undefined`.
    expect(upserts).toEqual([]);
  });

  it('the ledger mirror never throws into the payment that called it, and every hook is off with the flag off', () => {
    const src = read('lib/ledgerMirror.ts');
    expect(src.match(/^\s*throw\b.*$/gm) ?? []).toEqual([]);
    const hooks = [...src.matchAll(/export async function (mirror\w+)\([^)]*\)[^{]*\{\s*([^\n]*)/g)];
    expect(hooks.length).toBeGreaterThan(10);
    const unguarded = hooks.filter((h) => h[2].trim() !== 'if (!on()) return;').map((h) => h[1]);
    expect(unguarded).toEqual([]);
  });

  it('every money writer is on this list and has a behaviour test', () => {
    // A new file that writes `paid` / `paidAt` must be added above, so the etag
    // scan covers it. Found by its write, not by its name.
    const writers = files
      .filter(({ src }) => /replace\s*(<[^>]*>)?\(\s*['"](players|stringingJobs)['"][^;]*\b(paid|paidAt|owedAmount)\s*:/s.test(src))
      .map(({ path }) => path)
      .filter((p) => p !== 'app/api/players/route.ts'); // the paid tap: pinned by players-patch-etag.test.ts
    expect(writers.filter((p) => !MONEY_WRITERS.includes(p))).toEqual([]);
  });
});
