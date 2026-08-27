#!/usr/bin/env node
/**
 * Does every `t('...')` in the app resolve to a real message?
 *
 * WHY THIS EXISTS
 * ---------------
 * next-intl THROWS on a missing key — it does not fall back — so an
 * unresolvable key is not a cosmetic problem, it is a crashed screen. And the
 * failure is invisible to the test suite: components render, assertions on
 * other text pass, and the broken string quietly displays as its own key path.
 *
 * On 2026-08-27 three separate i18n blocks were inserted into the WRONG object
 * (`pages.admin` instead of `admin`; `home.stringing` instead of
 * `admin.stringing`; and once at the wrong indent depth). Every string in each
 * rendered as `admin.stringing.newJob` and the full suite stayed green all
 * three times. `__tests__/i18n/canary-strings.test.tsx` could not help: it
 * checks a hand-maintained list of about a dozen keys, so it is structurally
 * incapable of noticing a NEW key that does not resolve.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 * --------------------------------
 * It does not resolve dynamic keys — `t(`stage.${x}`)` cannot be known
 * statically. Rather than skip those entirely it checks the literal PREFIX
 * (`stage`) exists as an object, which is what caught nothing tonight but
 * would have caught a renamed branch.
 *
 * It reads the JSON with a duplicate-tolerant parse. messages/*.json carries
 * duplicate sibling keys (documented in CLAUDE.md), and `JSON.parse` silently
 * keeps the last — which is the real runtime behaviour, so matching it is
 * correct here rather than a compromise.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const SCAN_DIRS = ['components', 'app'];
const LOCALES = ['messages/en.json', 'messages/zh-CN.json'];

function walk(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

function lookup(messages, path) {
  return path.split('.').reduce((node, part) => {
    if (node && typeof node === 'object' && part in node) return node[part];
    return undefined;
  }, messages);
}

/**
 * Every `t('literal')` in a file, resolved against the namespace its
 * `useTranslations(...)` declared.
 *
 * Handles more than one translator per file (`const tNav =
 * useTranslations('nav')`), because HomeTab and ProfileTab both do that and a
 * single-namespace assumption would mis-resolve every call in them.
 */
function extractKeys(src) {
  const found = [];
  // name -> namespace, e.g. t -> 'admin.stringing', tNav -> 'nav'
  const scopes = new Map();
  const declRe = /const\s+(\w+)\s*=\s*useTranslations\(\s*'([^']*)'\s*\)/g;
  let d;
  while ((d = declRe.exec(src)) !== null) scopes.set(d[1], d[2]);
  // A no-argument useTranslations() is root-scoped.
  const bareRe = /const\s+(\w+)\s*=\s*useTranslations\(\s*\)/g;
  while ((d = bareRe.exec(src)) !== null) scopes.set(d[1], '');

  for (const [name, ns] of scopes) {
    // t('key') and t.rich('key'), single-quoted literals only.
    const callRe = new RegExp(`\\b${name}(?:\\.rich)?\\(\\s*'([^']+)'`, 'g');
    let m;
    while ((m = callRe.exec(src)) !== null) {
      found.push({ key: ns ? `${ns}.${m[1]}` : m[1], dynamic: false });
    }
    // t(`prefix.${x}`) — check that the literal prefix is a real object.
    //
    // ONLY when the prefix ends at a dot. `t(`format_${f}`)` interpolates
    // MID-SEGMENT to build `format_doubles`, so `format_` is not a path and
    // asserting it exists is a false positive — which is exactly what the
    // first run of this script reported against GearPickSheet.
    const tplRe = new RegExp(`\\b${name}(?:\\.rich)?\\(\\s*\`([^\`$]*)\\$\\{`, 'g');
    while ((m = tplRe.exec(src)) !== null) {
      if (!m[1].endsWith('.')) continue;
      const prefix = m[1].slice(0, -1);
      if (!prefix) continue;
      found.push({ key: ns ? `${ns}.${prefix}` : prefix, dynamic: true });
    }
  }
  return found;
}

const locales = LOCALES.map((p) => ({
  path: p,
  messages: JSON.parse(readFileSync(join(ROOT, p), 'utf8')),
}));

const problems = [];
for (const dir of SCAN_DIRS) {
  for (const file of walk(join(ROOT, dir))) {
    const src = readFileSync(file, 'utf8');
    if (!src.includes('useTranslations')) continue;
    for (const { key, dynamic } of extractKeys(src)) {
      for (const { path, messages } of locales) {
        const value = lookup(messages, key);
        if (value === undefined) {
          problems.push(
            `${relative(ROOT, file)}  ${dynamic ? '(prefix) ' : ''}${key}  missing in ${path}`,
          );
        } else if (dynamic && typeof value !== 'object') {
          problems.push(
            `${relative(ROOT, file)}  (prefix) ${key}  is not an object in ${path}`,
          );
        } else if (!dynamic && typeof value === 'object') {
          // A key that resolves to an OBJECT renders "[object Object]" or
          // throws, depending on the call. Either way it is not a string.
          problems.push(
            `${relative(ROOT, file)}  ${key}  resolves to an object, not a string, in ${path}`,
          );
        }
      }
    }
  }
}

if (problems.length) {
  console.error('\ni18n keys that will not resolve at runtime:\n');
  for (const p of [...new Set(problems)].sort()) console.error('  ' + p);
  console.error(
    `\n${problems.length} problem(s). next-intl THROWS on a missing key, so each of these is a crashed screen, not a blank string.\n` +
      'Most likely cause: the block was inserted into the wrong parent object. ' +
      'messages/*.json cannot be addressed safely by substring or by a naive regex — ' +
      'anchor from the parent block.\n',
  );
  process.exit(1);
}
console.log('i18n: every t() key resolves in both locales.');
