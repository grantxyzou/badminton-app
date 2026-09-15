import { describe, it, expect } from 'vitest';
import {
  blankStringPairing,
  clubOthers,
  isMine,
  racketSpecLine,
  setupLines,
  setupShare,
  stringSpecLine,
  tensionOnScreen,
} from '../lib/gearSetup';
import { tallyClubGear, CLUB_GEAR_MIN_COHORT } from '../lib/clubGear';
import type { CatalogItem, GearItem, PlayerGear } from '../lib/types';

const R1: GearItem = { id: 'r1', catalogId: 'rk-af79', category: 'racket', label: 'Li-Ning Air Force 79' };
const R2: GearItem = { id: 'r2', catalogId: 'rk-nf800', category: 'racket', label: 'Yonex Nanoflare 800' };
const S1: GearItem = { id: 's1', catalogId: 'string-yx-bg65', category: 'string', label: 'Yonex BG65' };
const S2: GearItem = { id: 's2', catalogId: 'string-yx-bg65ti', category: 'string', label: 'Yonex BG65 Ti', tensionLbs: 26 };

function doc(items: GearItem[], activeRacketId?: string): PlayerGear {
  return { id: 'gear-m1', memberId: 'm1', items, activeRacketId, updatedAt: '' } as PlayerGear;
}

describe('setupLines', () => {
  it('a blank bag fills nothing', () => {
    expect(setupLines(null)).toEqual({ racket: null, spares: [], string: null, filled: 0 });
  });

  it('the racket line is the ACTIVE racket; every other live racket is a spare', () => {
    const lines = setupLines(doc([R1, R2, S1], 'r2'));
    expect(lines.racket?.id).toBe('r2');
    expect(lines.spares.map((s) => s.id)).toEqual(['r1']);
    expect(lines.filled).toBe(2);
  });

  it('the string line is the NEWEST live string, not the first ever added', () => {
    expect(setupLines(doc([S1, R1, S2])).string?.id).toBe('s2');
  });

  it('a retired item fills no line and is no spare', () => {
    const retired = { ...R2, retiredAt: '2026-01-01' };
    const lines = setupLines(doc([R1, retired], 'r1'));
    expect(lines.spares).toEqual([]);
  });
});

describe('spec lines', () => {
  const racket = { id: 'rk', category: 'racket', brand: 'Li-Ning', model: 'AF79', skillRange: [1, 3], attributes: { weight: '4U', balance: 'Even' } } as CatalogItem;
  const string = { id: 'st', category: 'string', brand: 'Yonex', model: 'BG65', skillRange: [1, 3], attributes: { gaugeMm: 0.7, stringType: 'Durability' } } as CatalogItem;

  it('a racket reads weight class then balance', () => {
    expect(racketSpecLine(racket)).toBe('4U · even');
  });

  it('a string reads gauge then its character, translated by the caller', () => {
    expect(stringSpecLine(string, (k) => (k === 'typeDurable' ? 'durable' : k))).toBe('0.70mm · durable');
  });

  it('an unknown string type is omitted, never printed raw', () => {
    const odd = { ...string, attributes: { gaugeMm: 0.68, stringType: 'Mystery' } } as CatalogItem;
    expect(stringSpecLine(odd, (k) => k)).toBe('0.68mm');
  });

  it('no catalog row, no spec line', () => {
    expect(racketSpecLine(undefined)).toBeNull();
    expect(stringSpecLine(undefined, (k) => k)).toBeNull();
  });
});

describe('clubOthers — the club fact is only ever read off the cohort-guarded tally', () => {
  /** N members who each own the Air Force 79, the first of them being "me". */
  function bags(n: number): PlayerGear[] {
    return Array.from({ length: n }, (_, i) => doc([{ ...R1, id: `r-${i}` }]));
  }

  it('below the cohort there is no entry, so there is no number', () => {
    const entries = tallyClubGear(bags(CLUB_GEAR_MIN_COHORT - 1));
    expect(clubOthers(entries, R1)).toBeNull();
  });

  it('at the cohort the member is one of them: three owners is two OTHERS', () => {
    const entries = tallyClubGear(bags(3));
    expect(clubOthers(entries, R1)).toBe(2);
  });

  it('five owners is four others', () => {
    expect(clubOthers(tallyClubGear(bags(5)), R1)).toBe(4);
  });

  it('matches on the tally\'s own key: case and surrounding space, same category', () => {
    const entries = tallyClubGear(bags(4));
    expect(clubOthers(entries, { ...R1, label: '  li-ning AIR FORCE 79 ' })).toBe(3);
    expect(clubOthers(entries, { ...R1, category: 'string' })).toBeNull();
  });

  it('an unread tally has no facts at all', () => {
    expect(clubOthers(null, R1)).toBeNull();
  });
});

