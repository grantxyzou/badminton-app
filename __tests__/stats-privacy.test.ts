import { describe, it, expect, beforeEach } from 'vitest';
import { GET, PATCH } from '../app/api/members/me/route';
import {
  resetMockStore,
  setupAdminPin,
  seedMember,
  makeRequest,
  memberCookieValue,
  getStore,
} from './helpers';
import {
  normalizeStatsPrivacy,
  isComparisonRevealed,
  needsComparisonPrompt,
  parseStatsPrivacyPatch,
  DEFAULT_STATS_PRIVACY,
} from '../lib/statsPrivacy';

const BASE = 'http://localhost:3000/api/members/me';

function asMember(name: string, body: Record<string, unknown>) {
  return makeRequest('PATCH', BASE, body, {
    Cookie: `member_session=${memberCookieValue(name)}`,
  });
}

describe('statsPrivacy — normalization', () => {
  it('treats an ABSENT field as never asked, not as consented', () => {
    const p = normalizeStatsPrivacy(undefined);
    expect(p).toEqual({ clubComparison: true, promptedAt: null });
    // The default is "on", but on-without-being-asked must never reveal.
    expect(needsComparisonPrompt(p)).toBe(true);
    expect(isComparisonRevealed(p)).toBe(false);
  });

  it('tolerates a partial doc — clubComparison set but promptedAt missing', () => {
    const p = normalizeStatsPrivacy({ clubComparison: false });
    expect(p).toEqual({ clubComparison: false, promptedAt: null });
    expect(needsComparisonPrompt(p)).toBe(true);
  });

  it('ignores junk types rather than throwing', () => {
    expect(normalizeStatsPrivacy('nope')).toEqual(DEFAULT_STATS_PRIVACY);
    expect(normalizeStatsPrivacy(42)).toEqual(DEFAULT_STATS_PRIVACY);
    expect(normalizeStatsPrivacy(null)).toEqual(DEFAULT_STATS_PRIVACY);
    expect(normalizeStatsPrivacy({ clubComparison: 'yes', promptedAt: 7 })).toEqual(
      DEFAULT_STATS_PRIVACY,
    );
  });
});

describe('statsPrivacy — the consent invariant', () => {
  it('reveals ONLY when the preference is on AND the prompt was answered', () => {
    const at = '2026-08-20T00:00:00.000Z';
    expect(isComparisonRevealed({ clubComparison: true, promptedAt: at })).toBe(true);
    // On by default but never asked — the case that would leak the answer
    // behind the consent sheet's translucent backdrop.
    expect(isComparisonRevealed({ clubComparison: true, promptedAt: null })).toBe(false);
    expect(isComparisonRevealed({ clubComparison: false, promptedAt: at })).toBe(false);
    expect(isComparisonRevealed({ clubComparison: false, promptedAt: null })).toBe(false);
  });
});

describe('statsPrivacy — patch parsing', () => {
  it('accepts only a boolean clubComparison', () => {
    expect(parseStatsPrivacyPatch({ clubComparison: true })).toEqual({ clubComparison: true });
    expect(parseStatsPrivacyPatch({ clubComparison: false })).toEqual({ clubComparison: false });
    expect(parseStatsPrivacyPatch({ clubComparison: 'true' })).toBeNull();
    expect(parseStatsPrivacyPatch({})).toBeNull();
    expect(parseStatsPrivacyPatch(null)).toBeNull();
  });

  it('drops a client-supplied promptedAt — the server stamps it', () => {
    const parsed = parseStatsPrivacyPatch({
      clubComparison: true,
      promptedAt: '1999-01-01T00:00:00.000Z',
    });
    expect(parsed).toEqual({ clubComparison: true });
    expect(parsed).not.toHaveProperty('promptedAt');
  });
});

