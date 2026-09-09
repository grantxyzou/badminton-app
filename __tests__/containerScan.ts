import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

/**
 * Every Cosmos container name the app's source touches — the ONE scanner the
 * container canaries share (`member-purge-coverage`, `group-scope-coverage`,
 * `containers-registry`, `cosmos-container-provisioning`).
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
export interface ContainerReferences {
  /** name → repo-relative files that call `getContainer` or `ensureContainer` with it. */
  used: Map<string, string[]>;
  /** name → repo-relative files that call `getContainer` with it (raw access; the ratchet's input). */
  gotten: Map<string, string[]>;
  /** name → the partition-key path literal it was ensured with. */
  ensured: Map<string, string>;
}

const NAME = `(?:'([a-zA-Z]+)'|([A-Za-z_$][\\w$]*))`;
const CALL = new RegExp(`(get|ensure)Container\\(\\s*${NAME}\\s*(?:,\\s*'(\\/[a-zA-Z]+)')?\\s*[,)]`, 'g');
const ALIAS = /\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*'([a-zA-Z]+)'/g;
/**
 * The scoped accessor's calls — `scope.query('players', …)`, `.read('skills', …)`.
 * Once a file is swept it names its containers only this way, and the
 * classification canaries must keep seeing them. A string-literal first
 * argument is what tells these apart from the SDK's `.query({ … })`.
 */
const SCOPED = /\.(?:query|count|read|create|upsert|remove)(?:<[^>]*>)?\(\s*'([a-zA-Z]+)'/g;

export function containerReferences(root: string): ContainerReferences {
  const files = [...walk(join(root, 'app')), ...walk(join(root, 'lib'))];
  const used = new Map<string, string[]>();
  const gotten = new Map<string, string[]>();
  const ensured = new Map<string, string>();
  const add = (map: Map<string, string[]>, name: string, rel: string) => {
    const files = map.get(name) ?? [];
    if (!files.includes(rel)) files.push(rel);
    map.set(name, files);
  };
  for (const file of files) {
    const src = readFileSync(file, 'utf8');
    const aliases = new Map<string, string>();
    for (const m of src.matchAll(ALIAS)) aliases.set(m[1], m[2]);

    const rel = file.slice(root.length + 1);
    for (const m of src.matchAll(CALL)) {
      const [, kind, literal, ident, path] = m;
      const name = literal ?? (ident ? aliases.get(ident) : undefined);
      if (!name) continue;
      add(used, name, rel);
      if (kind === 'get') add(gotten, name, rel);
      if (kind === 'ensure' && path) ensured.set(name, path);
    }
    for (const m of src.matchAll(SCOPED)) add(used, m[1], rel);
  }
  return { used, gotten, ensured };
}

/** The set-shaped view most canaries want. */
export function containersReferencedInSource(root: string): Set<string> {
  return new Set(containerReferences(root).used.keys());
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
