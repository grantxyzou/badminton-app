import { describe, it, expect, vi, beforeEach } from 'vitest';

/** Fresh module per test — the stack is module state. */
async function load() {
  vi.resetModules();
  return import('../lib/sheetStack');
}

describe('sheetStack', () => {
  beforeEach(() => vi.resetModules());

  it('closes nothing when nothing is open', async () => {
    const { closeTopSheet, openSheetCount } = await load();
    expect(openSheetCount()).toBe(0);
    expect(closeTopSheet()).toBe(false);
  });

  it('closes the top-most sheet only, in LIFO order', async () => {
    const { registerOpenSheet, closeTopSheet, openSheetCount } = await load();
    const a = vi.fn();
    const b = vi.fn();
    const offA = registerOpenSheet(a);
    const offB = registerOpenSheet(b);
    expect(openSheetCount()).toBe(2);

    expect(closeTopSheet()).toBe(true);
    expect(b).toHaveBeenCalledOnce();
    expect(a).not.toHaveBeenCalled();
    // Closing calls the handler; the sheet unregisters itself when it
    // actually closes (BottomSheet's effect cleanup), so simulate that.
    offB();
    expect(closeTopSheet()).toBe(true);
    expect(a).toHaveBeenCalledOnce();
    offA();
    expect(closeTopSheet()).toBe(false);
  });

  it('unregister removes exactly that handler', async () => {
    const { registerOpenSheet, closeTopSheet } = await load();
    const a = vi.fn();
    const b = vi.fn();
    const offA = registerOpenSheet(a);
    registerOpenSheet(b);
    offA();
    closeTopSheet();
    expect(b).toHaveBeenCalledOnce();
    expect(a).not.toHaveBeenCalled();
  });
});
