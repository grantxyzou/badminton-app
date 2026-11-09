#!/usr/bin/env node
// UI pattern miner — the "what has become a pattern nobody wrote down" half of
// the `ui-truth` skill.
//
// An AI working in this repo learns the UI from DESIGN.md and the CLAUDE.md
// files. A pattern that lives only in code is re-invented, slightly differently,
// by the next change. This finds three kinds of de-facto pattern and reports
// the ones the docs never mention:
//
//   1. globals.css classes used in >= MIN_FILES files, named in no doc
//   2. identical inline style objects repeated in >= MIN_FILES files
//      (a pattern begging to be a class or a primitive)
//   3. identical className strings (>= 3 classes) repeated in >= MIN_FILES files
//
//   node scripts/ui-patterns.mjs            # markdown; marks NEW since last run
//   node scripts/ui-patterns.mjs --json     # never moves the snapshot
//   node scripts/ui-patterns.mjs --no-save
//
// Reads the source and never edits it. The one file it writes is its own
// snapshot, .claude/ui-patterns.local.json (gitignored), and only on a
// markdown run: that report is the one whose 🆕 marks the snapshot feeds, so
// looking at the JSON must not quietly use up a week's "new".

import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();
const SNAPSHOT = '.claude/ui-patterns.local.json';
export const MIN_FILES = 3;
const SOURCE_DIRS = ['components', 'app'];
// What an AI reads to learn the UI: CLAUDE.md, DESIGN.md, the path-scoped
// rules in .claude/rules/ (design detail lives in design-system.md and motion.md), and any
// nested CLAUDE.md. docs/design-system/ is the pristine bundle, never imported
// and not where conventions are written, so it does not count here.
const DOC_FILES = ['DESIGN.md', 'CLAUDE.md'];
const DOC_DIRS = ['.claude/rules'];
// The design-system preview pages restate the tokens on purpose; mining them
// would report the specimens themselves as patterns.
const SKIP_DIRS = new Set(['node_modules', '.next', 'design']);

function walk(dir, pred, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) walk(p, pred, out);
    else if (pred(p)) out.push(p);
  }
  return out;
}

/** Class names a stylesheet defines (selectors only, not values). */
export function cssClasses(css) {
  const clean = css
    .replace(/\/\*[\s\S]*?\*\//g, '')
    // A string or a url() is a value, and can hold a `.png` or a `;`.
    .replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, '""')
    .replace(/url\([^)]*\)/g, 'url()');
  const names = new Set();
  // A selector is the text since the last `{`, `}` or `;` — a declaration
  // (nesting) or an `@import …;` can sit in front of it.
  for (const m of clean.matchAll(/([^{};]+)\{/g)) {
    // An at-rule's prelude is not a selector; the rules inside it still are.
    if (m[1].trim().startsWith('@')) continue;
    for (const c of m[1].matchAll(/\.(-?[a-zA-Z_][\w-]*)/g)) names.add(c[1]);
  }
  return names;
}

const QUOTES = `'"\``;

/**
 * Index just past the comment that opens at `i`, or -1 if none does. A
 * comment has to be skipped as well as a string: "don't" in a `//` line inside
 * a style object reads as an unclosed string and swallows the rest of the file.
 */
function skipComment(src, i) {
  if (src[i] !== '/') return -1;
  if (src[i + 1] === '/') {
    const nl = src.indexOf('\n', i);
    return nl === -1 ? src.length : nl;
  }
  if (src[i + 1] === '*') {
    const end = src.indexOf('*/', i + 2);
    return end === -1 ? src.length : end + 2;
  }
  return -1;
}

/** Index just past the string or template literal that opens at `i`. */
function skipString(src, i) {
  const q = src[i];
  for (let j = i + 1; j < src.length; j++) {
    if (src[j] === '\\') j++;
    else if (q === '`' && src[j] === '$' && src[j + 1] === '{') j = matchBrace(src, j + 1);
    else if (src[j] === q) return j + 1;
  }
  return src.length;
}

/** Index of the `}` that closes the `{` at `i`, ignoring braces inside strings. */
function matchBrace(src, i) {
  let depth = 0;
  for (let j = i; j < src.length; j++) {
    const c = skipComment(src, j);
    if (c !== -1) j = c - 1;
    else if (QUOTES.includes(src[j])) j = skipString(src, j) - 1;
    else if (src[j] === '{') depth++;
    else if (src[j] === '}' && --depth === 0) return j;
  }
  return src.length;
}

/**
 * The text of every string literal in a JS expression. A template literal
 * gives its static text, and the literals inside each `${…}` (nested ones too).
 */
