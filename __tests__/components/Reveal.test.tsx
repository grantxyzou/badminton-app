// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { useEffect, useState } from 'react';
import { render, screen, cleanup, act } from '@testing-library/react';
import { RevealGroup, RevealSlot, useRevealReady, INSTANT_MS, SPACELESS_WAIT_MS } from '../../components/primitives/Reveal';

/*
 * The clock is driven: "instant" means ready within INSTANT_MS of the screen
 * mounting, so every case says how late its data arrives. `performance.now`
 * is spied rather than faked timers alone because jsdom's fake clock does not
 * reach it reliably.
 */
let now = 0;
beforeEach(() => {
  now = 0;
  vi.useFakeTimers();
  vi.spyOn(performance, 'now').mockImplementation(() => now);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});
const later = () => {
  now = INSTANT_MS + 400;
};
/** Past the instant window, still inside a space-less slot's wait. */
const soon = () => {
  now = INSTANT_MS + 50;
};
const advance = (ms: number) => act(() => vi.advanceTimersByTime(ms));

const ph = (n: number) => <div data-testid={`ph-${n}`}>skeleton {n}</div>;

function Screen({ a, b, c, bEmpty = false }: { a: boolean; b: boolean; c: boolean; bEmpty?: boolean }) {
  return (
    <RevealGroup>
      <RevealSlot ready={a} placeholder={ph(1)}><p>card 1</p></RevealSlot>
      <RevealSlot ready={b} empty={bEmpty} placeholder={ph(2)}><p>card 2</p></RevealSlot>
      <RevealSlot ready={c} placeholder={ph(3)}><p>card 3</p></RevealSlot>
    </RevealGroup>
  );
}

/** Visible = rendered and not inside a `hidden` ancestor. */
const shown = (t: string) => {
  const el = screen.queryByText(t);
  return !!el && !el.closest('[hidden]');
};
const placeholderUp = (n: number) => {
  const el = screen.queryByTestId(`ph-${n}`);
  return !!el && !el.closest('[hidden]');
};

