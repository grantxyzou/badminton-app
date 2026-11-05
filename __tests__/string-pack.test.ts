import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import catalogSeed from '../scripts/data/equipment-catalog.json';
import { STRING_PACKS } from '../lib/stringPacks';
import { STRING_PACK_IDS, stringPackSrc } from '../lib/stringPackSrc';
import { packProblems } from '../lib/stringPack';

/**
 * String packets (`docs/plans/string-packets.md`): each catalog string's 10 m
 * retail packet, drawn from data and pre-rendered to `public/strings/`.
 */

type Row = { id: string; category: string; brand: string };
const strings = (catalogSeed as unknown as { items: Row[] }).items.filter((r) => r.category === 'string');
const DIR = join(process.cwd(), 'public', 'strings');

describe('the packet table', () => {
  it('names only catalog strings', () => {
    const ids = new Set(strings.map((s) => s.id));
    expect(Object.keys(STRING_PACKS).filter((id) => !ids.has(id))).toEqual([]);
  });

  it('every packet is well formed', () => {
    const bad = Object.entries(STRING_PACKS).flatMap(([id, p]) => packProblems(p).map((m) => `${id}: ${m}`));
    expect(bad).toEqual([]);
  });

  it("never prints a maker's name: the logo and wordmark are left off", () => {
    const makers = /\b(yonex|victor|li-?ning)\b/i;
    const bad = Object.entries(STRING_PACKS).flatMap(([id, p]) => (p.texts ?? []).filter((t) => makers.test(t.text)).map((t) => `${id}: ${t.text}`));
    expect(bad).toEqual([]);
  });

  it('the id list the app reads is exactly the table', () => {
    expect([...STRING_PACK_IDS].sort()).toEqual(Object.keys(STRING_PACKS).sort());
  });

  it('the table rides only with the render page: no screen imports it', () => {
    const scan = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? scan(join(dir, e.name)) : /\.tsx?$/.test(e.name) ? [join(dir, e.name)] : []);
    const importers = ['app', 'components', 'lib'].flatMap((d) => scan(join(process.cwd(), d)))
      .filter((f) => /from ['"](@\/lib|\.\.?(\/\.\.)*\/lib|\.)\/stringPacks['"]/.test(readFileSync(f, 'utf8')))
      .map((f) => f.slice(process.cwd().length + 1));
    expect(importers).toEqual(['app/design/string-render/page.tsx']);
  });
});

describe('pre-rendered packets', () => {
  // Re-run `node scripts/render-string-images.mjs` against a dev server when
  // either fails: the images are drawn from the table, never by hand.
  it('every packet has an image', () => {
    expect(STRING_PACK_IDS.filter((id) => !existsSync(join(DIR, `${id}.webp`)))).toEqual([]);
  });

  it('no image is left behind for a packet the table no longer has', () => {
    const known = new Set(STRING_PACK_IDS);
    const stray = existsSync(DIR) ? readdirSync(DIR).filter((f) => f.endsWith('.webp') && !known.has(f.replace(/\.webp$/, ''))) : [];
    expect(stray).toEqual([]);
  });

  it('a string with no packet has no picture, rather than a placeholder', () => {
    expect(stringPackSrc('string-nobody-makes-this')).toBeNull();
    expect(stringPackSrc(null)).toBeNull();
    for (const id of STRING_PACK_IDS) expect(stringPackSrc(id)).toMatch(new RegExp(`/strings/${id}\\.webp$`));
  });
});
