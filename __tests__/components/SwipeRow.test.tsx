// @vitest-environment jsdom
// @vitest-environment-options { "url": "http://localhost:3000/bpm" }
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import SwipeRow from '../../components/primitives/SwipeRow';

/**
 * The gesture. jsdom applies no stylesheet, so nothing here proves it LOOKS
 * right — that is what the verify-ui pass is for. What these tests can prove is
 * the three behaviours that make it safe, and each of them is a rule the
 * implementation could plausibly have got backwards:
 *
 *  1. it refuses the left edge, which belongs to swipe-back and to the OS;
 *  2. a vertical drag is forfeited for the whole gesture, not re-tested;
 *  3. the swipe REVEALS and the tap COMMITS — never the swipe alone.
 */
function setup(onAction = vi.fn(), onLeading = vi.fn()) {
  render(
    <SwipeRow
      leadingAction={{ icon: 'star', label: 'Pin', tone: 'accent', onAction: onLeading }}
      trailingAction={{ icon: 'archive', label: 'Archive', tone: 'neutral', onAction }}
    >
      <div>Wei · J-0042</div>
    </SwipeRow>,
  );
  const row = screen.getByText('Wei · J-0042').closest('.swipe-row') as HTMLElement;
  const track = row.querySelector('.swipe-row__track') as HTMLElement;
  // The offset lives in a CSS custom property on the ROW, written imperatively
  // — React is deliberately not involved during the drag. jsdom applies no
  // stylesheet, so the transform itself is unobservable here; the variable and
  // the gating attribute are the contract.
  const offset = () => row.style.getPropertyValue('--swipe-x');
  const phase = () => row.getAttribute('data-swiping');
  return { row, track, offset, phase, onAction, onLeading };
}

const touch = (x: number, y: number) => ({ touches: [{ clientX: x, clientY: y }] });

afterEach(cleanup);

describe('the left edge is not ours', () => {
  it('does not arm when the drag starts in the back-gesture gutter', () => {
    // TopBar arms swipe-back from the left 24px and WKWebView owns the edge for
    // the system back gesture. A row that also responded there would fight both.
    const { row, offset, phase } = setup();
    fireEvent.touchStart(row, touch(10, 100));
    fireEvent.touchMove(row, touch(120, 100));
    fireEvent.touchEnd(row);
    expect(offset()).toBe('');
    expect(phase()).toBeNull();
  });

  it('arms normally past the gutter', () => {
    const { row, offset, phase } = setup();
    fireEvent.touchStart(row, touch(200, 100));
    fireEvent.touchMove(row, touch(150, 100));
    expect(offset()).toBe('-50px');
    expect(phase()).toBe('active');
  });
});

describe('a scroll stays a scroll', () => {
  it('forfeits the whole gesture once vertical wins, even if the finger comes back', () => {
    // Re-testing per frame would let a wobbly finger flip a scroll into a
    // reveal halfway down the page. PullToRefresh disqualifies the same way in
    // the opposite direction.
    const { row, offset } = setup();
    fireEvent.touchStart(row, touch(200, 100));
    fireEvent.touchMove(row, touch(198, 160));
    fireEvent.touchMove(row, touch(100, 100));
    fireEvent.touchEnd(row);
    expect(offset()).toBe('0px');
  });
});

