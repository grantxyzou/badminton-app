import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

/**
 * THE SPACING LADDER, ENFORCED.
 *
 * Two separate promises, both of which were broken before the 2026-08-27
 * spacing audit and neither of which any other test could see.
 *
 * WHY A SOURCE SCAN. jsdom applies no stylesheet, so a rendered assertion
 * about padding measures 0px — the same reason card-spacing-canary is a source
 * scan. What can be checked without a browser is whether a call site reads a
 * token or types a number, and typing a number is exactly what went wrong.
 */

const ROOT = join(__dirname, '..');

function tsx(dir: string, skip: string[] = []): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const rel = full.slice(ROOT.length + 1);
    if (skip.includes(rel)) continue;
    if (statSync(full).isDirectory()) out.push(...tsx(full, skip));
    else if (entry.endsWith('.tsx')) out.push(full);
  }
  return out;
}

/** The real values, straight out of the stylesheet that ships. */
function tokensFromCss(prefix: string): Record<string, string> {
  const css = readFileSync(join(ROOT, 'app/globals.css'), 'utf8');
  const out: Record<string, string> = {};
  const re = new RegExp(`^\\s*(--${prefix}-[a-z0-9-]+):\\s*([^;]+);`, 'gm');
  for (const m of css.matchAll(re)) {
    if (!(m[1] in out)) out[m[1]] = m[2].trim(); // first (:root) wins
  }
  return out;
}

const ladderFromCss = () => tokensFromCss('space');

describe('the design reference documents the ladder that actually ships', () => {
  it('/design/tokens matches app/globals.css rung for rung', () => {
    const real = ladderFromCss();
    const page = readFileSync(join(ROOT, 'app/design/tokens/page.tsx'), 'utf8');
    const block = page.match(/const SPACING = \[([\s\S]*?)\] as const;/);
    expect(block, 'SPACING table not found in the tokens page').toBeTruthy();

    const documented: Record<string, string> = {};
    for (const m of block![1].matchAll(/\['(--space-[a-z0-9]+)',\s*'([^']+)'/g)) {
      documented[m[1]] = m[2];
    }

    // If this fails, the page is lying to whoever reads it to pick a token —
    // which is how --space-3 came to be used as if it were 12px when it is 8px.
    expect(documented).toEqual(real);
  });

  it('/design/tokens documents the TYPE scale that actually ships', () => {
    // Same defect, same page: --fs-xs was published as 14px when it is 11px,
    // --fs-sm as 16px when it is 12px, and three of the seven rows named
    // tokens that do not exist (--fs-xl, --fs-2xl, --fs-3xl). The spacing half
    // got a canary in the audit and the type half did not, so it kept drifting.
    const real = tokensFromCss('fs');
    const page = readFileSync(join(ROOT, 'app/design/tokens/page.tsx'), 'utf8');
    const block = page.match(/const TYPE = \[([\s\S]*?)\];/);
    expect(block, 'TYPE table not found in the tokens page').toBeTruthy();

    const documented: Record<string, string> = {};
    for (const m of block![1].matchAll(/tok:\s*'(--fs-[a-z0-9-]+)\s*\/\s*([0-9]+px)'/g)) {
      documented[m[1]] = m[2];
    }

    expect(documented).toEqual(real);
  });
});

/**
 * Properties whose value is a spacing decision. `width`/`height`/`top` are not
 * here on purpose: they are sizes and positions, not rhythm.
 */
const PROPS =
  'padding|paddingTop|paddingBottom|paddingLeft|paddingRight|paddingInline|paddingBlock|' +
  'margin|marginTop|marginBottom|marginLeft|marginRight|marginInline|marginBlock|' +
  'gap|rowGap|columnGap';

const DECL = new RegExp(
  `\\b(?:${PROPS})\\s*:\\s*(?:'([^']*)'|"([^"]*)"|(-?[0-9.]+))(?=\\s*[,}\\n])`,
  'g',
);

