import { describe, it, expect } from 'vitest';
import { renameOffered, normaliseColours, type OfferedStringsRead } from '../lib/stringingStrings';
import { normaliseColourList } from '../lib/stringPalette';

/**
 * Renaming an offered string moves everything keyed by its label, and the old
 * name keeps counting as it — jobs and purchases under it are never rewritten.
 */
const shelf = (over: Partial<OfferedStringsRead> = {}): OfferedStringsRead => ({
  strings: ['BG80', 'Aerobite'],
  links: { BG80: 'string-yonex-bg80' },
  prices: { BG80: 3200, Aerobite: null },
  aliases: { 'bg-80': 'BG80' },
  colours: { BG80: ['white', 'yellow'] },
  ...over,
});

describe('renameOffered', () => {
  it('moves the link, price and colours, keeps the shelf order, and counts the old name', () => {
    const r = renameOffered(shelf(), 'BG80', 'Yonex BG80 Power');
    if (!r.ok) throw new Error(r.error);
    expect(r.value.strings).toEqual(['Yonex BG80 Power', 'Aerobite']);
    expect(r.value.links).toEqual({ 'Yonex BG80 Power': 'string-yonex-bg80' });
    expect(r.value.prices).toEqual({ 'Yonex BG80 Power': 3200, Aerobite: null });
    expect(r.value.colours).toEqual({ 'Yonex BG80 Power': ['white', 'yellow'] });
    expect(r.value.aliases).toEqual({ 'bg-80': 'Yonex BG80 Power', BG80: 'Yonex BG80 Power' });
  });

  it('a change of case needs no alias: the stock matches without case', () => {
    const r = renameOffered(shelf(), 'BG80', 'bg80');
    if (!r.ok) throw new Error(r.error);
    expect(r.value.strings[0]).toBe('bg80');
    expect(r.value.aliases).toEqual({ 'bg-80': 'bg80' });
  });

  it('renaming onto an old spelling drops that alias: it is a shelf name now', () => {
    const r = renameOffered(shelf(), 'BG80', 'BG-80');
    if (!r.ok) throw new Error(r.error);
    expect(r.value.aliases).toEqual({ BG80: 'BG-80' });
  });

  it('refuses a taken name, a blank or over-long one, and a string not offered', () => {
    expect(renameOffered(shelf(), 'BG80', 'AEROBITE')).toEqual({ ok: false, error: 'name_taken' });
    expect(renameOffered(shelf(), 'BG80', '  ')).toEqual({ ok: false, error: 'invalid_name' });
    expect(renameOffered(shelf(), 'BG80', 'x'.repeat(61))).toEqual({ ok: false, error: 'invalid_name' });
    expect(renameOffered(shelf(), 'Nope', 'X')).toEqual({ ok: false, error: 'not_offered' });
    expect(renameOffered(shelf(), 7, 'X')).toEqual({ ok: false, error: 'invalid_name' });
  });

  it('the same name is a no-op, not an error', () => {
    const before = shelf();
    expect(renameOffered(before, 'BG80', 'BG80')).toEqual({ ok: true, value: before });
  });
});

describe('colours', () => {
  it('keeps palette ids only, in palette order, without repeats', () => {
    expect(normaliseColourList(['yellow', 'white', 'yellow', 'mauve', 3])).toEqual(['white', 'yellow']);
    expect(normaliseColourList('white')).toEqual([]);
  });

  it('drops a label not on the shelf, and an empty list', () => {
    expect(normaliseColours({ BG80: ['red'], Gone: ['red'], Aerobite: [] }, ['BG80', 'Aerobite'])).toEqual({ BG80: ['red'] });
  });
});
