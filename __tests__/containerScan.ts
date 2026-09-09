import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

/**
 * Every Cosmos container name the app's source touches — the ONE scanner the
 * coverage canaries share (`member-purge-coverage`, `group-scope-coverage`).
 *
 * It used to be pasted per canary. The next regex gap (a double-quoted
 * argument, a name with a digit, an imported constant) would then get patched
 * in whichever canary failed first while the others kept passing with the
 * container unclassified — and the canaries compare TABLES to each other, not
 * scans, so none of them could notice. One scanner, one fix.
 *
 * A literal-only scan is not enough, and that is not hypothetical:
 * `lib/authHandoff.ts` and `lib/authMigration.ts` both write
 * `const CONTAINER = 'authhandoff'` and then call `getContainer(CONTAINER)`.
 * The first version of the purge canary matched only a quoted argument, so
 * BOTH were invisible — and `authhandoff` holds a `memberId`, so account
 * deletion shipped missing it while the test sat green. So single-level
 * `const X = '…'` aliases are resolved too.
 */
export function containersReferencedInSource(root: string): Set<string> {
  const files = [...walk(join(root, 'app')), ...walk(join(root, 'lib'))];
  const found = new Set<string>();
  for (const file of files) {
    const src = readFileSync(file, 'utf8');

    for (const m of src.matchAll(/(?:get|ensure)Container\(\s*'([a-zA-Z]+)'/g)) {
      found.add(m[1]);
    }

    const aliases = new Map<string, string>();
    for (const m of src.matchAll(/\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*'([a-zA-Z]+)'/g)) {
      aliases.set(m[1], m[2]);
    }
    for (const m of src.matchAll(/(?:get|ensure)Container\(\s*([A-Za-z_$][\w$]*)\s*[,)]/g)) {
      const resolved = aliases.get(m[1]);
      if (resolved) found.add(resolved);
    }
  }
  return found;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}
