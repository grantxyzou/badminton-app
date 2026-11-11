import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * Every transition and animation in globals.css takes its time from the
 * duration ladder (#826). The motion pass named the rungs by role
 * (`--duration-press` 100 / `-fast` 150 / `-sheet` 180 / `-normal` 250 /
 * `-slow` 400) and two one-offs (`--duration-celebrate`, `--duration-flourish`),
 * but nothing checked a call site, and 34 literals had drifted in, 16 of them
 * equal to a rung. A literal may not sit off the ladder; a named token may.
 *
 * Scope is `ms` literals, the 34 the proposal named. Durations written in
 * SECONDS (`0.25s`, the `1s` spinners, the 14s aurora) are not checked yet:
 * the looping ones are not ladder moments, and the rest are a separate
 * ui-truth finding.
 *
 * Allowed: `0ms` (off, not a speed), `0.01ms` (the reduced-motion
 * zeroing), an `!important` line (the reduced-motion overrides), and a number
 * inside `var(--x, <fallback>)`.
 */
const css = readFileSync('app/globals.css', 'utf8');

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
    const bare = line.replace(/var\([^()]*\)/g, '');
    for (const m of bare.matchAll(/(?<![\d.\w-])(\d+(?:\.\d+)?)ms\b/g)) {
      if (Number(m[1]) === 0 || m[1] === '0.01') continue;
      out.push(`globals.css:${i + 1}: ${line.trim()}`);
      break;
    }
  });
  return out;
}

describe('motion duration canary', () => {
  it('no transition or animation in globals.css types its own duration', () => {
    expect(offenders(css)).toEqual([]);
  });

  it('defines the ladder and the two named one-offs', () => {
    for (const t of ['press', 'fast', 'sheet', 'normal', 'slow', 'celebrate', 'flourish']) {
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
  });
});
