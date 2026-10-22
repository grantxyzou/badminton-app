import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { CONTAINERS, pkFieldOf, type ContainerName } from '@/lib/containers';
import { groupScope, partitionKeyOptions, type GroupContainer } from '@/lib/groupScope';
import { resetMockStore } from './helpers';

/**
 * THE PARTITION-KEY HINT on `groupScope.query` (`GroupQuery.partitionKey`).
 *
 * Without it every scoped query fans out to every physical partition and the
 * SDK merges; with it a query that already filters on the container's own
 * key — `players` by `@sessionId`, `ledger` by `@memberId`, `kudos` by
 * `@recipientMemberId` — runs against one partition. It is OPT-IN, never
 * inferred from the WHERE text, because a parameter inside an `OR`, an `IN`
 * or an `ARRAY_CONTAINS` would silently drop rows if the accessor guessed.
 *
 * The mock store ignores the option, so a wrong hint passes every behavioural
 * test and drops rows only in production — the same trap as the `item(id, pk)`
 * argument in CLAUDE.md. Three things are pinned here:
 *   1. the accessor passes the option through, and only when given;
 *   2. it refuses a hint on a `/id`-keyed or non-GROUP container;
 *   3. a SOURCE SCAN: every `partitionKey:` hint in `app/` and `lib/` sits in
 *      a query whose WHERE carries `c.<pkField> = @param` as a top-level AND
 *      conjunct with no top-level OR, and the hint's value is that
 *      parameter's value. The scan is what stops a wrong hint passing CI.
 */

const seen = vi.hoisted(() => [] as Array<{ container: string; options: unknown }>);
vi.mock('@/lib/cosmos', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/cosmos')>();
  return {
    ...actual,
    getContainer: (name: string) => {
      const container = actual.getContainer(name);
      return {
        ...container,
        item: container.item.bind(container),
        items: {
          ...container.items,
          query: (q: never, options?: unknown) => {
            seen.push({ container: name, options });
            return container.items.query(q, options as never);
          },
        },
      };
    },
  };
});

const G = 'g1';

describe('partitionKeyOptions', () => {
  it('is undefined when no hint is given', () => {
    expect(partitionKeyOptions('players', { where: 'c.sessionId = @sessionId' })).toBeUndefined();
  });

  it('passes a hint on a GROUP container with a real key', () => {
    expect(partitionKeyOptions('players', { partitionKey: 's1' })).toEqual({ partitionKey: 's1' });
    expect(partitionKeyOptions('ledger', { partitionKey: 'm1' })).toEqual({ partitionKey: 'm1' });
    expect(partitionKeyOptions('kudos', { partitionKey: 'm1' })).toEqual({ partitionKey: 'm1' });
  });

  it('refuses a hint on a /id-keyed container', () => {
    for (const c of ['birds', 'clubSettings', 'payments'] as const) {
      expect(pkFieldOf(c)).toBe('id');
      expect(() => partitionKeyOptions(c, { partitionKey: 'x' })).toThrow(/keyed by \/id/);
    }
  });

  it('refuses a hint on a container that is not GROUP scoped', () => {
    // The type already excludes these; the runtime guard is for a caller
    // that cast its way past it.
    for (const c of ['groups', 'equipmentCatalog', 'playerGear'] as ContainerName[]) {
      expect(CONTAINERS[c].scope).not.toBe('group');
      expect(() => partitionKeyOptions(c as GroupContainer, { partitionKey: 'x' })).toThrow(/GROUP-scoped/);
    }
  });

  it('refuses an empty hint', () => {
    expect(() => partitionKeyOptions('players', { partitionKey: '' })).toThrow(/non-empty/);
  });
});

