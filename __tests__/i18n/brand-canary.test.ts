// @vitest-environment node
/**
 * THE PRODUCT'S NAME LIVES IN ONE CONSTANT, AND THIS IS WHAT KEEPS IT THERE.
 *
 * Multi-group splits "BPM Badminton" into two things that used to be one: the
 * name of a CLUB, and the name of the APP. `lib/brand.ts` owns the second, the
 * `Group` document owns the first, and the whole value of Phase 4 is that a
 * stranger who joins their own club never sees somebody else's club name on
 * the splash screen or at the foot of a password-reset email.
 *
 * That property is invisible today — the flag is off and BPM is the only club,
 * so every wrong answer happens to be right. It stays invisible right up to the
 * cutover, which is exactly the shape of bug this repo keeps writing canaries
 * for. So the rule is enforced now, while it costs nothing.
 *
 * Deliberately NOT asserted: what the name actually is. The plan records "Name
 * is Grant's, set in one constant", and a test pinning the literal string would
 * make the rename this phase exists to enable into a test-editing exercise.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import {
  APP_NAME,
  APP_SHORT_NAME,
  BRAND_TOKEN,
  BRAND_SHORT_TOKEN,
  applyBrand,
} from '@/lib/brand';
import { brandMessages, deepMerge } from '@/i18n/request';
import en from '@/messages/en.json';
import zh from '@/messages/zh-CN.json';

// Mirrors i18n/request.ts's MessageTree without exporting it from there.
type Node = string | Node[] | Tree;
type Tree = { [key: string]: Node };

/** Every string in a message tree, arrays included. */
function strings(node: unknown, out: string[] = []): string[] {
  if (typeof node === 'string') out.push(node);
  else if (Array.isArray(node)) node.forEach((n) => strings(n, out));
  else if (node && typeof node === 'object') Object.values(node).forEach((n) => strings(n, out));
  return out;
}

describe('applyBrand', () => {
  it('substitutes both tokens', () => {
    expect(applyBrand(`Add ${BRAND_SHORT_TOKEN} to your home screen`)).toBe(
      `Add ${APP_SHORT_NAME} to your home screen`,
    );
    expect(applyBrand(`${BRAND_TOKEN} didn't load`)).toBe(`${APP_NAME} didn't load`);
  });

  it('substitutes every occurrence, not just the first', () => {
    const out = applyBrand(`${BRAND_SHORT_TOKEN} and ${BRAND_SHORT_TOKEN}`);
    expect(out).toBe(`${APP_SHORT_NAME} and ${APP_SHORT_NAME}`);
  });

  it('leaves a string with no token exactly alone', () => {
    expect(applyBrand('Sign up for weekly badminton')).toBe('Sign up for weekly badminton');
  });
});

describe('brandMessages', () => {
  it('walks ARRAYS rather than spreading them', () => {
    // The legal pages hold their copy as arrays read with `t.raw` and `.map`.
    // An implementation that treated an array as a plain object would turn it
    // into an index-keyed map, and the page — not any test — would throw.
    const out = brandMessages({ legal: { sections: [`${BRAND_TOKEN} is a tool`, 'plain'] } } as Tree);
    const sections = (out.legal as Tree).sections;
    expect(Array.isArray(sections)).toBe(true);
    expect(sections).toEqual([`${APP_NAME} is a tool`, 'plain']);
  });

  it('reaches arbitrarily deep', () => {
    const out = brandMessages({ a: { b: { c: { d: BRAND_SHORT_TOKEN } } } } as Tree);
    expect((((out.a as Tree).b as Tree).c as Tree).d).toBe(APP_SHORT_NAME);
  });

  it('brands the tree deepMerge produces, so a locale cannot disagree', () => {
    const merged = brandMessages(deepMerge(en as Tree, zh as Tree));
    expect(strings(merged).some((s) => s.includes(BRAND_TOKEN))).toBe(false);
    expect(strings(merged).some((s) => s.includes(BRAND_SHORT_TOKEN))).toBe(false);
  });
});

describe('the message files carry tokens, never the literal name', () => {
  // If a new string hardcodes the name, renaming the product leaves it behind —
  // and it will be a string somebody reads, because these files are only UI.
  for (const [label, tree] of [['en', en], ['zh-CN', zh]] as const) {
    it(`${label} has no hardcoded product name`, () => {
      const offenders = strings(tree).filter(
        (s) => s.includes(APP_NAME) || /\bBPM\b/.test(s),
      );
      expect(offenders).toEqual([]);
    });

    it(`${label} still carries the tokens (an empty sweep would pass vacuously)`, () => {
      const tokened = strings(tree).filter(
        (s) => s.includes(BRAND_TOKEN) || s.includes(BRAND_SHORT_TOKEN),
      );
      expect(tokened.length).toBeGreaterThan(5);
    });
  }
});

describe('no source file hardcodes the product name', () => {
  /**
   * The four exemptions are CLUB data or a club-specific surface, not brand.
   *
   * Each writes or renders group #1's own name, and wiring any of them to
   * `APP_NAME` would mean renaming the product silently renamed Grant's club —
   * in a durable Cosmos document, in two of the four cases.
   */
  const EXEMPT: Record<string, string> = {
    'lib/cosmos.ts': "the dev seed's group doc — group #1's own club name",
    'lib/groupBackfill.ts': "the backfill's group creation — writes the CLUB's name, durably",
    'app/opengraph-image.tsx':
      'the share card for the app’s one public URL, which is BPM’s; a per-group card needs a per-group URL first',
    'lib/brand.ts': 'the constant itself, and the prose explaining what it is not',
  };

  function walk(dir: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir)) {
      if (entry === 'node_modules' || entry.startsWith('.')) continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) out.push(...walk(full));
      else if (/\.tsx?$/.test(entry)) out.push(full);
    }
    return out;
  }

  it('every literal is either gone or exempt with a reason', () => {
    const root = process.cwd();
    const offenders: string[] = [];
    for (const dir of ['app', 'lib', 'components']) {
      for (const file of walk(join(root, dir))) {
        const rel = file.slice(root.length + 1);
        if (EXEMPT[rel]) continue;
        if (readFileSync(file, 'utf8').includes(APP_NAME)) offenders.push(rel);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('the exemption list has no dead entries', () => {
    const root = process.cwd();
    const stale = Object.keys(EXEMPT).filter((rel) => {
      try {
        return !readFileSync(join(root, rel), 'utf8').includes(APP_NAME);
      } catch {
        return true; // the file is gone
      }
    });
    expect(stale).toEqual([]);
  });
});
