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

// `\s*` around the glyph is load-bearing. Without it this only matched spans
// written on ONE line, and a span with three or four props is wrapped by every
// formatter — glyph on its own line, indented. Every icon in the gear sheets
// was written that way, so `check` shipped rendering as the literal text
// "CHECK" with this test green. The blind spot was the common formatting, not
// an exotic one.
const GLYPH_RE_SOURCE = '<span[^>]*class(?:Name)?="[^"]*\\bmaterial-icons\\b[^"]*"[^>]*>\\s*([a-z0-9_]+)\\s*</span>';

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

  /**
   * A glyph chosen by an expression — `{open ? 'expand_less' : 'expand_more'}`
   * — is not a literal child, so neither pattern above sees it. Pull the
   * string literals out of any braced child of a material-icons span and check
   * those too. Both arms of a toggle have to be in the subset: the one that
   * only appears after a tap is exactly the one nobody notices is broken.
   */
  it('every glyph named inside a material-icons expression is in the subset URL', () => {
    const subset = extractSubset();
    const files = SCAN_DIRS.flatMap(walk);
    const missing: { file: string; glyph: string }[] = [];

    for (const file of files) {
      const src = readFileSync(file, 'utf8');
      const spanRe = /<span[^>]*class(?:Name)?="[^"]*\bmaterial-icons\b[^"]*"[^>]*>\s*\{([^}]*)\}\s*<\/span>/g;
      let m: RegExpExecArray | null;
      while ((m = spanRe.exec(src))) {
        // Drop comparison operands first. In `{theme === 'dark' ? 'light_mode'
        // : 'dark_mode'}` the glyphs are the BRANCHES; `'dark'` is what is
        // being tested, and reporting it as a missing glyph is noise that
        // would get this whole check deleted.
        const branches = m[1].replace(/[!=]==?\s*'[a-z0-9_]+'/g, '');
        for (const lit of branches.matchAll(/'([a-z0-9_]+)'/g)) {
          if (!subset.has(lit[1])) missing.push({ file: file.replace(ROOT + '/', ''), glyph: lit[1] });
        }
      }
    }

    const message =
      missing.length === 0
        ? ''
        : 'Missing expression-chosen glyphs in app/layout.tsx icon_names URL:\n' +
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