describe('groupScope.query feed options', () => {
  beforeEach(() => {
    resetMockStore();
    seen.length = 0;
  });

  it('carries partitionKey to the SDK when hinted, and nothing otherwise', async () => {
    const scope = groupScope(G);
    await scope.create('players', { id: 'p1', sessionId: 's1', name: 'Lin' });
    await scope.create('players', { id: 'p2', sessionId: 's2', name: 'Viktor' });

    const hinted = await scope.query<{ id: string }>('players', {
      where: 'c.sessionId = @sessionId',
      params: [{ name: '@sessionId', value: 's1' }],
      partitionKey: 's1',
    });
    expect(hinted.map((p) => p.id)).toEqual(['p1']);
    const bare = await scope.query<{ id: string }>('players', {
      where: 'c.sessionId = @sessionId',
      params: [{ name: '@sessionId', value: 's1' }],
    });
    expect(bare.map((p) => p.id)).toEqual(['p1']);

    const queries = seen.filter((s) => s.container === 'players' && s.options !== null);
    expect(queries.map((s) => s.options)).toEqual([{ partitionKey: 's1' }, undefined]);
  });

  it('throws before reaching the store for a /id-keyed container', async () => {
    await expect(groupScope(G).query('birds', { partitionKey: 'x' })).rejects.toThrow(/keyed by \/id/);
    expect(seen.filter((s) => s.container === 'birds')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The source scan.
// ---------------------------------------------------------------------------

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

/** Index just past the `}` that closes the object opened at `open`; strings and comments are skipped. */
function closeOf(src: string, open: number): number {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const ch = src[i];
    if (ch === "'" || ch === '"' || ch === '`') {
      const quote = ch;
      i++;
      while (i < src.length && src[i] !== quote) {
        if (src[i] === '\\') i++;
        i++;
      }
      continue;
    }
    if (ch === '/' && src[i + 1] === '/') { i = src.indexOf('\n', i); if (i < 0) break; continue; }
    if (ch === '/' && src[i + 1] === '*') { i = src.indexOf('*/', i) + 1; continue; }
    if (ch === '{' || ch === '(' || ch === '[') depth++;
    if (ch === '}' || ch === ')' || ch === ']') {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  throw new Error('unbalanced object literal');
}

/** `key: expr` pairs at the top level of an object-literal body. */
function topLevelProps(body: string): Map<string, string> {
  const out = new Map<string, string>();
  let depth = 0;
  let start = 0;
  const pieces: string[] = [];
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch === "'" || ch === '"' || ch === '`') {
      const quote = ch;
      i++;
      while (i < body.length && body[i] !== quote) {
        if (body[i] === '\\') i++;
        i++;
      }
      continue;
    }
    if (ch === '/' && body[i + 1] === '/') { i = body.indexOf('\n', i); if (i < 0) break; continue; }
    if (ch === '{' || ch === '(' || ch === '[') depth++;
    if (ch === '}' || ch === ')' || ch === ']') depth--;
    if (ch === ',' && depth === 0) { pieces.push(body.slice(start, i)); start = i + 1; }
  }
  pieces.push(body.slice(start));
  for (const piece of pieces) {
    const m = /^\s*([A-Za-z_$][\w$]*)\s*:\s*([\s\S]*?)\s*$/.exec(piece);
    if (m) out.set(m[1], m[2]);
  }
  return out;
}

/** The WHERE's top-level AND conjuncts, and whether an OR sits at the top level. */
function conjunctsOf(where: string): { conjuncts: string[]; topLevelOr: boolean } {
  const conjuncts: string[] = [];
  let depth = 0;
  let start = 0;
  let topLevelOr = false;
  for (let i = 0; i < where.length; i++) {
    const ch = where[i];
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    else if (depth === 0) {
      const rest = where.slice(i);
      if (/^\sAND\s/i.test(rest)) { conjuncts.push(where.slice(start, i)); start = i + 4; i += 3; }
      else if (/^\sOR\s/i.test(rest)) topLevelOr = true;
    }
  }
  conjuncts.push(where.slice(start));
  return { conjuncts: conjuncts.map((c) => c.trim()), topLevelOr };
}

const STRING_CONST = /\b(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*'((?:[^'\\]|\\.)*)'/g;
const QUERY_CALL = /\.query(?:<[^(]*?>)?\(\s*'([a-zA-Z]+)'\s*,\s*\{/g;
const PARAM = /\{\s*name:\s*'(@\w+)'\s*,\s*value:\s*([\s\S]*?)\s*\}/g;

interface Hint {
  site: string;
  container: string;
  where: string;
  params: string;
  partitionKey: string;
  localConsts: Map<string, string>;
}

function collectHints(root: string): { hints: Hint[]; rawHintCount: number; queriesScanned: number } {
  const files = [...walk(join(root, 'app')), ...walk(join(root, 'lib'))];
  const sources = files.map((f) => [f, readFileSync(f, 'utf8')] as const);
  const globalConsts = new Map<string, string>();
  for (const [, src] of sources) for (const m of src.matchAll(STRING_CONST)) globalConsts.set(m[1], m[2]);

  const hints: Hint[] = [];
  let rawHintCount = 0;
  let queriesScanned = 0;
  for (const [file, src] of sources) {
    const rel = file.slice(root.length + 1);
    // The accessor declares the field and returns the option; it hints nothing.
    // `ensureContainer`'s `partitionKey: { paths }` is a container definition,
    // not a hint — a hint is a scalar expression, never an object literal.
    if (rel !== 'lib/groupScope.ts') rawHintCount += (src.match(/\bpartitionKey:(?!\s*\{)/g) ?? []).length;
    const localConsts = new Map(globalConsts);
    for (const m of src.matchAll(STRING_CONST)) localConsts.set(m[1], m[2]);
    for (const m of src.matchAll(QUERY_CALL)) {
      queriesScanned++;
      const open = m.index! + m[0].length - 1;
      const body = src.slice(open + 1, closeOf(src, open) - 1);
      const props = topLevelProps(body);
      const partitionKey = props.get('partitionKey');
      if (partitionKey === undefined) continue;
      const line = src.slice(0, m.index).split('\n').length;
      hints.push({
        site: `${rel}:${line}`,
        container: m[1],
        where: props.get('where') ?? '',
        params: props.get('params') ?? '',
        partitionKey,
        localConsts,
      });
    }
  }
  return { hints, rawHintCount, queriesScanned };
}

/** The string literals a WHERE expression can take (a literal, a ternary of literals, or a const alias). */
function whereLiterals(expr: string, consts: Map<string, string>): string[] | null {
  const trimmed = expr.trim();
  if (/^[A-Za-z_$][\w$]*$/.test(trimmed)) {
    const resolved = consts.get(trimmed);
    return resolved === undefined ? null : [resolved];
  }
  if (trimmed.includes('`')) return null;
  const literals = [...trimmed.matchAll(/'((?:[^'\\]|\\.)*)'/g)].map((m) => m[1]);
  return literals.length > 0 ? literals : null;
}

function verify(h: Hint): string | null {
  const meta = CONTAINERS[h.container as ContainerName];
  if (!meta) return `${h.site}: unknown container '${h.container}'`;
  if (meta.scope !== 'group') return `${h.site}: '${h.container}' is ${meta.scope}-scoped, not GROUP`;
  const pk = pkFieldOf(h.container as ContainerName);
  if (pk === 'id') return `${h.site}: '${h.container}' is keyed by /id — a hint cannot apply`;

  const literals = whereLiterals(h.where, h.localConsts);
  if (!literals) return `${h.site}: WHERE must be a string literal, a ternary of literals or a const alias (got: ${h.where || '<none>'})`;
  const paramNames = new Set<string>();
  for (const where of literals) {
    const { conjuncts, topLevelOr } = conjunctsOf(where);
    if (topLevelOr) return `${h.site}: WHERE has a top-level OR — the hint would drop rows: ${where}`;
    const eq = conjuncts
      .map((c) => new RegExp(`^c\\.${pk}\\s*=\\s*(@\\w+)$`).exec(c))
      .find(Boolean);
    if (!eq) return `${h.site}: no top-level conjunct \`c.${pk} = @param\` in WHERE: ${where}`;
    paramNames.add(eq[1]);
  }
  if (paramNames.size !== 1) return `${h.site}: the WHERE branches bind different partition-key parameters (${[...paramNames].join(', ')})`;
  const [param] = paramNames;

  const bound = new Map<string, string>();
  for (const m of h.params.matchAll(PARAM)) bound.set(m[1], m[2].trim());
  const value = bound.get(param);
  if (value === undefined) return `${h.site}: ${param} is not bound in params`;
  if (value !== h.partitionKey.trim()) {
    return `${h.site}: partitionKey (${h.partitionKey.trim()}) is not ${param}'s value (${value})`;
  }
  return null;
}

describe('every partitionKey hint matches a plain equality on its container key (source scan)', () => {
  const root = join(__dirname, '..');
  const { hints, rawHintCount, queriesScanned } = collectHints(root);

  it('scans the accessor call sites', () => {
    expect(queriesScanned).toBeGreaterThan(50);
  });

  it('sees every hint the source carries', () => {
    // A hint inside a call the scanner cannot parse (a ternary options object,
    // a spread) would otherwise be invisible — and therefore unverified.
    expect(hints.length, 'hints the scanner matched vs `partitionKey:` occurrences').toBe(rawHintCount);
    expect(hints.length).toBeGreaterThan(25);
  });

  it('verifies each hint against its WHERE, its params and the registry', () => {
    const problems = hints.map(verify).filter((p): p is string => p !== null);
    expect(
      problems,
      'A partitionKey hint belongs only on a query whose WHERE is a plain equality on the ' +
        "container's own partition key (c.<pkField> = @param as a top-level AND conjunct, no " +
        "top-level OR), with the hint equal to that parameter's value. Drop the hint or fix the WHERE; " +
        'the mock ignores the option, so nothing else can catch a wrong one.',
    ).toEqual([]);
  });

  it('covers the hot paths the finding named', () => {
    const sites = hints.map((h) => h.site.replace(/:\d+$/, ''));
    for (const file of [
      'lib/storeCredit.ts',
      'lib/owedBalance.ts',
      'lib/kudosEligibility.ts',
      'app/api/players/route.ts',
      'app/api/session/settle/route.ts',
      'app/api/stringing/jobs/route.ts',
      'app/api/kudos/route.ts',
    ]) {
      expect(sites, `${file} should carry a hint`).toContain(file);
    }
  });

  it('rejects the shapes a hint must never sit on', () => {
    const consts = new Map<string, string>();
    const base = { site: 'x:1', params: "[{ name: '@sessionId', value: sessionId }]", partitionKey: 'sessionId', localConsts: consts };
    expect(verify({ ...base, container: 'players', where: "'c.sessionId = @sessionId'" })).toBeNull();
    expect(verify({ ...base, container: 'players', where: "'c.sessionId = @sessionId AND (c.a = 1 OR c.b = 2)'" })).toBeNull();
    expect(verify({ ...base, container: 'players', where: "'c.sessionId = @sessionId OR c.b = 2'" })).toMatch(/top-level OR/);
    expect(verify({ ...base, container: 'players', where: "'c.sessionId = @sessionId AND c.a = 1 OR c.b = 2'" })).toMatch(/top-level OR/);
    expect(verify({ ...base, container: 'players', where: "'ARRAY_CONTAINS(@sessionIds, c.sessionId)'" })).toMatch(/no top-level conjunct/);
    expect(verify({ ...base, container: 'players', where: "'c.sessionId IN (@s0, @s1)'" })).toMatch(/no top-level conjunct/);
    expect(verify({ ...base, container: 'players', where: "'c.memberId = @memberId'" })).toMatch(/no top-level conjunct/);
    expect(verify({ ...base, container: 'players', where: "'c.sessionId = @sessionId'", partitionKey: 'other' })).toMatch(/is not @sessionId's value/);
    expect(verify({ ...base, container: 'players', where: '`c.sessionId = @sessionId AND ${LIVE}`' })).toMatch(/must be a string literal/);
    expect(verify({ ...base, container: 'birds', where: "'c.id = @sessionId'" })).toMatch(/keyed by \/id/);
    expect(verify({ ...base, container: 'members', where: "'c.id = @sessionId'" })).toMatch(/not GROUP/);
    expect(verify({ ...base, container: 'ledger', where: "'c.sessionId = @sessionId'" })).toMatch(/no top-level conjunct/);
  });
});
