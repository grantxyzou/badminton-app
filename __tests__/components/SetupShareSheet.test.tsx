// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import SetupShareSheet from '../../components/stats/SetupShareSheet';
import enMessages from '../../messages/en.json';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('SetupShareSheet', () => {
  it('says what is shared, and Copy as text copies exactly the gear', async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <SetupShareSheet open onClose={vi.fn()} share={{ name: 'Lin', racket: 'Li-Ning Air Force 79', string: 'Yonex BG65 Ti', tensionLbs: 26 }} />
      </NextIntlClientProvider>,
    );
    expect(screen.getByText(/Your gear and tension only/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Copy as text' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(
      // The raw message files carry the brand TOKEN; the app substitutes it.
      "Lin's set-up\nRacket: Li-Ning Air Force 79\nStrings: Yonex BG65 Ti · 26 lb\nvia %APP%",
    ));
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeTruthy();
  });

  it('a refused clipboard is rendered, not swallowed', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn(async () => { throw new Error('denied'); }) }, configurable: true });
    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <SetupShareSheet open onClose={vi.fn()} share={{ name: 'Lin', racket: 'A', string: null, tensionLbs: null }} />
      </NextIntlClientProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Copy as text' }));
    expect(await screen.findByRole('alert')).toBeTruthy();
  });
});
