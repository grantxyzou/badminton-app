import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';

/**
 * Every sheet, by source (the Apple pass, 2026-11-12). The browser checks —
 * axe-core and the 44pt tap probe — opened eight sheets of ~59; this holds the
 * three things they found for ALL of them, because a sheet nobody opens in a
 * test is still opened by a member:
 *
 *   1. every field has a name a screen reader can say: an aria-label, a
 *      placeholder (axe and VoiceOver both read it), a <label> around it, or a
 *      <label htmlFor> naming its id. A `<label>` written BESIDE a field names
 *      nothing — `BirdSheetField` and the receipt's "Recipient" did that;
 *   2. no button is drawn under 44px without a 44pt tap (`.tap-44*`);
 *   3. no icon-only button is nameless.
 *
 * A source scan, so it cannot see a name added at runtime by a wrapper
 * component: those files are listed in WRAPPED with the reason.
 */
const ROOT = join(__dirname, '..');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.tsx')) out.push(p);
  }
  return out;
}

const SHEETS = [...walk(join(ROOT, 'components')), ...walk(join(ROOT, 'app'))]
  .filter((f) => readFileSync(f, 'utf8').includes('<BottomSheet'))
  .map((f) => relative(ROOT, f));

/** Fields named at runtime by a wrapper this scan cannot follow. */
const WRAPPED: Record<string, string> = {
  'components/admin/CommandCenter/StringPurchaseSheet.tsx': '`Field` renders a <label> around its child',
  'components/admin/CommandCenter/StringShelfSheet.tsx': '`FilledField` renders <label htmlFor={id}>',
};

const line = (s: string, at: number) => s.slice(0, at).split('\n').length;

describe('every sheet', () => {
  it('is found (the scan is not silently empty)', () => {
    expect(SHEETS.length).toBeGreaterThan(40);
  });

  it('gives every field a name', () => {
    const unnamed: string[] = [];
    for (const f of SHEETS) {
      if (WRAPPED[f]) continue;
      const s = readFileSync(join(ROOT, f), 'utf8');
      for (const m of s.matchAll(/<(input|select|textarea)\b((?:=>|[^>])*?)\/?>/gs)) {
        const attrs = m[2];
        if (/type="(hidden|checkbox|radio|file)"|\bhidden\b/.test(attrs)) continue;
        if (/aria-label|aria-labelledby|placeholder=|title=/.test(attrs)) continue;
        const id = /\bid=\{?"?([^"}\s]+)/.exec(attrs)?.[1];
        if (id && new RegExp(`htmlFor=\\{?"?${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(s)) continue;
        const before = s.slice(Math.max(0, (m.index ?? 0) - 800), m.index);
        if (before.lastIndexOf('<label') > before.lastIndexOf('</label>')) continue;
        unnamed.push(`${f}:${line(s, m.index ?? 0)}`);
      }
    }
    expect(unnamed).toEqual([]);
  });

  it('draws no button under 44px without a 44pt tap', () => {
    const small: string[] = [];
    for (const f of SHEETS) {
      const s = readFileSync(join(ROOT, f), 'utf8');
      for (const m of s.matchAll(/<button\b((?:=>|[^>])*?)>/gs)) {
        const under = [...m[1].matchAll(/\b(width|height):\s*(\d+)\b/g)].filter((d) => Number(d[2]) < 44);
        if (under.length > 0 && !m[1].includes('tap-44')) small.push(`${f}:${line(s, m.index ?? 0)}`);
      }
    }
    expect(small).toEqual([]);
  });

  it('names every icon-only button', () => {
    const nameless: string[] = [];
    for (const f of SHEETS) {
      const s = readFileSync(join(ROOT, f), 'utf8');
      for (const m of s.matchAll(/<button\b((?:=>|[^>])*?)>\s*<span className="material-icons[^"]*"[^>]*>[a-z_]+<\/span>\s*<\/button>/gs)) {
        if (!m[1].includes('aria-label')) nameless.push(`${f}:${line(s, m.index ?? 0)}`);
      }
    }
    expect(nameless).toEqual([]);
  });

  it('keeps every WRAPPED entry a real sheet', () => {
    for (const f of Object.keys(WRAPPED)) expect(SHEETS).toContain(f);
  });
});
