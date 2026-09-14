import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';

/**
 * ONE SHEET SIZE, APP-WIDE (Grant, 2026-09-14: "Action sheet are not the same
 * size app wide").
 *
 * Every <BottomSheet> used to pick its own: three widths (`narrow` 384px, the
 * default 512px, `full`) and NINE height caps, from 50vh to 92dvh. The same
 * kind of sheet opened at a different size depending on which screen it came
 * from. The primitive now owns both — `.bottom-sheet` reads `--sheet-max-w`
 * and `--sheet-max-h` from globals.css — and a sheet's height still follows its
 * content up to that one cap.
 *
 * jsdom applies no stylesheet, so this is a SOURCE scan: no call site may pass
 * `width` or `maxHeight`, or smuggle a size back in through `className`.
 */
const ROOT = process.cwd();

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : /\.tsx$/.test(p) ? [p] : [];
  });
}

const SIZE_CLASS = /(^|\s)(max-w-|max-h-|min-h-|h-\[|w-\[|mx-auto)/;

describe('every BottomSheet is the same size', () => {
  const files = ['components', 'app'].flatMap((d) => walk(join(ROOT, d)));
  const sheets: { where: string; attrs: string[]; className: string }[] = [];
  for (const f of files) {
    const text = readFileSync(f, 'utf8');
    if (!text.includes('<BottomSheet')) continue;
    const src = ts.createSourceFile(f, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const visit = (n: ts.Node) => {
      if ((ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) && n.tagName.getText() === 'BottomSheet') {
        const attrs: string[] = [];
        let className = '';
        for (const a of n.attributes.properties) {
          if (!ts.isJsxAttribute(a)) continue;
          const name = a.name.getText();
          attrs.push(name);
          if (name === 'className') className = a.initializer?.getText() ?? '';
        }
        const line = src.getLineAndCharacterOfPosition(n.getStart()).line + 1;
        sheets.push({ where: `${relative(ROOT, f)}:${line}`, attrs, className });
      }
      ts.forEachChild(n, visit);
    };
    visit(src);
  }

  it('finds the sheets', () => {
    expect(sheets.length).toBeGreaterThan(30);
  });

  it('no call site sets a width or a height cap', () => {
    const offenders = sheets
      .filter((s) => s.attrs.includes('width') || s.attrs.includes('maxHeight') || SIZE_CLASS.test(s.className))
      .map((s) => `${s.where} ${s.attrs.join(',')} ${s.className}`);
    expect(offenders, 'the sheet size lives in .bottom-sheet (globals.css), not at the call site').toEqual([]);
  });

  it('the primitive takes no size props and globals.css owns both caps', () => {
    const primitive = readFileSync(join(ROOT, 'components/BottomSheet/BottomSheet.tsx'), 'utf8');
    expect(primitive).not.toMatch(/maxHeight/);
    expect(primitive).not.toMatch(/max-w-(sm|lg)/);

    const css = readFileSync(join(ROOT, 'app/globals.css'), 'utf8');
    expect(css).toMatch(/--sheet-max-w:\s*32rem;/);
    expect(css).toMatch(/--sheet-max-h:\s*88dvh;/);
    const rule = css.match(/\n\.bottom-sheet\s*\{[^}]*\}/)?.[0] ?? '';
    expect(rule).toMatch(/max-width:\s*var\(--sheet-max-w\)/);
    expect(rule).toMatch(/max-height:\s*var\(--sheet-max-h\)/);
    expect(rule).toMatch(/margin-inline:\s*auto/);
  });
});
