import { describe, it, expect } from 'vitest';
import { parseBirdName } from '@/lib/birdBrand';

describe('parseBirdName', () => {
  it('splits "Victor Master No.3" into Victor + Master No.3', () => {
    expect(parseBirdName('Victor Master No.3')).toEqual({ brand: 'Victor', model: 'Master No.3' });
  });

  it('splits "Yonex AS-50" into Yonex + AS-50', () => {
    expect(parseBirdName('Yonex AS-50')).toEqual({ brand: 'Yonex', model: 'AS-50' });
  });

  it('handles single-word input (brand only, empty model)', () => {
    expect(parseBirdName('RSL')).toEqual({ brand: 'RSL', model: '' });
  });

  it('returns empty strings for empty input', () => {
    expect(parseBirdName('')).toEqual({ brand: '', model: '' });
  });

  it('trims leading and trailing whitespace', () => {
    expect(parseBirdName('  Victor   Master  ')).toEqual({ brand: 'Victor', model: 'Master' });
  });

  it('handles Chinese brand names', () => {
    expect(parseBirdName('胜利 大师 No.3')).toEqual({ brand: '胜利', model: '大师 No.3' });
  });
});