describe('isMine', () => {
  const entry = { category: 'racket' as const, label: 'Li-Ning Air Force 79', count: 5 };
  it('marks a tally row the member owns', () => {
    expect(isMine(doc([R1]), entry)).toBe(true);
  });
  it('does not mark a retired item, another category, or an unknown bag', () => {
    expect(isMine(doc([{ ...R1, retiredAt: '2026-01-01' }]), entry)).toBe(false);
    expect(isMine(doc([{ ...R1, category: 'string' }]), entry)).toBe(false);
    expect(isMine(null, entry)).toBe(false);
  });
});

describe('tensionOnScreen — the level card stands down only for a number the CARD shows', () => {
  const ready = { status: 'ready', pick: { item: { id: 'string-bg85', model: 'BG85' }, tensionLbs: 23, pairedWith: { label: 'Li-Ning Air Force 79', source: 'owned' as const } } };

  it('no racket: the pairing is against a frame the card never names, so no number is on screen', () => {
    // The 2026-09-14 bug: a ready string pick with a tension, no racket in the
    // bag, and the level card suppressed — leaving no tension anywhere.
    const lines = setupLines(doc([]));
    expect(blankStringPairing(lines, ready)).toBeNull();
    expect(tensionOnScreen(lines, ready)).toBe(false);
  });

  it('a racket and no string: the blank line quotes the pairing, so its number IS on screen', () => {
    const lines = setupLines(doc([R1], 'r1'));
    expect(blankStringPairing(lines, ready)?.item.model).toBe('BG85');
    expect(tensionOnScreen(lines, ready)).toBe(true);
  });

  it('a pairing with no tension puts no number on screen', () => {
    const lines = setupLines(doc([R1], 'r1'));
    expect(tensionOnScreen(lines, { status: 'ready', pick: { ...ready.pick, tensionLbs: null } })).toBe(false);
  });

  it('a parked or errored pick quotes nothing', () => {
    const lines = setupLines(doc([R1], 'r1'));
    expect(tensionOnScreen(lines, { status: 'error', pick: null })).toBe(false);
  });

  it('the member\'s own recorded tension counts; a string without one does not', () => {
    expect(tensionOnScreen(setupLines(doc([R1, S2], 'r1')), ready)).toBe(true);
    expect(tensionOnScreen(setupLines(doc([R1, S1], 'r1')), ready)).toBe(false);
  });
});

describe('blankStringPairing — "for this frame" needs the server to have paired against THIS frame', () => {
  const pick = (pairedWith?: { label: string; source: 'owned' | 'recommended' }) =>
    ({ status: 'ready', pick: { item: { id: 'string-bg85', model: 'BG85' }, tensionLbs: 23, pairedWith } });
  const lines = setupLines(doc([R1], 'r1'));

  it('quotes a pairing made for the racket on the line', () => {
    expect(blankStringPairing(lines, pick({ label: 'li-ning air force 79 ', source: 'owned' }))).not.toBeNull();
  });

  it('refuses a pairing made for the PREVIOUS racket — the picks are not refetched on every bag change', () => {
    expect(blankStringPairing(lines, pick({ label: 'Yonex Nanoflare 800', source: 'owned' }))).toBeNull();
  });

  it('refuses a pairing against a recommended frame, even one with the same name', () => {
    expect(blankStringPairing(lines, pick({ label: 'Li-Ning Air Force 79', source: 'recommended' }))).toBeNull();
  });

  it('refuses a pairing that does not say what it paired with', () => {
    expect(blankStringPairing(lines, pick(undefined))).toBeNull();
  });
});

describe('setupShare — gear only, by construction', () => {
  it('carries a name, the two lines and a tension, and no other field', () => {
    const share = setupShare('Lin', setupLines(doc([R1, R2, S2], 'r1')));
    expect(Object.keys(share).sort()).toEqual(['crosses', 'name', 'racket', 'string', 'tensionLbs']);
    expect(share).toEqual({ name: 'Lin', racket: 'Li-Ning Air Force 79', string: 'Yonex BG65 Ti', tensionLbs: 26, crosses: null });
  });

  it("a hybrid adds its crosses string and tension, and the mains stays the string", () => {
    const hybrid = { ...S2, crosses: { catalogId: null, label: 'Yonex BG80', tensionLbs: 28 } };
    const share = setupShare('Lin', setupLines(doc([R1, R2, hybrid], 'r1')));
    expect(share.string).toBe('Yonex BG65 Ti');
    expect(share.tensionLbs).toBe(26);
    expect(share.crosses).toEqual({ name: 'Yonex BG80', tensionLbs: 28 });
  });

});
