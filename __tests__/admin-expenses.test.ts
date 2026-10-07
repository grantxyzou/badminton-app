import { describe, it, expect, beforeEach } from 'vitest';
import { GET, POST, DELETE } from '@/app/api/admin/expenses/route';
import { GET as ledgerGet } from '@/app/api/admin/ledger/route';
import { CLUB_LEDGER_ID } from '@/lib/ledgerMirror';
import type { LedgerEntry } from '@/lib/types';
import { resetMockStore, getStore, setupAdminPin, seedTestAdminMember, makeRequest, makeAdminRequest } from './helpers';

/**
 * An expense is a `club_outlay` entry the admin typed in. The ledger is
 * append-only, so "delete" is a void — and the money view must see both.
 */

const BASE = 'http://localhost:3000/api/admin';
const ledger = () => (getStore()['ledger'] ?? []) as LedgerEntry[];
const post = (body: Record<string, unknown>) => POST(makeAdminRequest('POST', `${BASE}/expenses`, body));
const today = new Date().toISOString().slice(0, 10);

beforeEach(async () => {
  resetMockStore();
  setupAdminPin();
  await seedTestAdminMember();
});

describe('/api/admin/expenses', () => {
  it('is admin-only on every method', async () => {
    expect((await GET(makeRequest('GET', `${BASE}/expenses`))).status).toBe(401);
    expect((await POST(makeRequest('POST', `${BASE}/expenses`, { amountCents: 100, note: 'x', date: today, category: 'other' }))).status).toBe(401);
    expect((await DELETE(makeRequest('DELETE', `${BASE}/expenses`, { id: 'expense:abc' }))).status).toBe(401);
  });

  it('refuses a bad amount, note, date or category', async () => {
    const ok = { amountCents: 1500, note: 'Grip tape', date: today, category: 'other' };
    expect(await (await post({ ...ok, amountCents: 0 })).json()).toEqual({ error: 'invalid_amount' });
    expect(await (await post({ ...ok, amountCents: 12.5 })).json()).toEqual({ error: 'invalid_amount' });
    expect(await (await post({ ...ok, amountCents: 1_000_001 })).json()).toEqual({ error: 'invalid_amount' });
    expect(await (await post({ ...ok, note: '   ' })).json()).toEqual({ error: 'invalid_note' });
    expect(await (await post({ ...ok, note: 'x'.repeat(81) })).json()).toEqual({ error: 'invalid_note' });
    expect(await (await post({ ...ok, date: '2026-13-40' })).json()).toEqual({ error: 'invalid_date' });
    expect(await (await post({ ...ok, date: 'yesterday' })).json()).toEqual({ error: 'invalid_date' });
    expect(await (await post({ ...ok, category: 'beer' })).json()).toEqual({ error: 'invalid_category' });
    expect(ledger()).toHaveLength(0);
  });

  it('writes one club_outlay entry dated the day it was spent, lists it, and the money view counts it', async () => {
    const res = await post({ amountCents: 1500, note: '  Grip tape ', date: '2026-10-03', category: 'strings' });
    expect(res.status).toBe(201);
    const { expense } = await res.json();
    expect(expense).toMatchObject({ amountCents: 1500, note: 'Grip tape', date: '2026-10-03', category: 'strings' });
    expect(expense.id).toMatch(/^expense:[0-9a-f]{24}$/);

    const [e] = ledger();
    expect(e).toMatchObject({ id: expense.id, memberId: CLUB_LEDGER_ID, account: 'club_outlay', kind: 'expense', amountCents: 1500, meta: { category: 'strings', date: '2026-10-03' } });
    expect(e.createdBy).not.toBe('system'); // the admin, not the mirror

    const list = await (await GET(makeAdminRequest('GET', `${BASE}/expenses`))).json();
    expect(list.expenses.map((x: { id: string }) => x.id)).toEqual([expense.id]);

    const view = await (await ledgerGet(makeAdminRequest('GET', `${BASE}/ledger?range=all`))).json();
    expect(view.outlay.strings).toBe(1500);
    expect(view.outlay.total).toBe(1500);
  });

  it('delete is a void: the entry stays, the list and the view drop it, a second delete is a 404', async () => {
    const { expense } = await (await post({ amountCents: 2000, note: 'Court booking', date: '2026-10-03', category: 'court' })).json();
    const del = await DELETE(makeAdminRequest('DELETE', `${BASE}/expenses`, { id: expense.id }));
    expect(del.status).toBe(200);
    expect(ledger().map((e) => [e.id, e.amountCents]).sort()).toEqual([[expense.id, 2000], [`void:${expense.id}`, -2000]]);
    const list = await (await GET(makeAdminRequest('GET', `${BASE}/expenses`))).json();
    expect(list.expenses).toEqual([]);
    const view = await (await ledgerGet(makeAdminRequest('GET', `${BASE}/ledger?range=all`))).json();
    expect(view.outlay.courts).toBe(0);
    expect((await DELETE(makeAdminRequest('DELETE', `${BASE}/expenses`, { id: expense.id }))).status).toBe(404);
    expect((await DELETE(makeAdminRequest('DELETE', `${BASE}/expenses`, { id: 'charge:r1:1' }))).status).toBe(400); // only an expense
  });
});
