// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { useState } from 'react';
import TensionField, { parseLbs, ratedRange } from '../../components/stats/TensionField';
import enMessages from '../../messages/en.json';

afterEach(cleanup);

function Harness({ initial = null, rated = null, club = null, spy = vi.fn() }: {
  initial?: number | null; rated?: [number, number] | null; club?: { sampleSize: number; low: number; high: number; mean: number } | null; spy?: (v: number | null) => void;
}) {
  const [v, setV] = useState<number | null>(initial);
  return (
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <TensionField label="Strung at" value={v} onChange={(n) => { setV(n); spy(n); }} rated={rated} club={club} />
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
    render(<Harness rated={[22, 28]} spy={spy} club={{ sampleSize: 4, low: 24, high: 27, mean: 25.5 }} />);
    expect(screen.getByText('The club strings this frame 24–27 lb.')).toBeTruthy();
    fireEvent.change(field(), { target: { value: '31' } });
    expect(spy).toHaveBeenLastCalledWith(31);
    expect(screen.getByText("That's outside what this frame is rated for — 22 to 28 lb.")).toBeTruthy();
  });

  it('says nothing about the club without a band', () => {
    render(<Harness rated={[22, 28]} />);
    expect(screen.queryByText(/The club strings/)).toBeNull();
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
    expect(ratedRange({ tensionMinLbs: 22 })).toBeNull();
    expect(ratedRange(undefined)).toBeNull();
  });
});
