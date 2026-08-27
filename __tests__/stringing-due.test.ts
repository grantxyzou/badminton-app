import { describe, it, expect } from 'vitest';
import { dueFor, todayIso } from '../lib/stringingDue';

/**
 * The bench's urgency column. `today` is injected, so the boundaries that
 * actually matter — today vs tomorrow vs one day late — are testable rather
 * than dependent on when the suite happens to run.
 */
const TODAY = '2026-08-27';
const job = (over: Partial<Parameters<typeof dueFor>[0]> = {}) => ({
  readyBy: '2026-08-30',
  status: 'received',
  paidAt: null,
  ...over,
});

describe('urgency', () => {
  it('counts whole days overdue', () => {
    expect(dueFor(job({ readyBy: '2026-08-26' }), TODAY)).toEqual({
      key: 'overdue',
      days: 1,
      tone: 'overdue',
    });
    expect(dueFor(job({ readyBy: '2026-08-20' }), TODAY).days).toBe(7);
  });

  it('distinguishes today from tomorrow', () => {
    expect(dueFor(job({ readyBy: TODAY }), TODAY).key).toBe('today');
    expect(dueFor(job({ readyBy: '2026-08-28' }), TODAY).key).toBe('tomorrow');
    // Two days out is just a date — "tomorrow" for everything near would make
    // the word meaningless.
    expect(dueFor(job({ readyBy: '2026-08-29' }), TODAY).key).toBe('onDate');
  });
});

describe('states that outrank the date', () => {
  it('never marks a picked-up racket overdue', () => {
    // Checked before the date: the stringer has nothing left to do about it,
    // and a red row for finished work is noise on the one screen that exists
    // for triage.
    expect(dueFor(job({ readyBy: '2020-01-01', status: 'picked_up' }), TODAY)).toEqual({
      key: 'pickedUp',
      tone: 'done',
    });
  });

  it('calls out ready-but-unpaid even when finished early', () => {
    // The outstanding thing is money rather than work, and chasing it still
    // matters on a racket that was done ahead of time.
    expect(dueFor(job({ readyBy: '2026-09-30', status: 'ready', paidAt: null }), TODAY).key).toBe(
      'readyUnpaid',
    );
  });

  it('stops saying unpaid once it is paid', () => {
    expect(
      dueFor(job({ status: 'ready', paidAt: '2026-08-27T10:00:00Z' }), TODAY).key,
    ).not.toBe('readyUnpaid');
  });
});

describe('missing information is never urgent', () => {
  it('treats an absent date as unknown, not overdue', () => {
    // Colouring a job red because nobody promised a day would punish the
    // stringer for the app's own missing information.
    expect(dueFor(job({ readyBy: null }), TODAY)).toEqual({ key: 'noDate', tone: 'ok' });
  });

  it('treats free text left over from the old field as unknown', () => {
    // readyBy used to be free text. Existing rows may hold "Sunday" or "next
    // week"; those must degrade to unknown rather than throw or read as due.
    for (const raw of ['Sunday', 'next week', '', '30/08/2026', '2026-8-3']) {
      expect(dueFor(job({ readyBy: raw }), TODAY).key).toBe('noDate');
    }
  });
});

describe('todayIso', () => {
  it('uses the viewer’s own timezone, not UTC', () => {
    // A stringer in Vancouver at 6pm must not see tomorrow's date because UTC
    // has already rolled over.
    const local = new Date(2026, 7, 27, 18, 30);
    expect(todayIso(local)).toBe('2026-08-27');
  });

  it('zero-pads', () => {
    expect(todayIso(new Date(2026, 0, 5))).toBe('2026-01-05');
  });
});