describe('GET /api/members/me — statsPrivacy', () => {
  beforeEach(() => {
    resetMockStore();
    setupAdminPin();
  });

  it('returns the never-asked default for a member with no stored setting', async () => {
    seedMember('Lin');
    const res = await GET(makeRequest('GET', `${BASE}?name=Lin`));
    const body = await res.json();
    expect(body.statsPrivacy).toEqual({ clubComparison: true, promptedAt: null });
  });

  it('returns the stored setting', async () => {
    seedMember('Viktor', {
      statsPrivacy: { clubComparison: false, promptedAt: '2026-08-01T00:00:00.000Z' },
    });
    const res = await GET(makeRequest('GET', `${BASE}?name=Viktor`));
    const body = await res.json();
    expect(body.statsPrivacy).toEqual({
      clubComparison: false,
      promptedAt: '2026-08-01T00:00:00.000Z',
    });
  });

  it('returns statsPrivacy: null (UNKNOWN) when no name is given', async () => {
    // Distinct from the never-asked default — a degraded response must not
    // claim the member is unprompted, or the consent sheet re-fires.
    const res = await GET(makeRequest('GET', BASE));
    const body = await res.json();
    expect(body.statsPrivacy).toBeNull();
  });
});

describe('PATCH /api/members/me — statsPrivacy', () => {
  beforeEach(() => {
    resetMockStore();
    setupAdminPin();
  });

  it('rejects an anonymous write — names are enumerable', async () => {
    seedMember('Lin');
    const res = await PATCH(makeRequest('PATCH', BASE, { name: 'Lin', statsPrivacy: { clubComparison: false } }));
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe('auth_required');
  });

  it("rejects a cookie belonging to a DIFFERENT member", async () => {
    seedMember('Lin');
    seedMember('Viktor');
    const res = await PATCH(
      makeRequest('PATCH', BASE, { name: 'Lin', statsPrivacy: { clubComparison: false } }, {
        Cookie: `member_session=${memberCookieValue('Viktor')}`,
      }),
    );
    expect(res.status).toBe(401);
  });

  it('writes the answer and stamps promptedAt server-side', async () => {
    seedMember('Lin');
    const res = await PATCH(asMember('Lin', { name: 'Lin', statsPrivacy: { clubComparison: false } }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.statsPrivacy.clubComparison).toBe(false);
    expect(typeof body.statsPrivacy.promptedAt).toBe('string');

    const stored = getStore()['members'].find(
      (m) => (m as { name: string }).name === 'Lin',
    ) as { statsPrivacy: { clubComparison: boolean; promptedAt: string } };
    expect(stored.statsPrivacy.clubComparison).toBe(false);
    expect(stored.statsPrivacy.promptedAt).toBeTruthy();
  });

  it('does NOT reset promptedAt when toggling later from settings', async () => {
    const first = '2026-01-01T00:00:00.000Z';
    seedMember('Akane', { statsPrivacy: { clubComparison: true, promptedAt: first } });
    const res = await PATCH(asMember('Akane', { name: 'Akane', statsPrivacy: { clubComparison: false } }));
    const body = await res.json();
    // Resetting it would re-fire the first-run consent sheet.
    expect(body.statsPrivacy.promptedAt).toBe(first);
    expect(body.statsPrivacy.clubComparison).toBe(false);
  });

  it('ignores a forged promptedAt from the client', async () => {
    seedMember('Kento');
    const res = await PATCH(
      asMember('Kento', {
        name: 'Kento',
        statsPrivacy: { clubComparison: true, promptedAt: '1999-01-01T00:00:00.000Z' },
      }),
    );
    const body = await res.json();
    expect(body.statsPrivacy.promptedAt).not.toBe('1999-01-01T00:00:00.000Z');
  });

  it('400s on a malformed statsPrivacy body', async () => {
    seedMember('Sindhu');
    const res = await PATCH(asMember('Sindhu', { name: 'Sindhu', statsPrivacy: { clubComparison: 'yes' } }));
    expect(res.status).toBe(400);
  });

  it('404s for an unknown member', async () => {
    const res = await PATCH(asMember('Ghost', { name: 'Ghost', statsPrivacy: { clubComparison: true } }));
    expect(res.status).toBe(404);
  });

  it('leaves the PIN branch untouched', async () => {
    seedMember('Lin');
    // No statsPrivacy key → still the PIN path, which rejects a missing newPin.
    const res = await PATCH(makeRequest('PATCH', BASE, { name: 'Lin' }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Invalid PIN format');
  });
});
