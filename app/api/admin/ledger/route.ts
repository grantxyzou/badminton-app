/**
 * GET /api/admin/ledger?range=30d|12w|all — THE ONE MONEY VIEW
 * (docs/plans/payments.md, Phase 2 stage 3).
 *
 * Everything the club's money does, on one page, from two sources that are
 * never summed together:
 *
 *   THE LEDGER (frozen money, `lib/ledgerView.ts`): income, collected by
 *   method, covered, outlay by category, net, credit liability — all in
 *   cents, windowed by the money's own date, voids netted.
 *
 *   THE ROWS (what people see): `outstanding` is LIVE from
 *   `computeOwedForRoster` and is NOT range-bound — a debt is owed today
 *   whenever the bill was; `unfinalized` is the live estimate for unsettled
 *   in-window sessions, under its OWN key so it can never be mistaken for
 *   income. `bySession` and `byPlayer` stay for the drill-ins.
 *
 * ALL OR NOTHING: any read that throws answers 503 `read_failed`. A page
 * that rendered six true buckets and one silent zero would be the lying
 * empty state with a straight face.
 */
import { NextRequest, NextResponse } from 'next/server';
import { groupScope } from '@/lib/groupScope';
import { resolveGroupId } from '@/lib/groupContext';
import { isAdminAuthed, unauthorized } from '@/lib/auth';
import { checkRateLimit, getClientIp } from '@/lib/rateLimit';
import { getActiveSessionId } from '@/lib/cosmos';
import { summarizeLedger, rangeWindow, type RangeKey } from '@/lib/ledgerView';
import { computeOwedForRoster } from '@/lib/owedBalance';
import { lastReconcile } from '@/lib/ledgerReconcile';
import { ensureLedger, listGiftCards } from '@/lib/storeCredit';
import { costSplit } from '@/lib/sessionCost';
import type { EtransferPayment, LedgerEntry, Player, Session } from '@/lib/types';

export const dynamic = 'force-dynamic';

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

interface ByPlayerAcc {
  memberId: string | null;
  name: string;
  sessionCount: number;
  owedAmount: number;
}

/** Settled sessions in the window, newest first, with their rows. The mock ignores the SQL; the JS filter decides. */
async function settledInWindow(scope: ReturnType<typeof groupScope>, from: number, to: number, bounded: boolean) {
  const fromBound = bounded ? new Date(from - 24 * 60 * 60 * 1000).toISOString() : null;
  const all = await scope.query<Session>('sessions', {
    where: fromBound ? 'IS_DEFINED(c.settled) AND NOT IS_NULL(c.settled) AND c.datetime >= @fromBound' : 'IS_DEFINED(c.settled) AND NOT IS_NULL(c.settled)',
    params: fromBound ? [{ name: '@fromBound', value: fromBound }] : [],
  });
  const sessions = all
    .filter((s) => {
      if (!s.settled || !s.datetime) return false;
      const t = new Date(s.datetime).getTime();
      return Number.isFinite(t) && t >= from && t <= to;
    })
    .sort((a, b) => (a.datetime! < b.datetime! ? 1 : -1));
  return { sessions, players: await rowsOf(scope, sessions.map((s) => s.id)) };
}

async function rowsOf(scope: ReturnType<typeof groupScope>, sessionIds: string[]): Promise<Player[]> {
  if (sessionIds.length === 0) return [];
  const wanted = new Set(sessionIds);
  const rows = await scope.query<Player>('players', {
    where: 'ARRAY_CONTAINS(@sessionIds, c.sessionId)',
    params: [{ name: '@sessionIds', value: sessionIds }],
  });
  return rows.filter((p) => wanted.has(p.sessionId));
}

/** Unsettled PAST sessions in the window with a cost: the live estimate, never income. */
async function unfinalizedInWindow(scope: ReturnType<typeof groupScope>, from: number, to: number, activeSessionId: string) {
  const all = await scope.query<Session>('sessions', { where: 'NOT IS_DEFINED(c.settled) OR IS_NULL(c.settled)' });
  const sessions = all
    .filter((s) => {
      if (s.settled || !s.datetime || s.id === activeSessionId) return false;
      const t = new Date(s.datetime).getTime();
      return Number.isFinite(t) && t >= from && t <= to;
    })
    .sort((a, b) => (a.datetime! < b.datetime! ? 1 : -1));
  const rows = await rowsOf(scope, sessions.map((s) => s.id));
  const out: { sessionId: string; date: string; estimatedTotal: number; players: number }[] = [];
  for (const s of sessions) {
    const split = costSplit(s, rows.filter((p) => p.sessionId === s.id));
    if (split.totalCost > 0) out.push({ sessionId: s.id, date: s.datetime!, estimatedTotal: round2(split.totalCost), players: split.active.length });
  }
  return { count: out.length, estimatedTotal: round2(out.reduce((sum, s) => sum + s.estimatedTotal, 0)), sessions: out };
}

