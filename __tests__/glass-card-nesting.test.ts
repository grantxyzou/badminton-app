import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

/**
 * Lints the design-system rule: `.glass-card` (Tier 1) is reserved for
 * top-level surfaces. Nested cards must use `.glass-card-soft` (Tier 2 —
 * also exposed via the `.inner-card` alias). When two glass cards stack
 * at the same blur level, the inner one reads as a pasted-on rectangle —
 * the inset highlight fights the parent's, and depth disappears.
 *
 * The check is a per-file static analysis: walk the JSX, push/pop a depth
 * counter every time we enter/leave a `<div>` (or any element) that has
 * `glass-card` in its className. If we ever push past depth 1, fail.
 *
 * This is intentionally a heuristic — it can produce false positives on
 * non-trivial dynamic className construction (e.g. `cn('glass-card', ...)`
 * inside template strings) but that pattern is rare in this codebase and
 * the tradeoff favors a fast, dependency-free check.
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

function findNestedGlassCards(source: string, file: string): Violation[] {
  const violations: Violation[] = [];
  const lines = source.split('\n');

  // Stack of open elements with `{ isGlass }` markers. We push on every
  // opening tag and pop on every closing tag — this preserves correct
  // balance regardless of which inner elements have glass-card.
  const stack: { isGlass: boolean }[] = [];
  const glassDepth = () => stack.filter((s) => s.isGlass).length;

  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    if (ch !== '<') {
      i += 1;
      continue;
    }

    // Closing tag — pop stack.
    if (source[i + 1] === '/') {
      if (stack.length > 0) stack.pop();
      const end = source.indexOf('>', i);
      if (end < 0) break;
      i = end + 1;
      continue;
    }

    // Skip JSX comments / fragments / non-element angle brackets.
    if (source[i + 1] === '!' || source[i + 1] === '>') {
      const end = source.indexOf('>', i);
      if (end < 0) break;
      i = end + 1;
      continue;
    }

    // Opening tag — find the closing `>` (handle JSX expressions in attrs).
    let braceDepth = 0;
    let j = i + 1;
    while (j < source.length) {
      const c = source[j];
      if (c === '{') braceDepth += 1;
      else if (c === '}') braceDepth -= 1;
      else if (c === '>' && braceDepth === 0) break;
      j += 1;
    }
    if (j >= source.length) break;
    const tag = source.slice(i, j + 1);
    const selfClosing = tag.trimEnd().endsWith('/>');
    // `\b` treats `-` as a word boundary, so `\bglass-card\b` matches the
    // `glass-card` prefix of `glass-card-soft`. Add a negative lookahead so
    // only the bare Tier-1 class is detected here — `.glass-card-soft` is a
    // legitimate Tier-2 nested surface.
    const hasGlass =
      /\bclassName\s*=\s*"[^"]*\bglass-card\b(?!-)/.test(tag) ||
      /\bclassName\s*=\s*\{`[^`]*\bglass-card\b(?!-)/.test(tag);

    if (!selfClosing) {
      stack.push({ isGlass: hasGlass });
    }
    if (hasGlass && glassDepth() > 1) {
      const lineNum = source.slice(0, i).split('\n').length;
      violations.push({
        file,
        line: lineNum,
        context: lines[lineNum - 1]?.trim() ?? '',
      });
    }
    i = j + 1;
  }
  return violations;
}

describe('findNestedGlassCards (algorithm)', () => {
  it('returns no violations when glass-card is top-level only', () => {
    const src = `
      <div className="glass-card">
        <div>
          <p>nested arbitrary content</p>
        </div>
      </div>
      <div className="glass-card">peer, also top-level</div>
    `;
    expect(findNestedGlassCards(src, 'x.tsx')).toHaveLength(0);
  });

  it('flags glass-card nested inside another glass-card', () => {
    const src = `
      <div className="glass-card">
        <div className="glass-card">offender</div>
      </div>
    `;
    const v = findNestedGlassCards(src, 'x.tsx');
    expect(v).toHaveLength(1);
    expect(v[0].context).toContain('glass-card');
  });

  it('flags deeply-nested glass-card (offender wrapped in non-glass elements)', () => {
    const src = `
      <div className="glass-card">
        <section>
          <div>
            <div className="glass-card">deep offender</div>
          </div>
        </section>
      </div>
    `;
    expect(findNestedGlassCards(src, 'x.tsx')).toHaveLength(1);
  });

  it('does not flag .inner-card inside .glass-card', () => {
    const src = `
      <div className="glass-card">
        <div className="inner-card">fine</div>
      </div>
    `;
    expect(findNestedGlassCards(src, 'x.tsx')).toHaveLength(0);
  });

  it('does not flag .glass-card-soft inside .glass-card (Tier 2 nested under Tier 1)', () => {
    const src = `
      <div className="glass-card">
        <div className="glass-card-soft">tier-2 nested in tier-1</div>
      </div>
    `;
    expect(findNestedGlassCards(src, 'x.tsx')).toHaveLength(0);
  });

  it('does not flag .glass-card-soft as a top-level surface (it is its own tier)', () => {
    const src = `
      <div className="glass-card-soft">standalone tier-2</div>
    `;
    expect(findNestedGlassCards(src, 'x.tsx')).toHaveLength(0);
  });
});

describe('design-system: .glass-card nesting', () => {
  it('never nests .glass-card inside another .glass-card in the same file', () => {
    const root = join(__dirname, '..');
    const files = [...listFiles(join(root, 'components'), ['.tsx', '.jsx'])];
    const allViolations: Violation[] = [];
    for (const file of files) {
      const source = readFileSync(file, 'utf-8');
      allViolations.push(...findNestedGlassCards(source, file));
    }

    if (allViolations.length > 0) {
      const report = allViolations
        .map((v) => `  ${v.file.replace(root + '/', '')}:${v.line} → ${v.context}`)
        .join('\n');
      throw new Error(
        `Found ${allViolations.length} nested .glass-card violation(s). ` +
          `Top-level surfaces should use .glass-card; nested surfaces must use .inner-card.\n` +
          report,
      );
    }
    expect(allViolations).toHaveLength(0);
  });
});