describe('the swipe reveals, the tap commits', () => {
  it('does not fire the action on the swipe alone', () => {
    const { row, onAction } = setup();
    fireEvent.touchStart(row, touch(200, 100));
    fireEvent.touchMove(row, touch(60, 100));
    fireEvent.touchEnd(row);
    expect(onAction).not.toHaveBeenCalled();
  });

  it('fires it when the revealed button is tapped', () => {
    const { row, onAction } = setup();
    fireEvent.touchStart(row, touch(200, 100));
    fireEvent.touchMove(row, touch(60, 100));
    fireEvent.touchEnd(row);
    fireEvent.click(screen.getByText('Archive'));
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it('swiping the other way reveals the other action', () => {
    const { row, onLeading } = setup();
    fireEvent.touchStart(row, touch(200, 100));
    fireEvent.touchMove(row, touch(320, 100));
    fireEvent.touchEnd(row);
    fireEvent.click(screen.getByText('Pin'));
    expect(onLeading).toHaveBeenCalledTimes(1);
  });
});

describe('it stays out of the way', () => {
  it('sets no transform at rest', () => {
    // Not even translateX(0). A transform establishes a containing block and
    // `position: fixed` descendants then resolve against the row instead of the
    // viewport — the project's documented containing-block trap.
    const { offset, phase } = setup();
    expect(offset()).toBe('');
    expect(phase()).toBeNull();
  });

  it('ignores touches entirely while a BottomSheet has locked the body', () => {
    document.body.style.position = 'fixed';
    const { row, offset } = setup();
    fireEvent.touchStart(row, touch(200, 100));
    fireEvent.touchMove(row, touch(60, 100));
    expect(offset()).toBe('');
    document.body.style.position = '';
  });

  it('keeps the revealed buttons out of the tab order', () => {
    // They are a pointer shortcut; the row's menu is the accessible path. Two
    // tab stops for one action would make a keyboard user visit it twice.
    setup();
    expect(screen.getByText('Archive').closest('button')?.tabIndex).toBe(-1);
  });

  it('does nothing at all when disabled', () => {
    const onAction = vi.fn();
    render(
      <SwipeRow
        enabled={false}
        trailingAction={{ icon: 'archive', label: 'Archive', tone: 'neutral', onAction }}
      >
        <div>Offline row</div>
      </SwipeRow>,
    );
    const row = screen.getByText('Offline row').closest('.swipe-row') as HTMLElement;
    fireEvent.touchStart(row, touch(200, 100));
    fireEvent.touchMove(row, touch(60, 100));
    expect(row.style.getPropertyValue('--swipe-x')).toBe('');
  });
});

describe('the tray does not paint until it is asked for', () => {
  it('leaves the actions hidden at rest', () => {
    // Not cosmetic. `.glass-card` runs `backdrop-filter: saturate(180%)`, which
    // samples what is painted behind it — so an always-painted tray meant every
    // row's frost was blooming the green Pin and the Archive button underneath
    // it, on every row, at rest. It read as a glow along the top of the list
    // coming from buttons nobody had revealed.
    //
    // jsdom applies no stylesheet, so the CSS rule itself is unobservable here.
    // What IS observable is the gate the rule keys on: no `data-swiping` on the
    // row means `.swipe-row__actions` keeps its `visibility: hidden`.
    const { row } = setup();
    expect(row.getAttribute('data-swiping')).toBeNull();
    expect(row.querySelector('.swipe-row__actions')).not.toBeNull();
  });

  it('marks the row while a gesture is live', () => {
    const { row, phase } = setup();
    fireEvent.touchStart(row, touch(200, 100));
    fireEvent.touchMove(row, touch(140, 100));
    expect(phase()).toBe('active');
  });
});

describe('the gesture always returns to rest', () => {
  it('clears data-swiping outright when it settles at zero', () => {
    // It used to leave `data-swiping="release"` and wait for `transitionend`
    // to clear it — but `prefers-reduced-motion: reduce` sets
    // `transition: none`, so that event never fires and the attribute stuck
    // forever. A stuck attribute re-shows the action tray permanently, which
    // is the exact backdrop-filter glow this component was fixed for, plus a
    // permanent identity transform (the containing-block trap).
    const { row, phase } = setup();
    fireEvent.touchStart(row, touch(200, 100));
    fireEvent.touchMove(row, touch(190, 100)); // short of COMMIT
    fireEvent.touchEnd(row);
    expect(phase()).toBeNull();
  });

  it('clears it after a vertical scroll that began on a row', () => {
    const { row, phase } = setup();
    fireEvent.touchStart(row, touch(200, 100));
    fireEvent.touchMove(row, touch(198, 170));
    fireEvent.touchEnd(row);
    expect(phase()).toBeNull();
  });
});
