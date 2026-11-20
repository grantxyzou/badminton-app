// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import enMessages from '../../messages/en.json';
import EtransferCopy from '../../components/payments/EtransferCopy';

/** docs/plans/etransfer-copy.md: the club's address and the amount, each copied with one tap. */
let writeText: ReturnType<typeof vi.fn>;

function renderIt(props: Partial<Parameters<typeof EtransferCopy>[0]> = {}) {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <EtransferCopy email="pay@example.com" name="Club Treasurer" amountCents={2700} {...props} />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  writeText = vi.fn(async () => {});
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('EtransferCopy', () => {
  it('shows the address, the recipient and the amount', () => {
    renderIt();
    expect(screen.getByText('pay@example.com')).toBeTruthy();
    expect(screen.getByText('Club Treasurer')).toBeTruthy();
    expect(screen.getByText('$27.00')).toBeTruthy();
  });

  it('copies the address as written, and says so', async () => {
    renderIt();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy the email address pay@example.com' }));
    });
    expect(writeText).toHaveBeenCalledWith('pay@example.com');
    expect(screen.getByRole('status').textContent).toBe('Email address copied');
  });

  it('copies the amount as a plain number a bank accepts: no $, two decimals', async () => {
    renderIt({ amountCents: 152050 });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy the amount $1520.50' }));
    });
    expect(writeText).toHaveBeenCalledWith('1520.50');
    expect(screen.getByRole('status').textContent).toBe('Amount copied');
  });

  it('a refused clipboard says how to copy by hand, never "Copied"', async () => {
    writeText.mockRejectedValueOnce(new Error('denied'));
    renderIt();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Copy the amount/ }));
    });
    expect(screen.getByRole('alert').textContent).toMatch(/Press and hold/);
    expect(screen.queryByText('Copied')).toBeNull();
  });

  it('"Copied" goes back to "Copy" after a moment', async () => {
    vi.useFakeTimers();
    renderIt();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Copy the email address/ }));
    });
    expect(screen.getByText('Copied')).toBeTruthy();
    await act(async () => {
      vi.advanceTimersByTime(2100);
    });
    expect(screen.queryByText('Copied')).toBeNull();
  });

  it('leaves out the recipient line when the club gave no name', () => {
    renderIt({ name: null });
    expect(screen.queryByText('Club Treasurer')).toBeNull();
  });
});
