// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { useState } from 'react';
import TensionField, { parseLbs, ratedRange } from '../../components/stats/TensionField';
import enMessages from '../../messages/en.json';

afterEach(cleanup);

function Harness({ initial = null, rated = null, club = null, clubStatus, suggested = null, spy = vi.fn() }: {
  initial?: number | null; rated?: [number, number] | null; club?: { sampleSize: number; low: number; high: number; mean: number } | null;
  clubStatus?: 'loading' | 'ready' | 'error'; suggested?: number | null; spy?: (v: number | null) => void;
}) {
  const [v, setV] = useState<number | null>(initial);
  return (
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <TensionField label="Strung at" value={v} suggested={suggested} onChange={(n) => { setV(n); spy(n); }} rated={rated} club={club} clubStatus={clubStatus} />
    </NextIntlClientProvider>
  );
}

const field = () => screen.getByRole('textbox', { name: 'Strung at' }) as HTMLInputElement;

describe('TensionField', () => {
  it('is typed into: a single digit is nothing yet, two digits are the tension', () => {
    const spy = vi.fn();
    render(<Harness spy={spy} />);
    fireEvent.change(field(), { target: { value: '2' } });
    expect(spy).toHaveBeenLastCalledWith(null);
    fireEvent.change(field(), { target: { value: '24' } });
    expect(spy).toHaveBeenLastCalledWith(24);
    expect(field().value).toBe('24');
  });

  it('steppers stay inside the frame\'s rated range and stop at its edges', () => {
    render(<Harness initial={27} rated={[22, 28]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Raise tension' }));
    expect(field().value).toBe('28');
    expect((screen.getByRole('button', { name: 'Raise tension' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('a typed figure outside the rated range warns and is still the value', () => {
    const spy = vi.fn();
    render(<Harness rated={[22, 28]} spy={spy} club={{ sampleSize: 4, low: 24, high: 27, mean: 25.5 }} clubStatus="ready" />);
    expect(screen.getByText('The club strings this frame 24–27 lb.')).toBeTruthy();
    fireEvent.change(field(), { target: { value: '31' } });
    expect(spy).toHaveBeenLastCalledWith(31);
    expect(screen.getByText("That's outside what this frame is rated for — 22 to 28 lb.")).toBeTruthy();
  });

  it('with no frame to ask about, draws no ruler and says nothing about the club', () => {
    render(<Harness rated={[22, 28]} />);
    expect(screen.queryByText(/club/i)).toBeNull();
    expect(screen.queryByRole('img')).toBeNull();
  });

  // A failed read, a read in flight and "fewer than three members" used to
  // render the same silence. Each now says what it is.
  it('tells loading, not-enough-yet and a failed read apart', () => {
    const { container, rerender } = render(<Harness clubStatus="loading" />);
    expect(container.querySelector('.tension-field-shimmer')).toBeTruthy();
    cleanup();
    render(<Harness clubStatus="ready" club={null} />);
    expect(screen.getByText('Not enough of the club has logged this frame yet.')).toBeTruthy();
    cleanup();
    render(<Harness clubStatus="error" />);
    expect(screen.getByText("We couldn't reach the club data just now.")).toBeTruthy();
    void rerender;
  });

  it('the ruler draws the rated window and club band, and the line follows the figure', () => {
    render(<Harness initial={25} rated={[20, 30]} clubStatus="ready" club={{ sampleSize: 3, low: 24, high: 27, mean: 25.5 }} />);
    expect(screen.getByRole('img', { name: /Tension from 20 to 30 lb/ })).toBeTruthy();
    expect(screen.getByTestId('ruler-club').style.left).toBe('40%');
    expect(screen.getByTestId('ruler-club').style.width).toBe('30%');
    expect(screen.getByTestId('ruler-you').style.left).toBe('50%');
    fireEvent.click(screen.getByRole('button', { name: 'Raise tension' }));
    expect(screen.getByTestId('ruler-you').style.left).toBe('60%');
  });

  it('goes past 30: with no rated range the steppers do not stop there', () => {
    render(<Harness initial={30} />);
    fireEvent.click(screen.getByRole('button', { name: 'Raise tension' }));
    expect(field().value).toBe('31');
  });

  it('a figure above the rated range walks back a pound at a time, not a jump to the edge', () => {
    render(<Harness initial={32} rated={[20, 30]} />);
    expect((screen.getByRole('button', { name: 'Raise tension' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Lower tension' }));
    expect(field().value).toBe('31');
  });

  it('the ruler widens to hold a figure past 30 instead of pinning it to the end', () => {
    render(<Harness initial={32} rated={[20, 30]} clubStatus="ready" />);
    expect(screen.getByRole('img', { name: /Tension from 20 to 32 lb/ })).toBeTruthy();
    expect(screen.getByTestId('ruler-you').style.left).toBe('100%');
    fireEvent.click(screen.getByRole('button', { name: 'Lower tension' }));
    expect(screen.getByTestId('ruler-you').style.left).not.toBe('100%');
  });

  it('draws a suggestion dashed and an out-of-range figure amber', () => {
    render(<Harness suggested={24} rated={[22, 26]} clubStatus="ready" />);
    expect(screen.getByTestId('ruler-you').className).toContain('tension-ruler-you--suggested');
    fireEvent.change(field(), { target: { value: '28' } });
    expect(screen.getByTestId('ruler-you').className).toContain('tension-ruler-you--warn');
  });
});

describe('parseLbs / ratedRange', () => {
  it('parses whole pounds and caps the top', () => {
    expect(parseLbs('')).toBeNull();
    expect(parseLbs('9')).toBeNull();
    expect(parseLbs('26')).toBe(26);
    expect(parseLbs('99')).toBe(40);
  });

  it('reads a ceiling-only frame with the app floor, and nothing without a ceiling', () => {
    expect(ratedRange({ tensionMinLbs: 22, tensionMaxLbs: 28 })).toEqual([22, 28]);
    expect(ratedRange({ tensionMaxLbs: 28 })).toEqual([20, 28]);
    expect(ratedRange({ tensionMinLbs: 26 })).toEqual([26, 30]);
    expect(ratedRange(undefined)).toBeNull();
  });
});