function literalTexts(expr, out = []) {
  for (let i = 0; i < expr.length; i++) {
    const c = skipComment(expr, i);
    if (c !== -1) i = c - 1;
    else if (expr[i] === "'" || expr[i] === '"') {
      const end = skipString(expr, i);
      out.push(expr.slice(i + 1, end - 1));
      i = end - 1;
    } else if (expr[i] === '`') {
      let j = i + 1;
      let text = '';
      while (j < expr.length && expr[j] !== '`') {
        if (expr[j] === '\\') {
          text += expr[j + 1] ?? '';
          j += 2;
        } else if (expr[j] === '$' && expr[j + 1] === '{') {
          const end = matchBrace(expr, j + 1);
          literalTexts(expr.slice(j + 2, end), out);
          text += ' ';
          j = end + 1;
        } else text += expr[j++];
      }
      out.push(text);
      i = j;
    }
  }
  return out;
}

/** Every `style={{ ... }}` object body in a source file, brace-balanced. */
export function styleObjects(src) {
  const out = [];
  let i = 0;
  while ((i = src.indexOf('style={{', i)) !== -1) {
    const open = i + 'style={'.length;
    const close = matchBrace(src, open);
    out.push(src.slice(open + 1, close));
    i = close;
  }
  return out;
}

/** Order-insensitive key for a style body; null when too small to be a pattern. */
export function normalizeStyle(body) {
  const parts = [];
  let depth = 0;
  let quote = null;
  let cur = '';
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    // Inside a string a comma or bracket is text: `fontFamily: 'a, b'`.
    if (quote) {
      cur += ch;
      if (ch === '\\') cur += body[++i] ?? '';
      else if (ch === quote) quote = null;
      continue;
    }
    // A comment is not part of the style (and its "don't" is not a quote).
    const c = skipComment(body, i);
    if (c !== -1) {
      i = c - 1;
      continue;
    }
    if (QUOTES.includes(ch)) quote = ch;
    else if ('([{'.includes(ch)) depth++;
    else if (')]}'.includes(ch)) depth--;
    if (ch === ',' && depth === 0) {
      parts.push(cur);
      cur = '';
    } else cur += ch;
  }
  parts.push(cur);
  const props = parts
    .map((p) => p.replace(/\s+/g, ' ').trim().replace(/:\s*'(-?\d+(?:\.\d+)?)'$/, ': $1'))
    .filter(Boolean)
    .filter((p) => !p.startsWith('...'));
  // A single property is a value, not a pattern.
  if (props.length < 2) return null;
  // A style computed from local state is not a reusable pattern.
  if (props.some((p) => /\?|=>|\$\{/.test(p))) return null;
  return props.sort().join('; ');
}

/** Static className strings with at least `min` classes, normalized. */
export function classNameStrings(src, min = 3) {
  const out = [];
  for (const m of src.matchAll(/className=(?:"([^"]+)"|'([^']+)'|\{`([^`$]+)`\})/g)) {
    const cls = (m[1] ?? m[2] ?? m[3]).trim().split(/\s+/);
    if (cls.length >= min) out.push(cls.sort().join(' '));
  }
  return out;
}

export function usedClasses(src) {
  const used = new Set();
  const take = (text) => {
    for (const tok of text.split(/\s+/)) if (/^[a-zA-Z_][\w-]*$/.test(tok)) used.add(tok);
  };
  let i = 0;
  while ((i = src.indexOf('className=', i)) !== -1) {
    const at = i + 'className='.length;
    if (src[at] === '"' || src[at] === "'") {
      const end = skipString(src, at);
      take(src.slice(at + 1, end - 1));
      i = end;
    } else if (src[at] === '{') {
      // An expression: only the string literals inside it are class names,
      // including the ones a `${on ? 'a' : 'b'}` inside a template picks.
      const end = matchBrace(src, at);
      for (const text of literalTexts(src.slice(at + 1, end))) take(text);
      i = end;
    } else i = at;
  }
  return used;
}

/**
 * Everything the docs name, including the shorthand they use for families:
 * `.fs-*`, `.icon-xs/sm/md/lg/xl`, and "`cc-btn-primary` / `-secondary`".
 */
