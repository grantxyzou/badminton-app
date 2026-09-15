import { describe, it, expect, beforeEach } from 'vitest';
import { POST, PUT, PATCH, GET } from '../app/api/equipment/gear/route';
import { resetMockStore, seedMember, memberCookieValue, makeRequest, setupAdminPin } from './helpers';
import { logStringAdded, STRING_LOG_CAP } from '../lib/stringLog';
import type { PlayerGear, StringLogEntry } from '../lib/types';

/**
 * The restring log (2026-09-14): the only history of strings and tensions the
 * app keeps. Every "restrings logged", "your last four" and share-card
 * "since" reads from it.
 */

const URL_ = 'http://localhost/api/equipment/gear';
const cookie = () => ({ Cookie: `member_session=${memberCookieValue('Lin', 'member-lin')}` });
const req = (method: string, body: Record<string, unknown>) => makeRequest(method, URL_, body, cookie());

const RACKET = { catalogId: 'racket-yonex-astrox-100zz', category: 'racket', label: 'Yonex Astrox 100ZZ' };
const BG65 = { catalogId: 'string-yonex-bg65', category: 'string', label: 'Yonex BG65' };

async function log(): Promise<StringLogEntry[]> {
  const res = await GET(makeRequest('GET', `${URL_}?name=Lin`, undefined, cookie()));
  return ((await res.json()).gear as PlayerGear).stringLog ?? [];
}

beforeEach(() => {
  resetMockStore();
  setupAdminPin();
  process.env.NEXT_PUBLIC_FLAG_VALUE_HUB_SLICE = 'true';
  seedMember('Lin', { id: 'member-lin' });
});

describe('the restring log', () => {
  it('a string going in is logged against the racket in play, and its first tension fills that entry', async () => {
    await POST(req('POST', { name: 'Lin', item: RACKET }));
    await POST(req('POST', { name: 'Lin', item: BG65 }));
    let entries = await log();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ catalogId: BG65.catalogId, stringLabel: 'Yonex BG65', racketCatalogId: RACKET.catalogId });
    expect(entries[0].tensionLbs).toBeUndefined();

    await PUT(req('PUT', { name: 'Lin', item: { ...BG65, tensionLbs: 24 } }));
    entries = await log();
    expect(entries).toHaveLength(1);
    expect(entries[0].tensionLbs).toBe(24);
  });

  it('the same tension again is not an event; a different one is a restring', async () => {
    await POST(req('POST', { name: 'Lin', item: RACKET }));
    await POST(req('POST', { name: 'Lin', item: BG65 }));
    await PUT(req('PUT', { name: 'Lin', item: { ...BG65, tensionLbs: 24 } }));
    await PUT(req('PUT', { name: 'Lin', item: { ...BG65, tensionLbs: 24 } }));
    expect(await log()).toHaveLength(1);
    await PUT(req('PUT', { name: 'Lin', item: { ...BG65, tensionLbs: 26 } }));
    expect((await log()).map((e) => e.tensionLbs)).toEqual([24, 26]);
  });

  it('survives every other write — a racket add, a pointer move, a preference', async () => {
    await POST(req('POST', { name: 'Lin', item: RACKET }));
    await POST(req('POST', { name: 'Lin', item: BG65 }));
    await POST(req('POST', { name: 'Lin', item: { catalogId: 'racket-victor-drivex-9x', category: 'racket', label: 'Victor DriveX 9X' } }));
    await PATCH(req('PATCH', { name: 'Lin', fitSwing: 'fast' }));
    expect(await log()).toHaveLength(1);
  });

  it('a racket going in logs nothing', async () => {
    await POST(req('POST', { name: 'Lin', item: RACKET }));
    expect(await log()).toEqual([]);
  });

  it('keeps only the newest entries', () => {
    const many: StringLogEntry[] = Array.from({ length: STRING_LOG_CAP }, (_, i) => ({ at: `2026-01-${i}`, catalogId: null }));
    const out = logStringAdded({ items: [], stringLog: many } as unknown as PlayerGear, { id: 's', catalogId: 'x', category: 'string', label: 'X' }, 'now');
    expect(out).toHaveLength(STRING_LOG_CAP);
    expect(out[out.length - 1].at).toBe('now');
    expect(out[0].at).toBe('2026-01-1');
  });
});