/** Values that are not a rhythm choice and so are not the ladder's business. */
// `(?<!r)em` so `rem` is NOT treated as exempt — a rem literal is still a
// hand-typed number; only genuinely font-relative `em` is out of scope.
const NOT_SPACING = /var\(--|env\(|calc\(|%|(?<!r)em\b|vh|vw|^0$|auto|none|inherit|0 auto/;

describe('no call site hand-types a spacing value', () => {
  /**
   * app/design/** IS included. Those pages are the live, drift-proof preview
   * (docs/design-system/ is the frozen one), so their layout reads tokens like
   * everything else. Their payload — the ['--space-3', '8px'] rows — is array
   * data, not a `padding:` property, so it is never matched here.
   *
   * app/opengraph-image.tsx is the one exclusion, for a harder reason: it
   * renders through Satori, which does not resolve CSS custom properties. A
   * token there would silently resolve to nothing, so raw values are correct.
   */
  const SKIP = ['app/opengraph-image.tsx'];
  const files = [...tsx(join(ROOT, 'components')), ...tsx(join(ROOT, 'app'), SKIP)];

  /**
   * The four sanctioned exemptions, each annotated at its call site. Three are
   * BpmWordmark's `em` values (the ornament scales with the wordmark's font
   * size, so a px gap would stay put while the dots grew); the fourth is
   * bottom-nav clearance, which is a clearance and not rhythm.
   */
  const offenders: string[] = [];

  for (const file of files) {
    const src = readFileSync(file, 'utf8');
    const lines = src.split('\n');
    lines.forEach((line, i) => {
      for (const m of line.matchAll(DECL)) {
        const raw = (m[1] ?? m[2] ?? m[3]).trim();
        if (NOT_SPACING.test(raw)) continue;
        offenders.push(`${file.slice(ROOT.length + 1)}:${i + 1}  ${m[0]}`);
      }
    });
  }

  it('every inline padding, margin and gap reads a token', () => {
    // If this fails: snap the value to a rung and use var(--space-N). The
    // rungs are in app/globals.css and rendered at /bpm/design/tokens.
    expect(offenders).toEqual([]);
  });
});

describe('a pill\'s padding steps with its text', () => {
  /**
   * --fs-2xs -> 4/8, --fs-xs -> 4/12, --fs-sm and up -> 6/12. Before the audit
   * --fs-2xs pills alone were drawn at 1/6, 2/8, 3/9 and 4/8, three of them
   * inside StatusBadge itself. The spec lives in that primitive's docstring.
   */
  const EXPECTED: Record<string, string> = {
    '--fs-2xs': 'var(--space-1) var(--space-3)',
    '--fs-xs': 'var(--space-1) var(--space-4)',
  };

  const wrong: string[] = [];
  for (const file of tsx(join(ROOT, 'components'))) {
    const src = readFileSync(file, 'utf8');
    // Style objects that are pills (radius-pill) and declare both a font size
    // and a padding. Nested braces are rare enough here that a flat match is
    // honest about what it can see; what it cannot see, it skips.
    for (const m of src.matchAll(/\{[^{}]*radius-pill[^{}]*\}/g)) {
      const obj = m[0];
      const fs = obj.match(/fontSize:\s*'(--fs-[a-z0-9]+|var\(--fs-[a-z0-9]+\))'/);
      const pad = obj.match(/padding:\s*'([^']*)'/);
      if (!fs || !pad) continue;
      const key = fs[1].replace(/var\(|\)/g, '');
      const want = EXPECTED[key];
      if (want && pad[1] !== want) {
        wrong.push(`${file.slice(ROOT.length + 1)}  ${key} -> ${pad[1]} (want ${want})`);
      }
    }
  }

  it('every --fs-2xs and --fs-xs pill uses its step', () => {
    expect(wrong).toEqual([]);
  });
});
