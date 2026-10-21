// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';
import { TabActiveContext, useTabActive, useTabReturn, RETURN_REFRESH_MS } from '@/lib/tabActivity';
import { appSettled } from '@/lib/appSettled';
import { BottomSheet, BottomSheetBody } from '@/components/BottomSheet';

/**
 * Tabs are kept once visited (docs/plans/tab-keep-alive.md), so "mounted"
 * stopped meaning "on screen". These pin the three things that rest on telling
 * the two apart.
 */
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  document.body.innerHTML = '';
});

function Returner({ onReturn }: { onReturn: () => void }) {
  useTabReturn(onReturn);
  return <span>{String(useTabActive())}</span>;
}

describe('useTabReturn', () => {
  it('is on screen outside any tab, and never fires on mount', () => {
    const onReturn = vi.fn();
    const { container } = render(<Returner onReturn={onReturn} />);
    expect(container.textContent).toBe('true');
    expect(onReturn).not.toHaveBeenCalled();
  });

  it('re-reads a tab that comes back after being away a while', () => {
    vi.useFakeTimers();
    const onReturn = vi.fn();
    const view = (active: boolean) => (
      <TabActiveContext.Provider value={active}>
        <Returner onReturn={onReturn} />
      </TabActiveContext.Provider>
    );
    const { rerender } = render(view(true));
    rerender(view(false));
    act(() => vi.advanceTimersByTime(RETURN_REFRESH_MS + 1));
    rerender(view(true));
    expect(onReturn).toHaveBeenCalledTimes(1);
  });

  it('asks nothing of a quick bounce between tabs', () => {
    vi.useFakeTimers();
    const onReturn = vi.fn();
    const view = (active: boolean) => (
      <TabActiveContext.Provider value={active}>
        <Returner onReturn={onReturn} />
      </TabActiveContext.Provider>
    );
    const { rerender } = render(view(true));
    rerender(view(false));
    act(() => vi.advanceTimersByTime(2000));
    rerender(view(true));
    expect(onReturn).not.toHaveBeenCalled();
  });
});

describe('a sheet on a tab that is away', () => {
  it('stays shut, and comes back with its tab', () => {
    const view = (active: boolean) => (
      <TabActiveContext.Provider value={active}>
        <BottomSheet open onClose={vi.fn()} ariaLabel="Kept sheet">
          <BottomSheetBody>x</BottomSheetBody>
        </BottomSheet>
      </TabActiveContext.Provider>
    );
    // It portals to <body>, out of the hidden panel, so only this can hide it.
    const { rerender } = render(view(false));
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
    rerender(view(true));
    expect(document.body.querySelector('[role="dialog"]')).not.toBeNull();
  });
});

describe('appSettled', () => {
  /** jsdom lays nothing out; a shimmer is "showing" when we say it is. */
  function shimmer(parent: Element, showing: boolean) {
    const el = document.createElement('div');
    el.className = 'shimmer-line';
    el.getClientRects = () => (showing ? [{}] : []) as unknown as DOMRectList;
    parent.appendChild(el);
  }

  it('has nothing to wait for outside the app, or with no tab on screen', () => {
    expect(appSettled(document)).toBe(true);
    document.body.innerHTML = '<div data-app-shell></div>';
    expect(appSettled(document)).toBe(true);
  });

  it('waits while a skeleton shows in the tab on screen, not in the tabs behind it', () => {
    document.body.innerHTML =
      '<div data-app-shell><div data-tab-panel="home" id="home"></div><div data-tab-panel="skills" hidden id="skills"></div></div>';
    shimmer(document.getElementById('skills')!, false);
    expect(appSettled(document)).toBe(true);
    shimmer(document.getElementById('home')!, true);
    expect(appSettled(document)).toBe(false);
  });
});
