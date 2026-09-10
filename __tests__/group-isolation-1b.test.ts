import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  resetMockStore,
  getStore,
  seedDoc as push,
  setupAdminPin,
  seedTestAdminMember,
  seedMember,
  makeRequest,
  makeAdminRequest,
  memberCookieValue,
} from './helpers';
import { GET as birdsGet } from '@/app/api/birds/route';
import { GET as aliasesGet } from '@/app/api/aliases/route';
import { GET as kudosGet } from '@/app/api/kudos/route';
import { GET as jobsGet } from '@/app/api/stringing/jobs/route';
import { GET as shopGet } from '@/app/api/stringing/shop/route';
import { GET as stringsGet } from '@/app/api/stringing/strings/route';
import { GET as pricingGet } from '@/app/api/stringing/pricing/route';
import { readShopOpen, shopDocId } from '@/lib/stringingShop';
import { stringsDocId } from '@/lib/stringingStrings';
import { pricingDocId } from '@/lib/stringingPricing';
import { writeEvent } from '@/lib/events';
import { resolveIdentity } from '@/lib/playerIdentity';

/**
 * PHASE 1b'S GATE: the six containers the session-family sweep left raw.
 *
 * Every case seeds one row stamped `groupId: 'other'` and reads as BPM. Before
 * the sweep every read here returned that row — `getContainer(...)` knows
 * nothing about groups — so a pass is the accessor doing its job, not the
 * mock being kind: it honours `@groupId` (Phase 0) and keys tolerance on the
 * query text, so an unfiltered read still comes back with the foreign row.
 */
const MARKER = 'ISOLATION_MARKER_B';
const FLAG_STRINGING = 'NEXT_PUBLIC_FLAG_STRINGING';
const before = { s: process.env[FLAG_STRINGING] };

beforeEach(async () => {
  resetMockStore();
  setupAdminPin();
  await seedTestAdminMember();
  process.env[FLAG_STRINGING] = 'true';
});
afterEach(() => {
  if (before.s === undefined) delete process.env[FLAG_STRINGING];
  else process.env[FLAG_STRINGING] = before.s;
});

describe('birds', () => {
  it('lists only this group’s purchases', async () => {
    push('birds', { id: 'b-other', name: MARKER, tubes: 4, totalCost: 80, costPerTube: 20, date: '2026-01-01', groupId: 'other' });
    push('birds', { id: 'b-bpm', name: 'Ours', tubes: 2, totalCost: 40, costPerTube: 20, date: '2026-01-02', groupId: 'bpm' });
    const res = await birdsGet(makeAdminRequest('GET', 'http://x/api/birds'));
    const text = await res.text();
    expect(res.status).toBe(200);
    expect(text).not.toContain(MARKER);
    expect(text).toContain('Ours');
  });
});

describe('aliases', () => {
  it('lists only this group’s aliases', async () => {
    push('aliases', { id: 'a-other', appName: MARKER, etransferName: 'x', groupId: 'other' });
    push('aliases', { id: 'a-bpm', appName: 'Ours', etransferName: 'y', groupId: 'bpm' });
    const res = await aliasesGet(makeAdminRequest('GET', 'http://x/api/aliases'));
    const text = await res.text();
    expect(text).not.toContain(MARKER);
    expect(text).toContain('Ours');
  });

  it('resolveIdentity expands only this group’s aliases', async () => {
    push('aliases', { id: 'a-other', appName: 'Mike', etransferName: MARKER, groupId: 'other' });
    push('aliases', { id: 'a-bpm', appName: 'Mike', etransferName: 'michael', groupId: 'bpm' });
    const idy = await resolveIdentity({ name: 'Mike' }, 'bpm');
    expect(idy.names.has('michael')).toBe(true);
    expect(idy.names.has(MARKER.toLowerCase())).toBe(false);
  });
});

