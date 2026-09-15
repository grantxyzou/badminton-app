import { describe, it, expect, beforeEach } from 'vitest';
import { GET as SHARE_CARD } from '../app/api/equipment/share-card/route';
import { buildShareCard, shareCardText, stringsFact, tensionFact, type ShareCardInput, type ShareCard } from '../lib/shareCard';
import { resetMockStore, setupAdminPin, seedMember, memberCookieValue, makeRequest, getStore } from './helpers';
import type { PlayerGear } from '../lib/types';

const RACKET = { id: 'r1', catalogId: 'racket-li-ning-air-force-79', category: 'racket' as const, label: 'Li-Ning Air Force 79' };
const STRING = { id: 's1', catalogId: 'string-yonex-bg65-ti', category: 'string' as const, label: 'Yonex BG65 Ti', tensionLbs: 26 };

function gear(extra: Partial<PlayerGear> = {}): PlayerGear {
  return { id: 'gear-m', memberId: 'm', items: [RACKET, STRING], activeRacketId: 'r1', updatedAt: '', fitGrip: 'G4', ...extra } as PlayerGear;
}

function input(over: Partial<ShareCardInput> = {}): ShareCardInput {
  return {
    name: 'Lin', joinedAt: '2024-03-02T00:00:00Z', clubName: 'BPM', gear: gear(),
    racketRow: { id: RACKET.catalogId, category: 'racket', brand: 'Li-Ning', model: 'Air Force 79', skillRange: [1, 6], attributes: { weight: '4U', balance: 'Even' } },
    clubEntries: [{ category: 'racket', label: 'Li-Ning Air Force 79', count: 4 }],
    band: { sampleSize: 4, low: 23, high: 25, mean: 24 },
    ...over,
  };
}

describe('buildShareCard', () => {
  it('says the club facts only when they can be said honestly', () => {
    const card = buildShareCard(input({ gear: gear({ stringLog: [
      { at: '2025-03-01T00:00:00Z', catalogId: 'x', racketItemId: 'r1', tensionLbs: 24 },
      { at: '2025-06-01T00:00:00Z', catalogId: 'x', racketItemId: 'other', tensionLbs: 25 },
      { at: '2025-08-01T00:00:00Z', catalogId: 'x', racketItemId: 'r1', tensionLbs: 26 },
    ] }) }));
    expect(card).toMatchObject({
      name: 'Lin', initial: 'L', sinceYear: 2024, clubName: 'BPM',
      racket: { name: 'Air Force 79', brand: 'Li-Ning', weight: '4U', balance: 'Even' },
      string: 'Yonex BG65 Ti', tensionLbs: 26, grip: 'G4', tensionVsClub: 2, clubCount: 4,
      restrings: { count: 2, since: '2025-03-01T00:00:00Z' },
    });
  });

  it('drops a line rather than showing a zero or a small club', () => {
    const card = buildShareCard(input({
      clubEntries: [{ category: 'racket', label: 'Li-Ning Air Force 79', count: 2 }],
      band: null,
      joinedAt: null,
    }));
    expect(card.clubCount).toBeNull();
    expect(card.tensionVsClub).toBeNull();
    expect(card.restrings).toBeNull();
    expect(card.sinceYear).toBeNull();
  });

  it('has no field for a level, a result, kudos or arm history', () => {
    const keys = Object.keys(buildShareCard(input({ gear: gear({ fitArmComfort: 'often_sore', fitSwing: 'fast' }) }))).sort();
    expect(keys).toEqual(['clubCount', 'clubName', 'crosses', 'grip', 'initial', 'name', 'racket', 'restrings', 'sinceYear', 'string', 'tensionLbs', 'tensionVsClub'].sort());
  });

  it('the text carries the same facts, one per line, and omits what the card omits', () => {
    const words = {
      title: "What Lin's playing", since: (y: number) => `At BPM since ${y}`,
      restrings: (n: number) => `${n} restrings`, vsClub: (d: number) => `${d > 0 ? '+' : ''}${d} lb on the club's average`,
      of: (n: number) => `1 of ${n}`, racket: 'Racket', strings: 'Strings', tension: 'Tension', grip: 'Grip', atClub: 'At BPM', lb: 'lb', footer: 'bpm',
    };
    const card: ShareCard = buildShareCard(input());
    const text = shareCardText(card, words);
    expect(text.split('\n')).toEqual([
      "What Lin's playing", 'At BPM since 2024', 'Racket: Air Force 79 (Li-Ning · 4U · even)',
      'Strings: Yonex BG65 Ti', 'Tension: 26 lb', 'Grip: G4', "+2 lb on the club's average", 'At BPM: 1 of 4', 'bpm',
    ]);
  });
});

describe('GET /api/equipment/share-card', () => {
  beforeEach(() => {
    resetMockStore();
    setupAdminPin();
    process.env.NEXT_PUBLIC_FLAG_VALUE_HUB_SLICE = 'true';
    seedMember('Lin', { id: 'member-lin' });
    seedMember('Viktor', { id: 'member-viktor' });
  });

  it('answers the owner, with the club facts computed on the server', async () => {
    getStore()['playerGear'] = [
      { ...gear(), id: 'gear-member-lin', memberId: 'member-lin' },
      ...[1, 2, 3].map((i) => ({ ...gear(), id: `gear-o${i}`, memberId: `o${i}`, items: [RACKET, { ...STRING, tensionLbs: 23 + i }] })),
    ];
    const res = await SHARE_CARD(makeRequest('GET', 'http://localhost/api/equipment/share-card?name=Lin', undefined, { Cookie: `member_session=${memberCookieValue('Lin', 'member-lin')}` }));
    expect(res.status).toBe(200);
    const { card } = await res.json();
    expect(card.name).toBe('Lin');
    expect(card.clubCount).toBe(4);
    expect(card.tensionLbs).toBe(26);
  });

  it('refuses someone else', async () => {
    const res = await SHARE_CARD(makeRequest('GET', 'http://localhost/api/equipment/share-card?name=Lin', undefined, { Cookie: `member_session=${memberCookieValue('Viktor', 'member-viktor')}` }));
    expect(res.status).toBe(403);
  });
});

describe('a hybrid on the share card', () => {
  const HYBRID = { ...STRING, crosses: { catalogId: null, label: 'Yonex BG80', tensionLbs: 28 } };

  it('keeps the mains as the string and its tension, so the club comparison is a mains one', () => {
    const card = buildShareCard(input({ gear: gear({ items: [RACKET, HYBRID] }) }));
    expect(card.string).toBe('Yonex BG65 Ti');
    expect(card.tensionLbs).toBe(26);
    expect(card.tensionVsClub).toBe(2);
    expect(card.crosses).toEqual({ name: 'Yonex BG80', tensionLbs: 28 });
  });

  it('reads "mains / crosses", with a dash for a missing half and nothing when neither has a figure', () => {
    expect(stringsFact({ string: 'BG65', crosses: { name: 'BG80', tensionLbs: null } })).toBe('BG65 / BG80');
    expect(stringsFact({ string: 'BG65', crosses: null })).toBe('BG65');
    expect(tensionFact({ tensionLbs: 26, crosses: { name: 'BG80', tensionLbs: 28 } })).toBe('26 / 28');
    expect(tensionFact({ tensionLbs: null, crosses: { name: 'BG80', tensionLbs: 28 } })).toBe('– / 28');
    expect(tensionFact({ tensionLbs: null, crosses: { name: 'BG80', tensionLbs: null } })).toBeNull();
    expect(tensionFact({ tensionLbs: 26, crosses: null })).toBe('26');
  });
});
