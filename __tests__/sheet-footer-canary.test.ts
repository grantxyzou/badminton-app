import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';

/**
 * A SHEET'S MAIN ACTION IS PINNED (Grant, 2026-11-11, on the design canvas:
 * "For all CTA that show up on an action sheet, … make it anchored to the
 * bottom of the screen").
 *
 * The button that finishes a sheet goes in `<BottomSheetFooter>`, a sibling
 * after `<BottomSheetBody>`, so it stays in reach while the content scrolls.
 * Inside the body it is only offered to someone who scrolls to the end:
 * `GearPickSheet`'s "Add to my kit" sat under ~700px of specs.
 *
 * jsdom lays nothing out, so this is a SOURCE scan: no primary-styled button
 * (`btn-primary` / `cc-btn-primary`) may sit inside a `<BottomSheetBody>`,
 * unless its file is listed below with the reason it belongs in the content.
 * An entry that no longer matches anything fails too, so the list only shrinks.
 */
const ROOT = process.cwd();
const PRIMARY = /\b(cc-btn-primary|btn-primary)\b/;

const EXEMPT: Record<string, string> = {
  'components/admin/CoverSheet.tsx':
    'A choice sheet: each mode\'s body IS the competing answers to its title\'s question ("I\'ll cover it" / "Split it across everyone else"), each with its caption. Pinning them would leave an empty body.',
  'components/admin/CommandCenter/RosterPage.tsx':
    'The member sheet\'s Role and "In this club" toggles wear cc-btn-primary when SELECTED; they are choices, not actions. Its Save is in the footer.',
};

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : /\.tsx$/.test(p) ? [p] : [];
  });
}

function primariesInBody(file: string, text: string): number[] {
  const src = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const lines: number[] = [];
  const visit = (n: ts.Node, inBody: boolean) => {
    let here = inBody;
    if (ts.isJsxElement(n) && n.openingElement.tagName.getText() === 'BottomSheetBody') here = true;
    if (here && (ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n))) {
      for (const a of n.attributes.properties) {
        if (ts.isJsxAttribute(a) && a.name.getText() === 'className' && a.initializer && PRIMARY.test(a.initializer.getText())) {
          lines.push(src.getLineAndCharacterOfPosition(n.getStart()).line + 1);
        }
      }
    }
    ts.forEachChild(n, (c) => visit(c, here));
  };
  visit(src, false);
  return lines;
}

describe("a sheet's main action is pinned in its footer", () => {
  const files = ['components', 'app']
    .flatMap((d) => walk(join(ROOT, d)))
    .filter((f) => !f.includes(join('components', 'BottomSheet')));
  const found = new Map<string, number[]>();
  for (const f of files) {
    const text = readFileSync(f, 'utf8');
    if (!text.includes('<BottomSheetBody')) continue;
    const hits = primariesInBody(f, text);
    if (hits.length) found.set(relative(ROOT, f), hits);
  }

  it('finds no primary button inside a sheet body outside the exemptions', () => {
    const offenders = [...found]
      .filter(([f]) => !(f in EXEMPT))
      .map(([f, ls]) => `${f}:${ls.join(',')}`);
    expect(offenders).toEqual([]);
  });

  it('carries no stale exemption', () => {
    expect(Object.keys(EXEMPT).filter((f) => !found.has(f))).toEqual([]);
  });

  it('gives every exemption a reason', () => {
    for (const [f, why] of Object.entries(EXEMPT)) expect(why.length, f).toBeGreaterThan(20);
  });
});