export function docVocabulary(docsText) {
  const exact = new Set();
  const prefixes = new Set();
  for (const line of docsText.split('\n')) {
    let prevFull = null;
    for (const m of line.matchAll(/`([^`]+)`/g)) {
      for (const raw of m[1].split(/[\s,]+/)) {
        const t = raw.replace(/^\./, '');
        if (/^[a-z][\w-]*-\*$/.test(t)) prefixes.add(t.slice(0, -1));
        else if (/^-[a-z][\w-]*$/.test(t) && prevFull) exact.add(prevFull.replace(/-[^-]+$/, '') + t);
        else if (/^[a-z][\w-]*-[\w]+(\/[\w]+)+$/.test(t)) {
          const [first, ...rest] = t.split('/');
          const base = first.replace(/-[^-]+$/, '-');
          exact.add(first);
          for (const r of rest) exact.add(base + r);
        } else if (/^[a-z][\w-]*$/.test(t)) {
          exact.add(t);
          prevFull = t;
        }
      }
    }
    // Bare mentions outside backticks: `.foo-bar` or `.fs-*` in prose.
    for (const m of line.matchAll(/(?:^|[\s(])\.([a-z][\w-]*)(\*)?/g)) {
      if (m[2]) prefixes.add(m[1]);
      else exact.add(m[1]);
    }
  }
  return { exact, prefixes };
}

// Tailwind palette classes are governed as a family by DESIGN.md §8 (a light
// override per class), not one by one.
const PALETTE_CLASS = /^(text|bg|border|ring|from|to|via)-[a-z]+-\d{2,3}$/;

export function documented(name, vocab) {
  if (PALETTE_CLASS.test(name)) return true;
  if (vocab.exact.has(name)) return true;
  for (const p of vocab.prefixes) if (name.startsWith(p)) return true;
  return false;
}

function tally(map, key, file) {
  if (!map.has(key)) map.set(key, new Set());
  map.get(key).add(file);
}

export function mine() {
  const files = SOURCE_DIRS.flatMap((d) => walk(d, (p) => p.endsWith('.tsx')));
  const docs = [
    ...DOC_FILES.filter(existsSync),
    ...DOC_DIRS.flatMap((d) => walk(d, (p) => p.endsWith('.md'))),
    ...walk('components', (p) => p.endsWith('CLAUDE.md')),
  ]
    .map((p) => readFileSync(p, 'utf8'))
      .join('\n');
  const vocab = docVocabulary(docs);
  const defined = cssClasses(readFileSync('app/globals.css', 'utf8'));

  const classUse = new Map();
  const styleUse = new Map();
  const classNameUse = new Map();
  for (const f of files) {
    const src = readFileSync(f, 'utf8');
    const rel = relative(ROOT, f);
    for (const c of usedClasses(src)) if (defined.has(c)) tally(classUse, c, rel);
    for (const body of styleObjects(src)) {
      const key = normalizeStyle(body);
      if (key) tally(styleUse, key, rel);
    }
    for (const cn of classNameStrings(src)) tally(classNameUse, cn, rel);
  }

  const rank = (map) =>
    [...map.entries()]
      .filter(([, set]) => set.size >= MIN_FILES)
      .sort((a, b) => b[1].size - a[1].size)
      .map(([key, set]) => ({ key, files: set.size, examples: [...set].slice(0, 3) }));

  return {
    undocumentedClasses: rank(classUse).filter((p) => !documented(p.key, vocab)),
    repeatedStyles: rank(styleUse),
    repeatedClassNames: rank(classNameUse),
  };
}

function main() {
  const args = new Set(process.argv.slice(2));
  const prev = existsSync(SNAPSHOT) ? JSON.parse(readFileSync(SNAPSHOT, 'utf8')) : null;
  const seen = new Set(
    prev ? [...prev.undocumentedClasses, ...prev.repeatedStyles, ...prev.repeatedClassNames].map((p) => p.key) : [],
  );
  const r = mine();
  const at = new Date().toISOString();

  if (args.has('--json')) {
    console.log(JSON.stringify({ at, previous: prev?.at ?? null, ...r }, null, 2));
  } else {
    const mark = (p) => (prev && !seen.has(p.key) ? '🆕 ' : '');
    const section = (title, why, list, fmt) => {
      const lines = [`### ${title} (${list.length})`, why, ''];
      for (const p of list.slice(0, 15)) lines.push(`- ${mark(p)}${fmt(p)} — ${p.files} files, e.g. ${p.examples.join(', ')}`);
      if (list.length > 15) lines.push(`- …and ${list.length - 15} more (--json for all)`);
      return lines.join('\n');
    };
    console.log(
      [
        `## UI patterns not written down — ${at.slice(0, 10)}`,
        prev ? `🆕 = new since ${prev.at.slice(0, 10)}.` : 'First run — everything is new.',
        '',
        section(
          'globals.css classes no doc mentions',
          'In use across the app, absent from DESIGN.md and every CLAUDE.md, so an AI will not know to reach for them.',
          r.undocumentedClasses,
          (p) => `\`.${p.key}\``,
        ),
        '',
        section(
          'Inline styles repeated verbatim',
          'The same style object typed in several files: a class or primitive waiting to be named.',
          r.repeatedStyles,
          (p) => `\`{ ${p.key.length > 90 ? p.key.slice(0, 90) + '…' : p.key} }\``,
        ),
        '',
        section(
          'className lists repeated verbatim',
          'The same class combination in several files: a named class or a documented recipe.',
          r.repeatedClassNames,
          (p) => `\`${p.key}\``,
        ),
      ].join('\n'),
    );
  }
  if (!args.has('--no-save') && !args.has('--json')) writeFileSync(SNAPSHOT, JSON.stringify({ at, ...r }, null, 2) + '\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
