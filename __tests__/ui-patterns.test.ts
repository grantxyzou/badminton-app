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

  // Review of #816, finding 4: every `${...}` was blanked, so the classes a
  // ternary picks — the exact pattern the miner exists to find — were lost.
  it('reads the string literals inside a template literal className', () => {
    const used = usedClasses(
      '<a className={`btn ${on ? \'segment-tab-active\' : \'segment-tab-inactive\'} flex-1`} />' +
        '<b className={`x ${a ? `nested ${b ? \'deep-on\' : \'\'}` : \'\'}`} />' +
        "<c className={clsx({ 'is-on': on }, 'after')} />",
    );
    for (const c of ['btn', 'segment-tab-active', 'segment-tab-inactive', 'flex-1', 'x', 'nested', 'deep-on', 'is-on', 'after']) {
      expect(used.has(c), c).toBe(true);
    }
  });

  // Finding 5: text before a `{` is not all selector — a declaration or an
  // at-rule statement can sit in front of it.
  it('reads a selector after a declaration or an @import, never a url', () => {
    expect([...cssClasses('.a { background: url(x.png); &:hover { color: red; } }')]).toEqual(['a']);
    expect([...cssClasses("@import url('x.css');\n.keep { color: red; }")]).toEqual(['keep']);
    expect([...cssClasses('.b { background: url("y.svg"); } .c:hover { x: 1; }')].sort()).toEqual(['b', 'c']);
  });

  // Found while checking the fixes against the real tree: once quotes count,
  // an apostrophe in a comment ("don't") must not open a string.
  it('skips comments, so an apostrophe in one opens no string', () => {
    const src = "<a style={{\n  // don't clip the FAB\n  bottom: 1, right: 2 }} /><b style={{ c: 1, d: 2 }} />";
    expect(styleObjects(src).map(normalizeStyle)).toEqual(['bottom: 1; right: 2', 'c: 1; d: 2']);
    expect(usedClasses("<a className={/* the user's pick */ on ? 'is-on' : 'is-off'} />").has('is-off')).toBe(true);
  });

  // Finding 6: a comma inside a quoted value is not a property separator.
  it('keeps a quoted comma list in one property', () => {
    expect(normalizeStyle("fontFamily: 'a, b', color: 'x'")).toBe("color: 'x'; fontFamily: 'a, b'");
    expect(normalizeStyle('transition: "opacity 1s, transform 2s", gap: 1')).toBe(
      'gap: 1; transition: "opacity 1s, transform 2s"',
    );
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
    // Finding 9: 0.3 rounds to 0, which sharp refuses as a bad extract area.
    expect(() => parseCrop('10,20,0.3,80')).toThrow();
    expect(() => parseCrop('10,20,80')).toThrow();
  });
});
