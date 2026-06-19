import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..');
const SCAN_DIRS = ['components', 'app'].map((d) => join(ROOT, d));
const EXTS = ['.tsx', '.ts'];

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...walk(full));
    } else if (EXTS.some((e) => full.endsWith(e))) {
      out.push(full);
    }
  }
  return out;
}

function extractSubset(): Set<string> {
  const layout = readFileSync(join(ROOT, 'app', 'layout.tsx'), 'utf8');
  const match = layout.match(/icon_names=([a-z0-9_,]+)/);
  if (!match) throw new Error('icon_names URL param not found in app/layout.tsx');
  return new Set(match[1].split(','));
}

const GLYPH_RE_SOURCE = '<span[^>]*class(?:Name)?="[^"]*\\bmaterial-icons\\b[^"]*"[^>]*>([a-z0-9_]+)</span>';

describe('Material Symbols icon subset', () => {
  it('every literal material-icons span usage is in the subset URL', () => {
    const subset = extractSubset();
    const files = SCAN_DIRS.flatMap(walk);
    const missing: { file: string; glyph: string }[] = [];

    for (const file of files) {
      const src = readFileSync(file, 'utf8');
      const re = new RegExp(GLYPH_RE_SOURCE, 'g');
      let m: RegExpExecArray | null;
      while ((m = re.exec(src))) {
        const glyph = m[1];
        if (!subset.has(glyph)) {
          missing.push({ file: file.replace(ROOT + '/', ''), glyph });
        }
      }
    }

    const message =
      missing.length === 0
        ? ''
        : 'Missing glyphs in app/layout.tsx icon_names URL:\n' +
          missing.map((x) => '  - "' + x.glyph + '" used in ' + x.file).join('\n') +
          '\nAdd the glyph names to the URL or they will render as raw text.';
    expect(missing, message).toEqual([]);
  });

  // Data-driven icons (`icon: 'flag'` in a SettingsList/rows array) don't match
  // the literal-span regex above, so a missing glyph there renders as raw text
  // with no test failure — exactly how the "Report a problem" flag icon shipped
  // broken. Catch those `icon: '<glyph>'` string literals too.
  it('every data-driven icon: \'<glyph>\' prop is in the subset URL', () => {
    const subset = extractSubset();
    const files = SCAN_DIRS.flatMap(walk);
    const missing: { file: string; glyph: string }[] = [];

    for (const file of files) {
      const src = readFileSync(file, 'utf8');
      const re = /\bicon:\s*'([a-z0-9_]+)'/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(src))) {
        const glyph = m[1];
        if (!subset.has(glyph)) {
          missing.push({ file: file.replace(ROOT + '/', ''), glyph });
        }
      }
    }

    const message =
      missing.length === 0
        ? ''
        : 'Missing data-driven icon glyphs in app/layout.tsx icon_names URL:\n' +
          missing.map((x) => '  - "' + x.glyph + '" used in ' + x.file).join('\n') +
          '\nAdd the glyph names to the URL or they will render as raw text.';
    expect(missing, message).toEqual([]);
  });
});
