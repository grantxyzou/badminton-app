import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';

/**
 * EVERY SHEET HAS A WAY OUT, AND NOTHING BEHIND IT IS CLICKABLE.
 *
 * Grant, 2026-09-15: "Action sheets when they are displayed we should disable
 * clicking on the item behind the sheet. Also some of the actions sheets dont
 * have a close". Eight sheets had no ✕ — "Delete account" and "Cancel your
 * spot" among them — leaving Escape as the only exit, which a phone does not
 * have. And the backdrop was `pointer-events: none`, so the dimmed page stayed
 * live under an open sheet.
 *
 * Both are source scans because jsdom applies no stylesheet and renders no
 * layout: no component test can see a tap fall through a backdrop.
 */
const ROOT = join(__dirname, '..');

/** Sheets that deliberately offer no ✕, each with the reason. */
const NO_CLOSE_ON_PURPOSE: Record<string, string> = {
  'components/stats/ClubConsentSheet.tsx':
    'a consent question that must be answered; "asked once" is the design, and its own buttons are the exit',
};

function tsxFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) tsxFiles(full, out);
    else if (name.endsWith('.tsx')) out.push(full);
  }
  return out;
}

function count(src: string, re: RegExp): number {
  return (src.match(re) ?? []).length;
}

describe('every sheet has a close', () => {
  const files = ['components', 'app']
    .flatMap((d) => tsxFiles(join(ROOT, d)))
    .filter((f) => !f.includes(`${join('components', 'BottomSheet')}`));

  it('scans real sheets (not an empty tree)', () => {
    const sheets = files.filter((f) => /<BottomSheet[\s>]/.test(readFileSync(f, 'utf8')));
    expect(sheets.length).toBeGreaterThan(30);
  });

  it('gives every sheet at least one close control', () => {
    const missing: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      const sheets = count(src, /<BottomSheet[\s>]/g);
      if (sheets === 0) continue;
      const rel = relative(ROOT, f);
      if (NO_CLOSE_ON_PURPOSE[rel]) continue;
      const closes =
        count(src, /<SheetCloseButton\b/g) +
        count(src, /<BottomSheetHeader\b[^>]*\bonClose=/g) +
        count(src, />\s*close\s*</g);
      // Per FILE, not per sheet: GearPickSheet renders one shared header, ✕
      // included, in both of its sheets.
      if (closes === 0) missing.push(`${rel} (${sheets} sheet(s), no close control)`);
    }
    expect(missing, 'a sheet with no ✕ — add onClose to its BottomSheetHeader, or list it above with a reason').toEqual([]);
  });

  it('keeps the no-close list honest: each entry is still a sheet', () => {
    for (const rel of Object.keys(NO_CLOSE_ON_PURPOSE)) {
      expect(/<BottomSheet[\s>]/.test(readFileSync(join(ROOT, rel), 'utf8')), rel).toBe(true);
    }
  });
});

describe('the page behind a sheet is not clickable', () => {
  const css = readFileSync(join(ROOT, 'app', 'globals.css'), 'utf8');

  it('the backdrop takes the pointer while the sheet is opening or open', () => {
    const rule = /\.bottom-sheet-backdrop\[data-state="opening"\],\s*\.bottom-sheet-backdrop\[data-state="open"\]\s*\{\s*pointer-events:\s*auto;/;
    expect(css).toMatch(rule);
  });

  it('and lets go otherwise, so a tap just after closing is never swallowed', () => {
    expect(css).toMatch(/\.bottom-sheet-backdrop\s*\{[^}]*pointer-events:\s*none;/);
  });

  it('never dismisses on a backdrop tap (a stray tap must not throw away a form)', () => {
    const src = readFileSync(join(ROOT, 'components', 'BottomSheet', 'BottomSheet.tsx'), 'utf8');
    const backdrop = src.slice(src.indexOf('bottom-sheet-backdrop') - 200, src.indexOf('bottom-sheet-backdrop') + 200);
    expect(backdrop).not.toMatch(/onClick/);
  });
});
