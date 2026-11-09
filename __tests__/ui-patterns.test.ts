import { describe, it, expect } from 'vitest';
import {
  cssClasses,
  styleObjects,
  normalizeStyle,
  classNameStrings,
  usedClasses,
  docVocabulary,
  documented,
} from '../scripts/ui-patterns.mjs';
import { wrap, escapeXml, parseArgs, parseCrop } from '../scripts/ui-truth-compare.mjs';

describe('ui-patterns', () => {
  it('reads class names from selectors only, not values or at-rules', () => {
    const css = `/* .ignored */ .a, .b:hover > .c { color: red; } @media (min-width: 1px) { .d { x: url(a.png); } }`;
    expect([...cssClasses(css)].sort()).toEqual(['a', 'b', 'c', 'd']);
  });

  it('extracts brace-balanced style objects', () => {
    const src = `<div style={{ a: 1, b: { c: 2 } }} /><p style={{ d: 'x' }} />`;
    expect(styleObjects(src).map((s) => s.trim())).toEqual(['a: 1, b: { c: 2 }', "d: 'x'"]);
  });

  it('normalizes a style order-insensitively and skips non-patterns', () => {
    expect(normalizeStyle("gap: 'var(--space-4)', display: 'flex'")).toBe(
      normalizeStyle("display: 'flex', gap: 'var(--space-4)'"),
    );
    expect(normalizeStyle("margin: '0', color: 'x'")).toBe(normalizeStyle("color: 'x', margin: 0"));
    expect(normalizeStyle("display: 'flex'")).toBeNull();
    expect(normalizeStyle("display: 'flex', color: on ? 'a' : 'b'")).toBeNull();
    expect(normalizeStyle('...base, color: x, gap: 1')).toBe('color: x; gap: 1');
  });

  it('collects className lists of three or more, sorted', () => {
    expect(classNameStrings(`<a className="p-5 glass-card space-y-3" /><b className="one two" />`)).toEqual([
      'glass-card p-5 space-y-3',
    ]);
  });

  it('takes only whole class tokens, never a Tailwind variant prefix', () => {
    const used = usedClasses(`<a className="hover:bg-x link-quiet" /><b className={on ? 'is-on' : \`a \${x} b\`} />`);
    expect(used.has('link-quiet')).toBe(true);
    expect(used.has('is-on')).toBe(true);
    expect(used.has('hover')).toBe(false);
  });

  it('understands the doc shorthand for families', () => {
    const vocab = docVocabulary(
      'Use `.fs-*` classes, `.icon-xs/sm/md` sizes, `cc-btn-primary` / `-secondary`, and `.motion-fade`.\nProse .bpm-h3 too.',
    );
    for (const name of ['fs-sm', 'icon-sm', 'icon-md', 'cc-btn-secondary', 'motion-fade', 'bpm-h3', 'text-gray-400']) {
      expect(documented(name, vocab), name).toBe(true);
    }
    expect(documented('link-quiet', vocab)).toBe(false);
  });
});

describe('ui-truth-compare', () => {
  it('wraps words to a width', () => {
    expect(wrap('one two three four', 9)).toEqual(['one two', 'three', 'four']);
  });

  it('escapes text for SVG', () => {
    expect(escapeXml(`<a & "b">`)).toBe('&lt;a &amp; &quot;b&quot;&gt;');
  });

  it('parses --flag value pairs', () => {
    expect(parseArgs(['--wrong', 'a.png', '--out', 'c.png'])).toEqual({ wrong: 'a.png', out: 'c.png' });
  });

  it('parses a crop and refuses a malformed one', () => {
    expect(parseCrop(undefined)).toBeNull();
    expect(parseCrop('10, 20.4, 200, 80')).toEqual({ left: 10, top: 20, width: 200, height: 80 });
    expect(() => parseCrop('10,20,0,80')).toThrow();
    expect(() => parseCrop('10,20,80')).toThrow();
  });
});
