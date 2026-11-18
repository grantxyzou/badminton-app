import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Every transition and animation takes its time from the duration ladder
 * (#826). The motion pass named the rungs by role (`--duration-press` 100 /
 * `-fast` 150 / `-sheet` 180 / `-normal` 250 / `-slow` 400) and named one-offs
 * (`--duration-celebrate`, `-flourish`, `-pop`), but nothing checked a call
 * site, and 34 literals had drifted in, 16 of them equal to a rung. A literal
 * may not sit off the ladder; a named token may.
 *
 * What it reads (widened 2026-11-18, after a review of #994 found the holes):
 * - Whole DECLARATIONS, not lines. A `transition:` whose parts sit on the
 *   lines under it was invisible to the first, line-based scan, and eight
 *   such rules still typed their own time when #994 said none did.
 * - `ms` and seconds, with or without a leading zero (`.25s`).
 * - Every CSS file under app/ and components/ (globals.css and the modules).
 * - Inline styles in .ts/.tsx under app/, components/ and lib/: `transition`,
 *   `animation`, their `Duration` longhands and `WebkitTransition`, in quotes
 *   or backticks. A `${CONST}ms` is already named and passes; a literal
 *   beside it does not. Comments are not code and are skipped on both sides.
 *   `animationDelay` offsets (a shimmer phase, a stagger) are not durations.
 *   `DevPanel` (`?dev` only) is out of scope, as in the token sweep.
 *
 * Looping and timeline animations are not ladder moments and are exempt BY
 * KEYFRAME NAME (`NOT_LADDER`), per animation in a comma list, matched whole
 * (`spin` does not exempt `spin-fast`), on both sides. A name whose keyframe
 * is gone fails as stale.
 *
 * Allowed: `0ms` / `0s` (off, not a speed), `0.01ms` (the reduced-motion
 * zeroing), an `!important` declaration (the reduced-motion overrides), a
 * negative delay (a phase offset into a loop), and a number inside
 * `var(--x, <fallback>)`.
 */
const css = readFileSync('app/globals.css', 'utf8');

/** Looping or timeline animations: their length is not a UI moment.
 *  Each entry is a keyframe-name pattern, matched as the WHOLE name. */
const NOT_LADDER = [
  'aurora-drift', // the 14s background drift, infinite
  'spin', // spinners, infinite
  'shimmer', // skeleton shimmer, infinite
  'splash-failsafe', // a 10s timer that lifts the launch screen if JS never arrives
  'ss-[\\w-]+', // the stringing demo: one scripted 12s timeline, every `ss-` keyframe
  'courtside-voice-pulse', // the listening pulse, infinite
];
const exempt = new RegExp(`^(?:${NOT_LADDER.join('|')})$`);

// A positive time: digits with an optional fraction, or a bare fraction.
// Not after a word character, a dot or a minus (a name, a decimal, a delay offset).
const DURATION = /(?<![\w.-])(\d*\.?\d+)(ms|s)\b/g;
const isOff = (n: string, unit: string) => Number(n) === 0 || (unit === 'ms' && n === '0.01');

/** Split on commas that are not inside parentheses (`cubic-bezier(a, b, c, d)`). */
function topLevelParts(value: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < value.length; i++) {
    if (value[i] === '(') depth++;
    else if (value[i] === ')') depth--;
    else if (value[i] === ',' && depth === 0) {
      parts.push(value.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(value.slice(start));
  return parts;
}

/** True when one transition/animation value types its own time. */
function typesItsOwnTime(prop: string, value: string): boolean {
  if (/!important/.test(value)) return false;
  if (/delay$/i.test(prop) && value.trim().startsWith('-')) return false;
  const isAnimationShorthand = /^animation$/i.test(prop);
  return topLevelParts(value).some((part) => {
    if (isAnimationShorthand) {
      const name = part.trim().split(/\s+/)[0] ?? '';
      if (exempt.test(name)) return false;
    }
    let bare = part;
    // var() may nest (`var(--a, var(--b, 200ms))`): peel innermost first.
    while (/var\([^()]*\)/.test(bare)) bare = bare.replace(/var\([^()]*\)/g, '');
    return [...bare.matchAll(DURATION)].some((d) => !isOff(d[1], d[2]));
  });
}

/** Blank out comments, keeping newlines so line numbers survive. */
const blank = (s: string) => s.replace(/[^\n]/g, ' ');
const stripCssComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, blank);
const stripJsComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, blank).replace(/(^|[^:'"`\\])\/\/[^\n]*/g, (m, pre) => pre + blank(m.slice(pre.length)));

const lineOf = (source: string, index: number) => source.slice(0, index).split('\n').length;

function cssOffenders(source: string, file = 'globals.css'): string[] {
  const text = stripCssComments(source);
  const out: string[] = [];
  for (const m of text.matchAll(/(?<![\w-])((?:transition|animation)(?:-duration|-delay)?)\s*:([^;{}]*)/g)) {
    if (typesItsOwnTime(m[1], m[2])) {
      out.push(`${file}:${lineOf(text, m.index ?? 0)}: ${m[1]}: ${m[2].replace(/\s+/g, ' ').trim()}`);
    }
  }
  return out;
}

function inlineOffenders(source: string, file: string): string[] {
  const text = stripJsComments(source);
  const out: string[] = [];
  const decl = /\b(transition|animation|transitionDuration|animationDuration|WebkitTransition)\s*:\s*(['"`])([\s\S]*?)\2/g;
  for (const m of text.matchAll(decl)) {
    // `${CONST}ms` is a named time; any other `${…}` is a value, not a time.
    const value = m[3].replace(/\$\{[^}]*\}(ms|s)?/g, 'x');
    const prop = m[1].replace(/^WebkitTransition$/, 'transition').replace(/Duration$/, '-duration');
    if (typesItsOwnTime(prop, value)) out.push(`${file}:${lineOf(text, m.index ?? 0)}: ${m[0].replace(/\s+/g, ' ')}`);
  }
  return out;
}

function walk(dir: string, keep: (path: string) => boolean): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === 'node_modules' ? [] : walk(path, keep);
    return keep(path) ? [path] : [];
  });
}

const cssFiles = [...walk('app', (p) => p.endsWith('.css')), ...walk('components', (p) => p.endsWith('.css'))];
const codeFiles = ['app', 'components', 'lib']
  .flatMap((d) => walk(d, (p) => /\.tsx?$/.test(p)))
  .filter((f) => !f.endsWith('DevPanel.tsx'));

describe('motion duration canary', () => {
  it('no stylesheet types its own duration in a transition or animation', () => {
    expect(cssFiles.flatMap((f) => cssOffenders(readFileSync(f, 'utf8'), f))).toEqual([]);
  });

  it('no component types its own duration in an inline transition or animation', () => {
    expect(codeFiles.flatMap((f) => inlineOffenders(readFileSync(f, 'utf8'), f))).toEqual([]);
  });

  it('exempts only keyframes that still exist', () => {
    const allCss = cssFiles.map((f) => readFileSync(f, 'utf8')).join('\n');
    for (const name of NOT_LADDER) {
      expect(allCss, `@keyframes ${name}`).toMatch(new RegExp(`@keyframes ${name}\\s*\\{`));
    }
  });

  it('defines the ladder and the three named one-offs', () => {
    for (const t of ['press', 'fast', 'sheet', 'normal', 'slow', 'celebrate', 'flourish', 'pop']) {
      expect(css, `--duration-${t}`).toMatch(new RegExp(`--duration-${t}:\\s*\\d+ms;`));
    }
  });

  it('/design/tokens shows the same time globals.css defines for every duration it lists', () => {
    const page = readFileSync('app/design/tokens/page.tsx', 'utf8');
    const listed = [...page.matchAll(/name: '(--duration-[\w-]+)',\s*value: '(\d+)ms'/g)];
    expect(listed.length).toBeGreaterThan(0);
    for (const [, name, ms] of listed) {
      expect(css, name).toMatch(new RegExp(`${name}:\\s*${ms}ms;`));
    }
  });

  it('catches the shapes it exists for, and lets the sanctioned ones through', () => {
    // CSS: one line
    expect(cssOffenders('.a { transition: opacity 120ms ease; }')).toHaveLength(1);
    expect(cssOffenders('.a { transition: opacity 0.2s ease; }')).toHaveLength(1);
    expect(cssOffenders('.a { transition: opacity .25s ease; }')).toHaveLength(1);
    expect(cssOffenders('.a { transition-duration: 0ms; }')).toEqual([]);
    expect(cssOffenders('.a { transition: opacity var(--duration-fast) ease, visibility 0s; }')).toEqual([]);
    expect(cssOffenders('.a { animation: ring var(--toast-duration, 6000ms) linear; }')).toEqual([]);
    expect(cssOffenders('  * { transition-duration: 150ms !important; }')).toEqual([]);
    expect(cssOffenders('/* transition: opacity 120ms */')).toEqual([]);
    expect(cssOffenders('.a { transition: transform var(--duration-normal) cubic-bezier(0.34, 1.2, 0.64, 1); }')).toEqual([]);
    // CSS: across lines
    expect(cssOffenders('.a {\n  transition:\n    background 0.25s ease,\n    color var(--duration-fast);\n}')).toHaveLength(1);
    expect(cssOffenders('.a {\n  transition:\n    background var(--duration-fast) ease,\n    color var(--duration-fast);\n}')).toEqual([]);
    // CSS: the exemption is per animation and by whole name
    expect(cssOffenders('.a { animation: spin 1s linear infinite; }')).toEqual([]);
    expect(cssOffenders('.a { animation: spinner-new 1s linear infinite; }')).toHaveLength(1);
    expect(cssOffenders('.a { animation: spin-fast 300ms ease; }')).toHaveLength(1);
    expect(cssOffenders('.a { animation: spin 1s linear infinite, fade-in 300ms ease; }')).toHaveLength(1);
    expect(cssOffenders('.a { animation-delay: -5s; }')).toEqual([]);
    // Inline
    expect(inlineOffenders("style={{ transition: 'background 0.1s' }}", 'x')).toHaveLength(1);
    expect(inlineOffenders("style={{ transition: 'width var(--duration-sheet) ease' }}", 'x')).toEqual([]);
    expect(inlineOffenders('style={{ transition: `transform ${ZOOM_MS}ms ease` }}', 'x')).toEqual([]);
    expect(inlineOffenders('style={{ transition: `transform ${ZOOM_MS}ms ease, opacity 200ms` }}', 'x')).toHaveLength(1);
    expect(inlineOffenders("style={{ transitionDuration: '200ms' }}", 'x')).toHaveLength(1);
    expect(inlineOffenders("style={{ animation: 'spin 1s linear infinite' }}", 'x')).toEqual([]);
    expect(inlineOffenders("style={{ animationDelay: '120ms' }}", 'x')).toEqual([]);
    expect(inlineOffenders("// was transition: 'background 0.1s'", 'x')).toEqual([]);
    expect(inlineOffenders("{/* transition: 'background 0.1s' */}", 'x')).toEqual([]);
  });
});
