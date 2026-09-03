import { describe, it, expect } from 'vitest';
import { deepMerge } from '../../i18n/request';

/**
 * `deepMerge` overlays a locale on English. It used to recurse into anything
 * `typeof 'object'` — which includes arrays — and `{ ...array }` is an
 * index-keyed OBJECT. That was invisible until the legal pages stored their
 * copy as arrays and read them with `t.raw(...).map`: the English page
 * rendered and the Chinese one threw.
 */
describe('i18n deepMerge', () => {
  it('fills a missing key from the base', () => {
    expect(deepMerge({ a: 'en', b: 'en' }, { a: 'zh' })).toEqual({ a: 'zh', b: 'en' });
  });

  it('recurses into nested objects', () => {
    expect(deepMerge({ n: { a: 'en', b: 'en' } }, { n: { a: 'zh' } })).toEqual({ n: { a: 'zh', b: 'en' } });
  });

  it('an override ARRAY replaces the base array and stays an array', () => {
    const out = deepMerge({ list: ['en1', 'en2', 'en3'] }, { list: ['zh1'] });
    expect(Array.isArray(out.list)).toBe(true);
    expect(out.list).toEqual(['zh1']);
  });

  it('an array of objects is not index-merged with the base', () => {
    const base = { sections: [{ h: 'A', p: ['a1', 'a2'] }, { h: 'B', p: ['b1'] }] };
    const zh = { sections: [{ h: '甲', p: ['甲1'] }] };
    const out = deepMerge(base, zh);
    expect(Array.isArray(out.sections)).toBe(true);
    expect(out.sections).toEqual(zh.sections);
  });

  it('a missing array falls back to the English one, as an array', () => {
    const out = deepMerge({ list: ['en1'] }, {});
    expect(Array.isArray(out.list)).toBe(true);
    expect(out.list).toEqual(['en1']);
  });
});