describe('kudos', () => {
  it('returns only this group’s kudos for a recipient', async () => {
    seedMember('Lin', { id: 'member-lin' });
    const base = { recipientMemberId: 'member-lin', recipientName: 'Lin', raterMemberId: 'member-viktor', raterName: 'Viktor', sessionId: 's', tag: 'clutch', createdAt: new Date().toISOString() };
    push('kudos', { id: 'k-other', ...base, note: MARKER, groupId: 'other' });
    push('kudos', { id: 'k-bpm', ...base, tag: 'nice_shot', groupId: 'bpm' });
    const res = await kudosGet(
      makeRequest('GET', 'http://x/api/kudos?name=Lin', undefined, { Cookie: `member_session=${memberCookieValue('Lin', 'member-lin')}` }),
    );
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(JSON.stringify(body)).not.toContain(MARKER);
    expect(body.kudos).toEqual([{ tag: 'nice_shot', count: 1 }]);
  });
});

describe('stringingJobs', () => {
  const job = (id: string, over: Record<string, unknown>) => ({
    id, memberId: 'member-wei', jobNo: 'J-0001', memberName: 'Wei', stringerId: null, stringerName: null,
    status: 'received', racketLabel: 'R', stringLabel: 'S', tensionMains: 26, tensionCrosses: 28, method: 'm',
    priceCents: 3000, readyBy: null, acceptedAt: null, paidAt: null, sessionId: null,
    createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', history: [], ...over,
  });

  it('the bench lists only this group’s jobs', async () => {
    push('stringingJobs', job('j-other', { racketLabel: MARKER, groupId: 'other' }));
    push('stringingJobs', job('j-bpm', { racketLabel: 'Ours', groupId: 'bpm' }));
    const res = await jobsGet(makeAdminRequest('GET', 'http://x/api/stringing/jobs'));
    const text = await res.text();
    expect(res.status).toBe(200);
    expect(text).not.toContain(MARKER);
    expect(text).toContain('Ours');
  });

  it('a player’s own view lists only this group’s jobs', async () => {
    push('stringingJobs', job('j-other', { racketLabel: MARKER, groupId: 'other' }));
    push('stringingJobs', job('j-bpm', { racketLabel: 'Ours', groupId: 'bpm' }));
    const res = await jobsGet(
      makeRequest('GET', 'http://x/api/stringing/jobs?view=player', undefined, { Cookie: `member_session=${memberCookieValue('Wei', 'member-wei')}` }),
    );
    const text = await res.text();
    expect(text).not.toContain(MARKER);
    expect(text).toContain('Ours');
  });
});

describe('clubSettings', () => {
  // Two seeds per case. The `<other>:`-prefixed id proves the id helper; a
  // raw read would never find it either, so on its own it exercises nothing.
  // The BARE id stamped `groupId: 'other'` is what exercises the accessor: a
  // raw point read of 'stringing' returns it, the scoped read drops it.
  const stamped = (id: string, fields: Record<string, unknown>) =>
    push('clubSettings', { id, updatedAt: 'x', updatedBy: null, groupId: 'other', ...fields });

  it('another group’s open sign does not open this shop', async () => {
    stamped(shopDocId('other'), { open: true });
    stamped(shopDocId('bpm'), { open: true }); // bare 'stringing', but theirs
    expect(await readShopOpen('bpm')).toBe(false);
    expect(await readShopOpen('other')).toBe(true);
    const res = await shopGet(makeRequest('GET', 'http://x/api/stringing/shop'));
    expect(await res.json()).toEqual({ open: false });
  });

  it('another group’s string list and rate card stay theirs', async () => {
    stamped(stringsDocId('other'), { strings: [MARKER] });
    stamped(stringsDocId('bpm'), { strings: [MARKER] });
    stamped(pricingDocId('other'), { services: [{ label: MARKER, priceCents: 1 }] });
    stamped(pricingDocId('bpm'), { services: [{ label: MARKER, priceCents: 1 }] });
    const strings = await (await stringsGet(makeRequest('GET', 'http://x/api/stringing/strings'))).json();
    const pricing = await (await pricingGet(makeRequest('GET', 'http://x/api/stringing/pricing'))).json();
    expect(strings).toEqual({ strings: [] });
    expect(pricing).toEqual({ services: [] });
  });
});

describe('events', () => {
  it('writeEvent stamps the group it was given', async () => {
    const evt = await writeEvent({ memberId: 'm1', name: 'Lin', kind: 'rec_card_tap' }, 'other');
    expect((evt as { groupId?: string }).groupId).toBe('other');
    const rows = getStore()['events'] as Array<{ groupId?: string }>;
    expect(rows.map((r) => r.groupId)).toEqual(['other']);
  });
});
