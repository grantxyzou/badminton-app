import { describe, it, expect } from 'vitest';
import { allocateAmount, decideMatch, type MatchCandidate } from '@/lib/etransferMatch';
import type { OwedLine } from '@/lib/owedBalance';

const line = (ref: string, amountCents: number, at: string, kind: OwedLine['kind'] = 'session'): OwedLine => ({
  kind,
  ref,
  pk: kind === 'session' ? `session-${at.slice(0, 10)}` : 'member-1',
  amountCents,
  at,
});

// Oldest first, as owedLines() returns them.
const LINES = [line('a', 1200, '2026-09-01'), line('b', 1500, '2026-09-08'), line('c', 1200, '2026-09-15'), line('j', 3000, '2026-09-20', 'stringing')];

describe('allocateAmount', () => {
  it('one exact line', () => {
    expect(allocateAmount(LINES, 1500)?.map((l) => l.ref)).toEqual(['b']);
  });
  it('two equal lines settle the OLDEST', () => {
    expect(allocateAmount(LINES, 1200)?.map((l) => l.ref)).toEqual(['a']);
  });
  it('the oldest k lines', () => {
    expect(allocateAmount(LINES, 2700)?.map((l) => l.ref)).toEqual(['a', 'b']);
    expect(allocateAmount(LINES, 3900)?.map((l) => l.ref)).toEqual(['a', 'b', 'c']);
  });
  it('the whole balance, stringing included', () => {
    expect(allocateAmount(LINES, 6900)?.map((l) => l.ref)).toEqual(['a', 'b', 'c', 'j']);
  });
  it('a stringing job on its own', () => {
    expect(allocateAmount(LINES, 3000)?.map((l) => l.ref)).toEqual(['j']);
  });
  it('no clean set → null (over, under, non-contiguous)', () => {
    expect(allocateAmount(LINES, 1000)).toBeNull();
    expect(allocateAmount(LINES, 9999)).toBeNull();
    expect(allocateAmount(LINES, 4200)).toBeNull(); // b + j, skips older lines — not a guess we make
    expect(allocateAmount([], 1200)).toBeNull();
    expect(allocateAmount(LINES, 0)).toBeNull();
    expect(allocateAmount(LINES, 12.5)).toBeNull();
  });
});

describe('decideMatch', () => {
  const lin: MatchCandidate = { memberId: 'm-lin', name: 'Lin', lines: LINES };
  const base = { recognized: true, authenticated: true, amountCents: 1500, candidates: [lin] };

  it('authenticated + one person + a clean amount → matched', () => {
    const d = decideMatch(base);
    expect(d.status).toBe('matched');
    if (d.status === 'matched') expect(d.allocations.map((l) => l.ref)).toEqual(['b']);
  });

  it('an unauthenticated email NEVER auto-matches, but keeps what it found', () => {
    const d = decideMatch({ ...base, authenticated: false });
    expect(d).toMatchObject({ status: 'review', reason: 'unauthenticated' });
    if (d.status === 'review') expect(d.candidates).toEqual([lin]);
  });

  it.each([
    [{ recognized: false }, 'unrecognized_email'],
    [{ amountCents: null }, 'unrecognized_email'],
    [{ candidates: [] }, 'unknown_sender'],
    [{ candidates: [lin, { ...lin, memberId: 'm-other' }] }, 'ambiguous_sender'],
    [{ candidates: [{ ...lin, lines: [] }] }, 'nothing_owed'],
    [{ amountCents: 1000 }, 'amount_mismatch'],
  ] as const)('%o → review %s', (over, reason) => {
    expect(decideMatch({ ...base, ...over } as Parameters<typeof decideMatch>[0])).toMatchObject({ status: 'review', reason });
  });
});
