// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';
import { RevealGroup, RevealSlot } from '../../components/primitives/Reveal';

afterEach(cleanup);

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

const shown = (t: string) => screen.queryByText(t) !== null;

describe('RevealGroup / RevealSlot', () => {
  it('never reveals a card before the one above it', () => {
    const { rerender } = render(<Screen a={false} b={false} c={false} />);
    // The bottom card's data arrives first: it must wait behind its skeleton.
    rerender(<Screen a={false} b={false} c={true} />);
    expect(shown('card 3')).toBe(false);
    expect(screen.getByTestId('ph-3')).toBeTruthy();

    rerender(<Screen a={true} b={false} c={true} />);
    expect(shown('card 1')).toBe(true);
    expect(shown('card 3')).toBe(false);

    // The middle one lands: it and the waiting card below it reveal together.
    rerender(<Screen a={true} b={true} c={true} />);
    expect(shown('card 2')).toBe(true);
    expect(shown('card 3')).toBe(true);
  });

  it('staggers a batch revealed together, 40ms apart', () => {
    const { rerender, container } = render(<Screen a={false} b={false} c={false} />);
    rerender(<Screen a={true} b={true} c={true} />);
    const delays = [...container.querySelectorAll('.motion-fade')].map(
      (el) => (el as HTMLElement).style.animationDelay,
    );
    expect(delays).toEqual(['0ms', '40ms', '80ms']);
  });

  it('caps the stagger at the fourth slot', () => {
    const many = (ready: boolean) => (
      <RevealGroup>
        {[1, 2, 3, 4, 5, 6].map((n) => (
          <RevealSlot key={n} ready={ready} placeholder={ph(n)}><p>card {n}</p></RevealSlot>
        ))}
      </RevealGroup>
    );
    const { rerender, container } = render(many(false));
    rerender(many(true));
    const delays = [...container.querySelectorAll('.motion-fade')].map(
      (el) => (el as HTMLElement).style.animationDelay,
    );
    expect(delays).toEqual(['0ms', '40ms', '80ms', '120ms', '120ms', '120ms']);
  });

  it('data already there on first render shows at once, with no fade', () => {
    const { container } = render(<Screen a={true} b={true} c={true} />);
    expect(shown('card 1') && shown('card 2') && shown('card 3')).toBe(true);
    expect(container.querySelectorAll('.motion-fade')).toHaveLength(0);
    expect(screen.queryByTestId('ph-1')).toBeNull();
  });

  it('an empty card closes its skeleton and lets the card below through', () => {
    const { rerender } = render(<Screen a={true} b={false} c={true} />);
    expect(shown('card 3')).toBe(false);
    rerender(<Screen a={true} b={true} bEmpty c={true} />);
    expect(shown('card 2')).toBe(false);
    expect(shown('card 3')).toBe(true);
  });

  it('a card already known to be empty on first render takes no space at all', () => {
    render(<Screen a={true} b={true} bEmpty c={true} />);
    expect(screen.queryByTestId('ph-2')).toBeNull();
    expect(shown('card 2')).toBe(false);
    expect(shown('card 3')).toBe(true);
  });

  it('a revealed card never goes back to its skeleton', () => {
    const { rerender } = render(<Screen a={false} b={false} c={false} />);
    rerender(<Screen a={true} b={false} c={false} />);
    expect(shown('card 1')).toBe(true);
    // A refetch flips the card's `ready` back off: the content stays.
    rerender(<Screen a={false} b={false} c={false} />);
    expect(shown('card 1')).toBe(true);
    expect(screen.queryByTestId('ph-1')).toBeNull();
  });

  it('a slot outside a group reveals on its own, and fades when it waited', () => {
    const one = (ready: boolean) => (
      <RevealSlot ready={ready} placeholder={ph(1)}><p>solo</p></RevealSlot>
    );
    const { rerender, container } = render(one(false));
    expect(screen.getByTestId('ph-1')).toBeTruthy();
    act(() => rerender(one(true)));
    expect(shown('solo')).toBe(true);
    expect(container.querySelectorAll('.motion-fade')).toHaveLength(1);
  });
});
