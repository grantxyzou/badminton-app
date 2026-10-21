import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { resetMockStore, setupAdminPin, seedSession, seedPointer, seedTestAdminMember, makeGetRequest } from './helpers';
import { SESSION_CALENDAR_LIMIT } from '@/lib/sessionCalendar';

/**
 * GET /api/sessions is the Payments card's session picker and the bird-usage
 * assign sheet. It used to `SELECT *` every session doc the club ever had —
 * bird usages, settle snapshots, invite lists — on every open. Now it is a
 * projection of the fields those two read, bounded in SQL to the calendar's
 * cap (the same `SESSION_CALENDAR_LIMIT` the owing dots read under).
 *
 * The mock store applies neither projections nor LIMIT, so the proof is the
 * SQL the scope builds — recorded off the mock container's `items.query` —
 * plus the JS slice, which is what the mock can see.
 */
const sessionQueries: string[] = [];

vi.mock('@/lib/cosmos', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/cosmos')>();
  return {
    ...actual,
    getContainer: (name: string) => {
      const container = actual.getContainer(name);
      if (name !== 'sessions') return container;
      return {
        ...container,
        items: {
          ...container.items,
          query: (spec: { query: string }) => {
            sessionQueries.push(spec.query);
            return container.items.query(spec as never);
          },
        },
      };
    },
  };
});

const { GET } = await import('@/app/api/sessions/route');
const { GET: anomaliesGet } = await import('@/app/api/admin/anomalies/route');

const CONSUMER_FIELDS = ['id', 'datetime', 'title', 'courts', 'costPerCourt', 'birdUsages', 'birdUsage', 'settled', 'eTransferRecipient'];

describe('GET /api/sessions — bounded projection', () => {
  beforeEach(() => {
    resetMockStore();
    setupAdminPin();
    sessionQueries.length = 0;
  });
  afterEach(() => vi.restoreAllMocks());

  it('asks Cosmos for the consumers’ fields only, newest first, under the calendar cap', async () => {
    seedSession('session-2026-05-13');
    const res = await GET(makeGetRequest('http://localhost/api/sessions', true));
    expect(res.status).toBe(200);
    expect(sessionQueries).toHaveLength(1);
    const sql = sessionQueries[0];
    expect(sql).toMatch(/^SELECT c\.id, c\.datetime, c\.title, c\.courts, c\.costPerCourt, c\.birdUsages, c\.birdUsage, c\.settled, c\.eTransferRecipient, c\.groupId FROM c/);
    expect(sql).not.toMatch(/SELECT \*/);
    expect(sql).toMatch(new RegExp(` ORDER BY c\\.id DESC OFFSET 0 LIMIT ${SESSION_CALENDAR_LIMIT}$`));
  });

  it('still returns every field the Payments card and the assign sheet read', async () => {
    seedSession('session-2026-05-13', {
      costPerCourt: 40,
      birdUsages: [{ purchaseId: 'pool', tubes: 1, costPerTube: 30, brand: 'Yonex', model: 'AS-50' }],
      settled: { at: '2026-05-14T00:00:00Z', costPerPerson: 10, totalCost: 110, courtTotal: 80, birdTotal: 30, playerCount: 11, playerNames: ['Lin'] },
      eTransferRecipient: { name: 'Club', email: 'club@example.com' },
    });
    const res = await GET(makeGetRequest('http://localhost/api/sessions', true));
    const [row] = (await res.json()) as Array<Record<string, unknown>>;
    for (const f of CONSUMER_FIELDS.filter((f) => f !== 'birdUsage')) expect(row).toHaveProperty(f);
    expect(row.settled).toMatchObject({ costPerPerson: 10, totalCost: 110 });
  });

  it('answers the newest SESSION_CALENDAR_LIMIT sessions of a longer history, newest first', async () => {
    const n = SESSION_CALENDAR_LIMIT + 1;
    const start = Date.UTC(2020, 0, 2);
    const ids: string[] = [];
    for (let i = 0; i < n; i++) {
      const day = new Date(start + i * 7 * 86400000).toISOString().slice(0, 10);
      ids.push(`session-${day}`);
      seedSession(`session-${day}`, { datetime: `${day}T19:00:00-08:00` });
    }
    const res = await GET(makeGetRequest('http://localhost/api/sessions', true));
    const rows = (await res.json()) as Array<{ id: string }>;
    expect(rows).toHaveLength(SESSION_CALENDAR_LIMIT);
    // The oldest one is the one left out, and the list is newest first.
    expect(rows[0].id).toBe(ids[n - 1]);
    expect(rows[rows.length - 1].id).toBe(ids[1]);
    expect(rows.map((r) => r.id)).not.toContain(ids[0]);
  });
});

describe('GET /api/admin/anomalies — one previous session, two fields', () => {
  beforeEach(async () => {
    resetMockStore();
    setupAdminPin();
    await seedTestAdminMember();
    sessionQueries.length = 0;
  });
  afterEach(() => vi.restoreAllMocks());

  it('reads only the newest non-active session’s id and datetime, and still finds it', async () => {
    // Three past sessions; the newest past one is 30 days before the active
    // night, so the handler's `long_break` depends on picking THAT row.
    seedSession('session-2026-02-01', { datetime: '2026-02-01T20:00:00-04:00' });
    seedSession('session-2026-04-13', { datetime: '2026-04-13T20:00:00-04:00' });
    seedSession('session-2026-03-01', { datetime: '2026-03-01T20:00:00-04:00' });
    seedPointer('session-2026-05-13');
    seedSession('session-2026-05-13', { courts: 2, costPerCourt: 32, maxPlayers: 12, datetime: '2026-05-13T20:00:00-04:00' });
    const res = await anomaliesGet(makeGetRequest('http://localhost/api/admin/anomalies', true));
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ code: string }>;
    expect(body.find((a) => a.code === 'long_break')).toBeDefined();
    const listSql = sessionQueries.find((q) => q.includes('@activeId'));
    expect(listSql).toBeDefined();
    expect(listSql).toMatch(/^SELECT c\.id, c\.datetime, c\.groupId FROM c/);
    expect(listSql).toMatch(/ ORDER BY c\.id DESC OFFSET 0 LIMIT 1$/);
  });
});
