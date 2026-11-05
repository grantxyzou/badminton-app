import { describe, it, expect, afterEach } from 'vitest';
import { pushView, popView, topView } from '@/lib/viewTrail';
import { registerPageBack, goBackInPage } from '@/lib/pageStack';

/**
 * Back returns to the page it came from (docs/plans/back-navigation.md).
 * Grant, 2026-11-05: "forward to a page then back takes me to a page before".
 */
describe('a screen’s trail', () => {
  it('pops one page at a time, back to the page it came from', () => {
    let t: string[] = [];
    t = pushView(t, 'club-run', 'dashboard');
    t = pushView(t, 'late-cancel', 'dashboard');
    expect(topView(t, 'dashboard')).toBe('late-cancel');
    t = popView(t);
    expect(topView(t, 'dashboard')).toBe('club-run');
    t = popView(t);
    expect(topView(t, 'dashboard')).toBe('dashboard');
    expect(popView(t)).toEqual([]);
  });

  it('a page from the Ledger and from Past sessions under it each return where they came from', () => {
    let t = pushView(pushView([] as string[], 'ledger', 'dashboard'), 'past-sessions', 'dashboard');
    t = pushView(t, 'payments', 'dashboard');
    expect(popView(t)).toEqual(['ledger', 'past-sessions']);
    expect(popView(pushView(['ledger'], 'payments', 'dashboard'))).toEqual(['ledger']);
  });

  it('opening the bottom screen clears the trail, and the top page is not stacked twice', () => {
    expect(pushView(['members', 'birds'], 'dashboard', 'dashboard')).toEqual([]);
    expect(pushView(['members'], 'members', 'dashboard')).toEqual(['members']);
  });
});

describe('the Android back button’s pages', () => {
  const off: Array<() => void> = [];
  afterEach(() => { while (off.length) off.pop()!(); });

  it('answers with the innermost page, whatever order they registered in', () => {
    const calls: string[] = [];
    off.push(registerPageBack(() => calls.push('bench job'), 1));
    off.push(registerPageBack(() => calls.push('admin page'), 0));
    off.push(registerPageBack(() => calls.push('admin console'), -1));
    expect(goBackInPage()).toBe(true);
    expect(calls).toEqual(['bench job']);
  });

  it('answers false when no page is open, and forgets a page once it closes', () => {
    expect(goBackInPage()).toBe(false);
    const stop = registerPageBack(() => {});
    stop();
    expect(goBackInPage()).toBe(false);
  });
});
