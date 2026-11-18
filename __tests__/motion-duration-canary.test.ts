import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Every transition and animation in globals.css takes its time from the
 * duration ladder (#826). The motion pass named the rungs by role
 * (`--duration-press` 100 / `-fast` 150 / `-sheet` 180 / `-normal` 250 /
 * `-slow` 400) and named one-offs (`--duration-celebrate`, `-flourish`, `-pop`),
 * but nothing checked a call site, and 34 literals had drifted in, 16 of them
 * equal to a rung. A literal may not sit off the ladder; a named token may.
 *
 * Scope is `ms` AND seconds literals (seconds since 2026-11-18: five `0.1s`
 * to `0.25s` transitions had slipped past an ms-only scan). The looping and
 * timeline animations are not ladder moments and are exempt BY KEYFRAME NAME
 * (`NOT_LADDER`), so a new `animation: foo 2s` still fails, and a name that
 * stops matching fails as stale.
 *
 * Inline styles count too: a `transition:` / `animation:` string in a
 * component types its own time exactly as a CSS rule would. A `${CONST}ms`
 * template is already named and passes. `animationDelay` offsets (a
 * skeleton's shimmer phase, a stagger) are not durations and are not checked.
 * `DevPanel` (`?dev` only) is out of scope, as in the token sweep.
 *
 * Allowed: `0ms` / `0s` (off, not a speed), `0.01ms` (the reduced-motion
 * zeroing), an `!important` line (the reduced-motion overrides), and a number
 * inside `var(--x, <fallback>)`.
 */
const css = readFileSync('app/globals.css', 'utf8');

/** Looping or timeline animations: their length is not a UI moment.
 *  Each entry is a keyframe-name pattern. */
const NOT_LADDER = [
  'aurora-drift', // the 14s background drift, infinite
  'spin', // spinners, infinite
  'shimmer', // skeleton shimmer, infinite
  'splash-failsafe', // a 10s timer that lifts the launch screen if JS never arrives
  'ss-[\\w-]+', // the stringing demo: one scripted 12s timeline, every `ss-` keyframe
  'courtside-voice-pulse', // the listening pulse, infinite
];
const DURATION = /(?<![\d.\w-])(\d+(?:\.\d+)?)(ms|s)\b/g;
const isOff = (n: string, unit: string) => Number(n) === 0 || (unit === 'ms' && n === '0.01');

function offenders(source: string): string[] {
  const out: string[] = [];
  let inComment = false;
  source.split('\n').forEach((raw, i) => {
    let line = raw;
    if (inComment) {
      const end = line.indexOf('*/');
      if (end === -1) return;
      line = line.slice(end + 2);
      inComment = false;
    }
    line = line.replace(/\/\*.*?\*\//g, '');
    const open = line.indexOf('/*');
    if (open !== -1) {
      line = line.slice(0, open);
      inComment = true;
    }
    if (!/\b(transition|animation)(-duration|-delay)?\s*:/.test(line)) return;
    if (line.includes('!important')) return;
    if (/\banimation-delay\s*:\s*-/.test(line)) return; // a phase offset into a loop
    if (NOT_LADDER.some((name) => new RegExp(`\\banimation\\s*:\\s*${name}\\b`).test(line))) return;
    const bare = line.replace(/var\([^()]*\)/g, '');
    for (const m of bare.matchAll(DURATION)) {
      if (isOff(m[1], m[2])) continue;
      out.push(`globals.css:${i + 1}: ${line.trim()}`);
      break;
    }
  });
  return out;
}

/** Inline `transition:` / `animation:` string literals in components and pages. */
function inlineOffenders(source: string, file: string): string[] {
  const out: string[] = [];
  source.split('\n').forEach((line, i) => {
    for (const m of line.matchAll(/\b(transition|animation)\s*:\s*(['"])(.*?)\2/g)) {
      const bare = m[3].replace(/var\([^()]*\)/g, '');
      if ([...bare.matchAll(DURATION)].some((d) => !isOff(d[1], d[2]))) {
        out.push(`${file}:${i + 1}: ${line.trim()}`);
      }
    }
  });
  return out;
}

function tsxFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return tsxFiles(path);
    return path.endsWith('.tsx') ? [path] : [];
  });
}

describe('motion duration canary', () => {
  it('no transition or animation in globals.css types its own duration', () => {
    expect(offenders(css)).toEqual([]);
  });

  it('no component types its own duration in an inline transition or animation', () => {
    const files = [...tsxFiles('components'), ...tsxFiles('app')].filter((f) => !f.endsWith('DevPanel.tsx'));
    expect(files.flatMap((f) => inlineOffenders(readFileSync(f, 'utf8'), f))).toEqual([]);
  });

  it('exempts only keyframes that still exist', () => {
    for (const name of NOT_LADDER) {
      expect(css, `@keyframes ${name}`).toMatch(new RegExp(`@keyframes ${name}\\s*\\{`));
    }
  });

  it('defines the ladder and the three named one-offs', () => {
    for (const t of ['press', 'fast', 'sheet', 'normal', 'slow', 'celebrate', 'flourish', 'pop']) {
      expect(css, `--duration-${t}`).toMatch(new RegExp(`--duration-${t}:\\s*\\d+ms;`));
    }
  });

  it('catches the shapes it exists for, and lets the sanctioned ones through', () => {
    expect(offenders('.a { transition: opacity 120ms ease; }')).toHaveLength(1);
    expect(offenders('.a { transition-duration: 0ms; }')).toEqual([]);
    expect(offenders('.a { transition: opacity var(--duration-fast) ease, visibility 0s; }')).toEqual([]);
    expect(offenders('.a { animation: ring var(--toast-duration, 6000ms) linear; }')).toEqual([]);
    expect(offenders('  * { transition-duration: 150ms !important; }')).toEqual([]);
    expect(offenders('/* transition: opacity 120ms */')).toEqual([]);
    expect(offenders('.a { transition: opacity 0.2s ease; }')).toHaveLength(1);
    expect(offenders('.a { animation: spin 1s linear infinite; }')).toEqual([]);
    expect(offenders('.a { animation: spinner-new 1s linear infinite; }')).toHaveLength(1);
    expect(offenders('.a { animation-delay: -5s; }')).toEqual([]);
    expect(inlineOffenders("style={{ transition: 'background 0.1s' }}", 'x')).toHaveLength(1);
    expect(inlineOffenders("style={{ transition: 'width var(--duration-sheet) ease' }}", 'x')).toEqual([]);
    expect(inlineOffenders('style={{ transition: `transform ${ZOOM_MS}ms ease` }}', 'x')).toEqual([]);
    expect(inlineOffenders("style={{ animationDelay: '120ms' }}", 'x')).toEqual([]);
  });
});