export async function GET(req: NextRequest) {
  // Rate limit before auth so it can't be bypassed (CLAUDE.md security #4).
  if (!checkRateLimit(`ledger:${getClientIp(req)}`, 30, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  }
  if (!isAdminAuthed(req)) return unauthorized();

  const rawRange = req.nextUrl.searchParams.get('range');
  const range: RangeKey = rawRange === '30d' || rawRange === 'all' ? rawRange : '12w';

  try {
    const now = Date.now();
    const { from, to } = rangeWindow(range, now);
    const groupId = resolveGroupId(req);
    const scope = groupScope(groupId);
    await ensureLedger();

    const [entries, paymentDocs, roster, gifts, reconcile, activeSessionId, settled] = await Promise.all([
      scope.query<LedgerEntry>('ledger'),
      scope.query<Pick<EtransferPayment, 'id' | 'matchedBy'>>('payments', { select: 'c.id, c.matchedBy' }),
      computeOwedForRoster(scope, now),
      listGiftCards(groupId),
      lastReconcile(groupId),
      getActiveSessionId(groupId),
      settledInWindow(scope, from, to, range !== 'all'),
    ]);
    const unfinalized = await unfinalizedInWindow(scope, from, to, activeSessionId ?? '');

    const matchedBy = new Map<string, string | undefined>();
    for (const p of paymentDocs) if (typeof p.id === 'string') matchedBy.set(p.id, p.matchedBy);
    const view = summarizeLedger(entries, { from, to }, matchedBy);

    // ── Outstanding: FROZEN lines only, everyone, not range-bound ──
    const outstanding = { sessions: 0, stringing: 0, total: 0, people: 0 };
    for (const r of roster) {
      const sessionsCents = r.balance.sessions.filter((s) => s.settled).reduce((sum, s) => sum + Math.round(s.owedAmount * 100), 0);
      const stringingCents = r.balance.stringing.reduce((sum, c) => sum + Math.round(c.amount * 100), 0);
      if (sessionsCents + stringingCents <= 0) continue;
      outstanding.sessions += sessionsCents;
      outstanding.stringing += stringingCents;
      outstanding.people += 1;
    }
    outstanding.total = outstanding.sessions + outstanding.stringing;

    const unredeemed = gifts.filter((g) => !g.redeemedAt);

    // ── bySession / byPlayer: the drill-ins, unchanged in shape ──
    const playersBySession = new Map<string, Player[]>();
    for (const p of settled.players) playersBySession.set(p.sessionId, [...(playersBySession.get(p.sessionId) ?? []), p]);
    const bySession = settled.sessions.map((s) => {
      const snap = s.settled!;
      let paidCount = 0;
      let coveredCount = 0;
      let unpaidCount = 0;
      let unpaidAmount = 0;
      for (const p of playersBySession.get(s.id) ?? []) {
        const owed = p.owedAmount ?? 0;
        if (p.paid === true) paidCount += 1;
        else if (p.writtenOff === true) coveredCount += 1;
        else if (owed > 0) {
          unpaidCount += 1;
          unpaidAmount += owed;
        }
      }
      return { sessionId: s.id, date: s.datetime!, attendanceCount: snap.playerCount, totalCost: round2(snap.totalCost), paidCount, coveredCount, unpaidAmount: round2(unpaidAmount), unpaidCount };
    });

    // Keyed by case-insensitive name so a migrated record and its same-name
    // legacy twin collapse into one row; the first memberId seen opens the profile.
    const byPlayerMap = new Map<string, ByPlayerAcc>();
    for (const p of settled.players) {
      const owed = p.owedAmount ?? 0;
      if (!(owed > 0 && p.paid !== true && p.writtenOff !== true)) continue;
      const key = p.name.toLowerCase();
      const existing = byPlayerMap.get(key);
      if (existing) {
        existing.sessionCount += 1;
        existing.owedAmount += owed;
        if (existing.memberId === null && p.memberId) existing.memberId = p.memberId;
      } else byPlayerMap.set(key, { memberId: p.memberId ?? null, name: p.name, sessionCount: 1, owedAmount: owed });
    }
    const byPlayer = [...byPlayerMap.values()].map((r) => ({ ...r, owedAmount: round2(r.owedAmount) })).sort((a, b) => b.owedAmount - a.owedAmount);

    return NextResponse.json({
      range: { key: range, from: new Date(from).toISOString(), to: new Date(to).toISOString() },
      generatedAt: new Date(now).toISOString(),
      income: view.income,
      collected: view.collected,
      covered: view.covered,
      outstanding,
      credit: view.credit,
      giftCards: { unredeemed: unredeemed.length, amount: unredeemed.reduce((sum, g) => sum + g.amountCents, 0) },
      outlay: view.outlay,
      net: view.net,
      unfinalized,
      reconcile: reconcile ? { lastAt: reconcile.at, mismatches: reconcile.mismatches.length, unlisted: reconcile.unlisted, truncated: reconcile.truncated } : null,
      bySession,
      byPlayer,
    });
  } catch (error) {
    console.error('GET /api/admin/ledger error:', error);
    return NextResponse.json({ error: 'read_failed' }, { status: 503 });
  }
}