describe('RevealGroup / RevealSlot', () => {
  /* THE RULE (revised 2026-10-06, after Grant found Stats "a little slow" on
     his phone): a card is held back only by a card above it that holds NO
     SPACE yet, and only for SPACELESS_WAIT_MS. A card whose skeleton already
     reserves its box cannot shove anything when it fills in, so nothing has
     to wait for it — the first cut waited on everything above, and the Stats
     tab sat behind a live model call for the AI greeting. */

  it('a card holding its skeleton never holds up the cards below it', () => {
    const { rerender } = render(<Screen a={false} b={false} c={false} />);
    // Inside the space-less wait window, so this proves "never", not
    // "not for long".
    soon();
    rerender(<Screen a={false} b={false} c={true} />);
    expect(shown('card 3')).toBe(true);
    expect(placeholderUp(1)).toBe(true);
    rerender(<Screen a={true} b={true} c={true} />);
    advance(200);
    expect(shown('card 1') && shown('card 2')).toBe(true);
  });

  function Spaceless({ top, below }: { top: boolean; below: boolean }) {
    return (
      <RevealGroup>
        <RevealSlot ready={top} canBeEmpty placeholder={null}><p>prompt</p></RevealSlot>
        <RevealSlot ready={below} placeholder={ph(2)}><p>card 2</p></RevealSlot>
      </RevealGroup>
    );
  }

  it('a space-less card above holds the cards below — briefly', () => {
    const { rerender } = render(<Spaceless top={false} below={false} />);
    soon();
    rerender(<Spaceless top={false} below={true} />);
    expect(shown('card 2')).toBe(false);
    expect(placeholderUp(2)).toBe(true);
    now = SPACELESS_WAIT_MS + 50;
    advance(SPACELESS_WAIT_MS + 50);
    expect(shown('card 2')).toBe(true);
  });

  it('a space-less card that answers inside the wait releases the cards below at once', () => {
    const { rerender } = render(<Spaceless top={false} below={false} />);
    soon();
    rerender(<Spaceless top={false} below={true} />);
    expect(shown('card 2')).toBe(false);
    rerender(<Spaceless top={true} below={true} />);
    advance(200);
    expect(shown('prompt')).toBe(true);
    expect(shown('card 2')).toBe(true);
  });

  it('staggers a batch 40ms apart, keeping each skeleton until its turn', () => {
    const { rerender } = render(<Screen a={false} b={false} c={false} />);
    later();
    rerender(<Screen a={true} b={true} c={true} />);
    // First of the batch goes at once; the others hold their SKELETON, not a
    // blank gap where an invisible card waits.
    expect(shown('card 1')).toBe(true);
    expect(placeholderUp(2) && placeholderUp(3)).toBe(true);
    advance(40);
    expect(shown('card 2')).toBe(true);
    expect(placeholderUp(3)).toBe(true);
    advance(40);
    expect(shown('card 3')).toBe(true);
    expect(placeholderUp(3)).toBe(false);
  });

  it('caps the stagger at the fourth slot', () => {
    const many = (ready: boolean) => (
      <RevealGroup>
        {[1, 2, 3, 4, 5, 6].map((n) => (
          <RevealSlot key={n} ready={ready} placeholder={ph(n)}><p>card {n}</p></RevealSlot>
        ))}
      </RevealGroup>
    );
    const { rerender } = render(many(false));
    later();
    rerender(many(true));
    advance(120);
    // 4, 5 and 6 all share the fourth slot's 120ms.
    expect([1, 2, 3, 4, 5, 6].every((n) => shown(`card ${n}`))).toBe(true);
  });

  it('data that arrives within INSTANT_MS shows at once, with no fade', () => {
    const { rerender, container } = render(<Screen a={false} b={false} c={false} />);
    now = INSTANT_MS - 10; // a warm tab: answered from cache, a frame or two late
    rerender(<Screen a={true} b={true} c={true} />);
    expect(shown('card 1') && shown('card 2') && shown('card 3')).toBe(true);
    expect(container.querySelectorAll('.motion-fade')).toHaveLength(0);
  });

  it('data that arrives late fades in', () => {
    const { rerender, container } = render(<Screen a={false} b={false} c={false} />);
    later();
    rerender(<Screen a={true} b={false} c={false} />);
    expect(container.querySelectorAll('.motion-fade')).toHaveLength(1);
  });

  it('an empty card closes its skeleton and lets the card below through', () => {
    const { rerender } = render(<Screen a={true} b={false} c={true} />);
    later();
    rerender(<Screen a={true} b={true} bEmpty c={true} />);
    advance(400);
    expect(shown('card 2')).toBe(false);
    expect(placeholderUp(2)).toBe(false);
    expect(shown('card 3')).toBe(true);
  });

  it('a card already known to be empty takes no space at all', () => {
    render(<Screen a={true} b={true} bEmpty c={true} />);
    expect(placeholderUp(2)).toBe(false);
    expect(shown('card 2')).toBe(false);
    expect(shown('card 3')).toBe(true);
  });

  it('a revealed card never goes back to its skeleton', () => {
    const { rerender } = render(<Screen a={false} b={false} c={false} />);
    later();
    rerender(<Screen a={true} b={false} c={false} />);
    expect(shown('card 1')).toBe(true);
    // A refetch flips the card's `ready` back off: the content stays.
    rerender(<Screen a={false} b={false} c={false} />);
    expect(shown('card 1')).toBe(true);
    expect(placeholderUp(1)).toBe(false);
  });

  it('a card that fetches inside itself is mounted, fetches, and reveals itself', () => {
    const fetched = vi.fn();
    function SelfFetching() {
      const [data, setData] = useState<string | null>(null);
      useEffect(() => {
        fetched();
        const t = setTimeout(() => setData('kudos!'), 500);
        return () => clearTimeout(t);
      }, []);
      useRevealReady(data !== null);
      return <p>{data ?? 'nothing yet'}</p>;
    }
    render(
      <RevealGroup>
        <RevealSlot placeholder={ph(1)}><SelfFetching /></RevealSlot>
      </RevealGroup>,
    );
    // The fetch ran while the skeleton was showing.
    expect(fetched).toHaveBeenCalledTimes(1);
    expect(placeholderUp(1)).toBe(true);
    later();
    advance(500);
    expect(shown('kudos!')).toBe(true);
    expect(placeholderUp(1)).toBe(false);
  });

  it('a card that is ready but renders nothing is treated as empty (canBeEmpty)', () => {
    function NothingToSay({ ready }: { ready: boolean }) {
      useRevealReady(ready);
      return null;
    }
    const screenOf = (ready: boolean) => (
      <RevealGroup>
        <RevealSlot canBeEmpty placeholder={ph(1)}><NothingToSay ready={ready} /></RevealSlot>
        <RevealSlot ready placeholder={ph(2)}><p>below</p></RevealSlot>
      </RevealGroup>
    );
    const { rerender } = render(screenOf(false));
    later();
    // Loading and rendering nothing is NOT empty: it is still loading, and
    // its skeleton stays up (the card below shows — the box is reserved).
    expect(placeholderUp(1)).toBe(true);
    const { container } = { container: document.body };
    rerender(screenOf(true));
    advance(400);
    expect(placeholderUp(1)).toBe(false);
    expect(shown('below')).toBe(true);
    // And it leaves the layout — an empty box would still take its gap.
    expect(container.querySelector('[data-reveal-slot]')!.hasAttribute('hidden')).toBe(true);
  });

  it('StrictMode remounting never lets a ready slot jump the queue', async () => {
    // Dev mounts, unmounts and remounts every effect. Unregistering slots one by
    // one used to re-run the order each time, and once only the always-ready
    // LAST slot was registered it revealed — latched — while every slot above
    // it was still a skeleton. Seen on the admin console's settings list.
    const { StrictMode } = await import('react');
    render(
      <StrictMode>
        <RevealGroup>
          <RevealSlot ready={false} canBeEmpty placeholder={null}><p>card 1</p></RevealSlot>
          <RevealSlot ready placeholder={ph(2)}><p>card 2</p></RevealSlot>
        </RevealGroup>
      </StrictMode>,
    );
    await act(async () => { await Promise.resolve(); });
    expect(shown('card 2')).toBe(false);
    expect(placeholderUp(2)).toBe(true);
  });

  it('a slot with no placeholder takes no space until it has something to show', () => {
    const { container } = render(
      <RevealGroup>
        <RevealSlot ready={false} placeholder={null}><p>card 1</p></RevealSlot>
      </RevealGroup>,
    );
    // A pending wrapper in a flex column would still take a gap.
    expect(container.querySelector('[data-reveal-slot]')!.hasAttribute('hidden')).toBe(true);
  });

  it('a slot outside a group reveals on its own, and fades when it waited', () => {
    const one = (ready: boolean) => (
      <RevealSlot ready={ready} placeholder={ph(1)}><p>solo</p></RevealSlot>
    );
    const { rerender, container } = render(one(false));
    expect(placeholderUp(1)).toBe(true);
    later();
    rerender(one(true));
    expect(shown('solo')).toBe(true);
    expect(container.querySelectorAll('.motion-fade')).toHaveLength(1);
  });
});
