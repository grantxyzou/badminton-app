import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

/**
 * Lints the design-system rule: heading elements (h1-h4) should not carry
 * an inline `fontSize:` style. Use the .bpm-h1 / .bpm-h2 / .bpm-h3 utilities
 * defined in app/globals.css, or a Tailwind text-* class — anything that's
 * a class so the type system can be governed centrally.
 */

function listFiles(dir: string, exts: string[]): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry.startsWith('.') || entry === 'node_modules') continue;
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      out.push(...listFiles(path, exts));
    } else if (exts.some((e) => path.endsWith(e))) {
      out.push(path);
    }
  }
  return out;
}

interface Violation {
  file: string;
  line: number;
  context: string;
}

function findInlineFontSizeOnHeadings(source: string, file: string): Violation[] {
  const violations: Violation[] = [];
  const lines = source.split('\n');
  const tagRegex = /<h[1-4]\b[^>]*?>/gs;
  let match: RegExpExecArray | null;
  while ((match = tagRegex.exec(source)) !== null) {
    const tag = match[0];
    if (/\bfontSize\s*:/.test(tag)) {
      const lineNum = source.slice(0, match.index).split('\n').length;
      violations.push({
        file,
        line: lineNum,
        context: lines[lineNum - 1]?.trim() ?? '',
      });
    }
  }
  return violations;
}

describe('findInlineFontSizeOnHeadings (algorithm)', () => {
  it('flags h1 with inline fontSize', () => {
    const src = `<h1 style={{ fontSize: 30 }}>x</h1>`;
    expect(findInlineFontSizeOnHeadings(src, 'x.tsx')).toHaveLength(1);
  });

  it('flags h2 with inline fontSize via different style shape', () => {
    const src = `<h2 style={{ color: 'red', fontSize: '1rem' }}>x</h2>`;
    expect(findInlineFontSizeOnHeadings(src, 'x.tsx')).toHaveLength(1);
  });

  it('does not flag h3 with class-based sizing', () => {
    const src = `<h3 className="bpm-h3">x</h3>`;
    expect(findInlineFontSizeOnHeadings(src, 'x.tsx')).toHaveLength(0);
  });

  it('does not flag fontSize on a non-heading element (e.g. span)', () => {
    const src = `<span style={{ fontSize: 12 }}>x</span>`;
    expect(findInlineFontSizeOnHeadings(src, 'x.tsx')).toHaveLength(0);
  });
});

describe('design-system: inline fontSize on headings', () => {
  it('headings (h1-h4) never carry an inline fontSize style', () => {
    const root = join(__dirname, '..');
    const files = [...listFiles(join(root, 'components'), ['.tsx', '.jsx'])];
    const allViolations: Violation[] = [];
    for (const file of files) {
      const source = readFileSync(file, 'utf-8');
      allViolations.push(...findInlineFontSizeOnHeadings(source, file));
    }
    if (allViolations.length > 0) {
      const report = allViolations
        .map((v) => `  ${v.file.replace(root + '/', '')}:${v.line} → ${v.context}`)
        .join('\n');
      throw new Error(
        `Found ${allViolations.length} heading(s) with inline fontSize. ` +
          `Use .bpm-h1 / .bpm-h2 / .bpm-h3 utility classes (defined in ` +
          `app/globals.css) or a Tailwind text-* class instead, so the type ` +
          `system can be governed centrally.\n` +
          report,
      );
    }
    expect(allViolations).toHaveLength(0);
  });
});
