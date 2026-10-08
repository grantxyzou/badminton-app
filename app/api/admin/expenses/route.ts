/**
 * Admin-entered club expenses (docs/plans/payments.md, Phase 2 stage 3):
 * the outlay the app cannot see on its own — a venue booking fee, a tube of
 * grip, a set of strings bought for the bench.
 *
 *   GET    — live expenses (voids netted), newest by the day spent.
 *   POST   — `{ amountCents, note, date, category }` → one `club_outlay`
 *            `expense` entry under `~club`. Cents are an integer, the note
 *            is short, the date is the day spent (YYYY-MM-DD), the category
 *            is one of the four buckets the money view draws.
 *   DELETE — `{ id }` → a `void:<id>` entry. Never a delete: the ledger is
 *            append-only, and a double tap 409s into "already reversed".
 *
 * Mutations use the async admin check (a demoted admin must stop at once);
 * the read is the sync one — this list carries no member data.
 */
import { NextRequest, NextResponse } from 'next/server';
import { isAdminAuthed, isAdminAuthedWithMember, unauthorized } from '@/lib/auth';
import { checkRateLimit, getClientIp } from '@/lib/rateLimit';
import { resolveGroupId } from '@/lib/groupContext';
import { groupScope } from '@/lib/groupScope';
import { appendEntry, CLUB_LEDGER_ID, expenseEntry, voidOf } from '@/lib/ledgerMirror';
import { ensureLedger } from '@/lib/storeCredit';
import type { LedgerEntry } from '@/lib/types';

export const dynamic = 'force-dynamic';

export const MAX_EXPENSE_CENTS = 1_000_000;
export const MAX_NOTE_CHARS = 80;
const CATEGORIES = new Set(['court', 'shuttles', 'strings', 'other']);
type Category = 'court' | 'shuttles' | 'strings' | 'other';

/** The club's expense entries, with the voided ones removed. */
async function liveExpenses(groupId: string): Promise<LedgerEntry[]> {
  await ensureLedger();
  const rows = await groupScope(groupId).query<LedgerEntry>('ledger', {
    where: 'c.memberId = @memberId',
    params: [{ name: '@memberId', value: CLUB_LEDGER_ID }],
  });
  const mine = rows.filter((e) => e.memberId === CLUB_LEDGER_ID);
  const voided = new Set(mine.filter((e) => e.kind === 'void').map((e) => e.id.slice('void:'.length)));
  return mine
    .filter((e) => e.kind === 'expense' && !voided.has(e.id))
    .sort((a, b) => ((a.meta?.date ?? a.createdAt) < (b.meta?.date ?? b.createdAt) ? 1 : -1));
}

const shape = (e: LedgerEntry) => ({
  id: e.id,
  amountCents: e.amountCents,
  note: e.note,
  date: e.meta?.date ?? e.createdAt.slice(0, 10),
  category: (e.meta?.category ?? 'other') as Category,
  createdAt: e.createdAt,
});

export async function GET(req: NextRequest) {
  if (!checkRateLimit(`expenses-read:${getClientIp(req)}`, 60, 60_000)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }
  if (!isAdminAuthed(req)) return unauthorized();
  try {
    return NextResponse.json({ expenses: (await liveExpenses(resolveGroupId(req))).map(shape) });
  } catch (error) {
    console.error('GET /api/admin/expenses:', error);
    return NextResponse.json({ error: 'read_failed' }, { status: 503 });
  }
}

const isDay = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(Date.parse(`${s}T12:00:00Z`));

export async function POST(req: NextRequest) {
  if (!checkRateLimit(`expenses:${getClientIp(req)}`, 30, 15 * 60_000)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }
  const admin = await isAdminAuthedWithMember(req);
  if (!admin.authed) return unauthorized();

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }
  const amountCents = body.amountCents;
  const note = typeof body.note === 'string' ? body.note.trim() : '';
  const category = body.category;
  if (!Number.isInteger(amountCents) || (amountCents as number) <= 0 || (amountCents as number) > MAX_EXPENSE_CENTS) {
    return NextResponse.json({ error: 'invalid_amount' }, { status: 400 });
  }
  if (!note || note.length > MAX_NOTE_CHARS) return NextResponse.json({ error: 'invalid_note' }, { status: 400 });
  if (!isDay(body.date)) return NextResponse.json({ error: 'invalid_date' }, { status: 400 });
  if (typeof category !== 'string' || !CATEGORIES.has(category)) return NextResponse.json({ error: 'invalid_category' }, { status: 400 });

  try {
    const groupId = resolveGroupId(req);
    const createdAt = new Date().toISOString();
    const entry = { ...expenseEntry({ amountCents: amountCents as number, note, date: body.date, category: category as Category }, admin.memberId), createdAt };
    const result = await appendEntry(groupScope(groupId), entry);
    if (result !== 'written') return NextResponse.json({ error: 'write_failed' }, { status: 503 });
    return NextResponse.json({ expense: shape({ ...entry, createdBy: admin.memberId, groupId }) }, { status: 201 });
  } catch (error) {
    console.error('POST /api/admin/expenses:', error);
    return NextResponse.json({ error: 'write_failed' }, { status: 503 });
  }
}

export async function DELETE(req: NextRequest) {
  if (!checkRateLimit(`expenses:${getClientIp(req)}`, 30, 15 * 60_000)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }
  const admin = await isAdminAuthedWithMember(req);
  if (!admin.authed) return unauthorized();

  let id: unknown;
  try {
    id = (await req.json())?.id;
  } catch {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }
  if (typeof id !== 'string' || !id.startsWith('expense:')) return NextResponse.json({ error: 'invalid_id' }, { status: 400 });

  try {
    const groupId = resolveGroupId(req);
    const entry = (await liveExpenses(groupId)).find((e) => e.id === id);
    if (!entry) return NextResponse.json({ error: 'not_found' }, { status: 404 });
    const result = await appendEntry(groupScope(groupId), { ...voidOf(entry, 'expense_deleted'), createdBy: admin.memberId });
    if (result === 'failed') return NextResponse.json({ error: 'write_failed' }, { status: 503 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('DELETE /api/admin/expenses:', error);
    return NextResponse.json({ error: 'write_failed' }, { status: 503 });
  }
}
