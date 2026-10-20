import { describe, it, expect } from 'vitest';
import { racketChips } from '../lib/racketChips';
import enMessages from '../messages/en.json';
import zhMessages from '../messages/zh-CN.json';
import type { CatalogItem } from '../lib/types';

const racket = (id: string, attributes: Record<string, string>) =>
  ({ id, category: 'racket', brand: 'Victor', model: id, attributes }) as unknown as CatalogItem;

const PICK = racket('pick', { balance: 'Even', flex: 'Medium-Stiff', weight: '3U/4U', tier: 'Mid-range' });

describe('racketChips', () => {
  it('gives every racket the same four chips in one order', () => {
    expect(racketChips(PICK).map((c) => c.axis)).toEqual(['balance', 'flex', 'weight', 'tier']);
    expect(racketChips(PICK).some((c) => c.differs)).toBe(false);
  });

  it('marks where a row differs from the pick, and only there', () => {
    const alt = racket('alt', { balance: 'Even', flex: 'Stiff', weight: '3U/4U', tier: 'Premium' });
    expect(racketChips(alt, PICK).filter((c) => c.differs).map((c) => c.axis)).toEqual(['flex', 'tier']);
    // Measured against itself, nothing differs.
    expect(racketChips(PICK, PICK).some((c) => c.differs)).toBe(false);
  });

  it('leaves out a value outside the vocabulary rather than showing it raw', () => {
    const odd = racket('odd', { balance: 'head-heavy', flex: 'Stiff' });
    expect(racketChips(odd).map((c) => c.axis)).toEqual(['flex']);
  });

  it('has no chips for a string', () => {
    expect(racketChips({ ...PICK, category: 'string' } as CatalogItem)).toEqual([]);
  });

  it('every chip key exists in both locales (check-i18n-keys cannot see a dynamic key)', () => {
    const all = [
      racket('a', { balance: 'Head-heavy', flex: 'Flexible', tier: 'Entry-level' }),
      racket('b', { balance: 'Even', flex: 'Medium', tier: 'Mid-range' }),
      racket('c', { balance: 'Head-light', flex: 'Medium-Stiff', tier: 'Premium' }),
      racket('d', { flex: 'Stiff' }), racket('e', { flex: 'Extra Stiff' }),
    ].flatMap((r) => racketChips(r)).map((c) => c.key).filter((k): k is string => !!k);
    const gearEn = enMessages.stats.gear as Record<string, unknown>;
    const gearZh = zhMessages.stats.gear as Record<string, unknown>;
    for (const k of all) {
      expect(typeof gearEn[k], k).toBe('string');
      expect(typeof gearZh[k], k).toBe('string');
    }
  });
});
