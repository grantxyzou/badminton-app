import { describe, it, expect } from 'vitest';
import { normalizeText, editDistance, matchesQuery, matchesQueryFuzzy, searchCatalog } from '@/lib/gearSearch';

const ROWS = [
  { brand: 'Li-Ning', model: 'Halbertec 5000', series: 'Halbertec' },
  { brand: 'Li-Ning', model: 'Halbertec 9000', series: 'Halbertec' },
  { brand: 'Li-Ning', model: 'Aeronaut 9000', series: 'Aeronaut' },
  { brand: 'Yonex', model: 'Astrox 88D Pro', series: 'Astrox' },
  { brand: 'Yonex', model: 'Nanoflare 700', series: 'Nanoflare' },
  { brand: 'Victor', model: 'Thruster Ryuga II', series: 'Thruster' },
];
const text = (r: (typeof ROWS)[number]) => `${r.brand} ${r.model} ${r.series}`;
const models = (rows: typeof ROWS) => rows.map((r) => r.model);

describe('normalizeText', () => {
  it('folds case, punctuation and diacritics to a plain token string', () => {
    expect(normalizeText('Li-Ning')).toBe('li ning');
    expect(normalizeText('  Astrox  88D_Pro ')).toBe('astrox 88d pro');
    expect(normalizeText('Björn')).toBe('bjorn');
  });
});

describe('editDistance', () => {
  it('measures substitutions, insertions and deletions', () => {
    expect(editDistance('halbertec', 'halbertec', 2)).toBe(0);
    expect(editDistance('halbertec', 'halberted', 2)).toBe(1);
    // Three edits — which is exactly why plain distance cannot find this one
    // and `matchesQueryFuzzy` compares consonant skeletons as well.
    expect(editDistance('helbatec', 'halbertec', 3)).toBe(3);
    expect(editDistance('cat', 'dog', 2)).toBeGreaterThan(2);
  });

  it('bails out rather than finishing a matrix it cannot win', () => {
    // Only the cap matters to callers, not the true distance beyond it.
    expect(editDistance('a', 'aaaaaaaaaa', 2)).toBeGreaterThan(2);
  });
});

describe('matchesQuery — strict', () => {
  it('matches tokens in any order', () => {
    expect(matchesQuery('Li-Ning Halbertec 5000 Halbertec', '5000 halbertec')).toBe(true);
    expect(matchesQuery('Li-Ning Halbertec 5000 Halbertec', 'lining halbertec')).toBe(false);
    expect(matchesQuery('Li-Ning Halbertec 5000 Halbertec', 'li ning halbertec')).toBe(true);
  });

  it('requires every token, not just one', () => {
    expect(matchesQuery('Yonex Astrox 88D Pro Astrox', 'yonex nanoflare')).toBe(false);
  });

  it('treats an empty query as matching everything', () => {
    expect(matchesQuery('anything', '   ')).toBe(true);
  });
});

describe('matchesQueryFuzzy', () => {
  it('forgives a typo in a long token', () => {
    expect(matchesQueryFuzzy('Li-Ning Halbertec 5000 Halbertec', 'helbatec')).toBe(true);
  });

  it('forgives nothing in a short token — n65 and n68 are different strings', () => {
    expect(matchesQueryFuzzy('Yonex BG65 BG', 'bg68')).toBe(false);
    expect(matchesQueryFuzzy('Li-Ning N65 N', 'n68')).toBe(false);
  });

  it('accepts a prefix, which is not a typo', () => {
    expect(matchesQueryFuzzy('Yonex Nanoflare 700 Nanoflare', 'nano')).toBe(true);
  });
});

describe('searchCatalog', () => {
  /** The reported bug: a member called the Halbertec 5000 "missing" from the
   *  racket database. It was in the catalog the whole time — they typed
   *  "helbatec", strict matching answered no, and an empty list is
   *  indistinguishable from an absent row. */
  it('finds the Halbertec 5000 from the misspelling that started this', () => {
    expect(models(searchCatalog(ROWS, 'helbatec 5000', text))).toEqual(['Halbertec 5000']);
  });

  it('prefers strict matches and never dilutes them with fuzzy ones', () => {
    // "halbertec" matches two rows exactly; the fuzzy pass must not run and
    // pull in Aeronaut or anything else.
    expect(models(searchCatalog(ROWS, 'halbertec', text))).toEqual(['Halbertec 5000', 'Halbertec 9000']);
  });

  it('searches every brand at once', () => {
    expect(models(searchCatalog(ROWS, '9000', text))).toEqual(['Halbertec 9000', 'Aeronaut 9000']);
  });

  it('returns everything for an empty query', () => {
    expect(searchCatalog(ROWS, '', text)).toHaveLength(ROWS.length);
  });

  it('still returns nothing for a racket that genuinely is not there', () => {
    expect(searchCatalog(ROWS, 'kumpoo power', text)).toEqual([]);
  });

  it('keeps catalog order rather than re-ranking by match quality', () => {
    expect(models(searchCatalog(ROWS, 'li ning', text)))
      .toEqual(['Halbertec 5000', 'Halbertec 9000', 'Aeronaut 9000']);
  });
});
