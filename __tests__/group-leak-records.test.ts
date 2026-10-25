import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { keepGroupRows } from '@/lib/groupScope';
import { GROUP_LEAK_KIND, readGroupLeaks, recordGroupLeak, resetGroupLeakMemo } from '@/lib/groupLeaks';
import { GET } from '@/app/api/admin/migrate-groups/route';
import {
  resetMockStore,
  getStore,
  makeRequest,
  setupAdminPin,
  seedTestAdminMember,
  seedGroup,
  seedMembership,
  adminCookieValue,
  ADMIN_MEMBER_ID,
} from './helpers';
import { allowGroupLeakLog } from './setup/group-leak-spy';

/**
 * Leaks are KEPT, not only logged (Grant, 2026-10-24: "track what got
 * leaked"). `groupScope()` drops a row of another club; `keepGroupRows` also
 * writes one record per distinct (container, asking club, row) to the GLOBAL
 * `groups` container, and the operator reads them on the migrate-groups
 * status. The mock store never lets a foreign row through a query, so these
 * tests hand the re-check the row directly.
 */

const FLAG = 'NEXT_PUBLIC_FLAG_MULTI_GROUP';
const url = 'http://x/api/admin/migrate-groups';

const leakDocs = () =>
  ((getStore()['groups'] ?? []) as Array<{ kind?: string }>).filter((d) => d.kind === GROUP_LEAK_KIND);

beforeEach(async () => {
  resetMockStore();
  resetGroupLeakMemo();
  setupAdminPin();
  await seedTestAdminMember();
});
afterEach(() => {
  delete process.env[FLAG];
});

describe('a dropped row is written down', () => {
  it('records which club asked, whose row it was, and the row id — never the contents', async () => {
    allowGroupLeakLog();
    const rows = keepGroupRows<{ id: string }>('players', 'bpm', true, [
      { id: 'mine', groupId: 'bpm', name: 'Lin' },
      { id: 'theirs', groupId: 'other', name: 'Viktor', paid: false },
    ]);
    expect(rows.map((r) => r.id)).toEqual(['mine']);
    await recordGroupLeak('players', 'bpm', { id: 'theirs', groupId: 'other' }); // settle the fire-and-forget write
    const docs = leakDocs();
    expect(docs).toHaveLength(1);
    expect(docs[0]).toMatchObject({ container: 'players', askedGroup: 'bpm', rowGroup: 'other', rowId: 'theirs' });
    expect(JSON.stringify(docs[0])).not.toMatch(/Viktor|paid/);
  });

  it('a leak repeated on every request is one record', async () => {
    allowGroupLeakLog();
    for (let i = 0; i < 3; i++) await recordGroupLeak('kudos', 'club-a', { id: 'k1', groupId: 'club-b' });
    resetGroupLeakMemo(); // a restart, or a second instance: the store refuses the duplicate id
    await recordGroupLeak('kudos', 'club-a', { id: 'k1', groupId: 'club-b' });
    expect(leakDocs()).toHaveLength(1);
    await recordGroupLeak('kudos', 'club-a', { id: 'k2', groupId: 'club-b' });
    expect(leakDocs()).toHaveLength(2);
  });

  it('reads back newest first, and an unstamped row reads as a null group', async () => {
    await recordGroupLeak('events', 'club-a', { id: 'e1' });
    const report = await readGroupLeaks();
    expect(report.total).toBe(1);
    expect(report.truncated).toBe(false);
    expect(report.latest[0]).toMatchObject({ container: 'events', askedGroup: 'club-a', rowGroup: null, rowId: 'e1' });
  });
});

describe('the operator reads them on the migrate-groups status', () => {
  it('BPM’s admin sees the leaks; zero is a real zero', async () => {
    const asBpm = { Cookie: `admin_session=${adminCookieValue({ groupId: 'bpm' })}` };
    const clean = await (await GET(makeRequest('GET', url, undefined, asBpm))).json();
    expect(clean.leaks).toEqual({ total: 0, truncated: false, latest: [] });

    await recordGroupLeak('players', 'club-a', { id: 'p9', groupId: 'bpm' });
    const body = await (await GET(makeRequest('GET', url, undefined, asBpm))).json();
    expect(body.leaks.total).toBe(1);
    expect(body.leaks.latest[0]).toMatchObject({ container: 'players', askedGroup: 'club-a', rowGroup: 'bpm', rowId: 'p9' });
  });

  it('another club’s admin is refused: the status is deployment-wide', async () => {
    process.env[FLAG] = 'true';
    seedGroup('club-a', { ownerMemberId: ADMIN_MEMBER_ID });
    seedMembership('club-a', ADMIN_MEMBER_ID, { name: 'Admin A', role: 'owner' });
    const asOther = { Cookie: `admin_session=${adminCookieValue({ groupId: 'club-a' })}` };
    const res = await GET(makeRequest('GET', url, undefined, asOther));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'operator_only' });
  });
});
