// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import ClubConsentSheet from '../../components/stats/ClubConsentSheet';
import { OnlineProvider } from '../../lib/useOnline';
import enMessages from '../../messages/en.json';

function renderSheet(onAnswer = vi.fn(), open = true) {
  const utils = render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <OnlineProvider>
        <ClubConsentSheet open={open} onAnswer={onAnswer} />
      </OnlineProvider>
    </NextIntlClientProvider>,
  );
  return { ...utils, onAnswer };
}

describe('ClubConsentSheet', () => {
  afterEach(() => cleanup());

  it('asks the question with both reassurances', () => {
    renderSheet();
    expect(screen.getByText('See how you compare?')).toBeTruthy();
    expect(screen.getByText(/Bands only/)).toBeTruthy();
    expect(screen.getByText(/Your ratings stay yours/)).toBeTruthy();
    expect(screen.getByText(/Change it any time in Profile/)).toBeTruthy();
  });

  // ── Asked once: every way out is the private answer ─────────────────────
  it('closing with the ✕ saves "Keep it private"', () => {
    const { onAnswer } = renderSheet();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onAnswer).toHaveBeenCalledWith(false);
  });

  it('Escape saves "Keep it private"', () => {
    const { onAnswer } = renderSheet();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onAnswer).toHaveBeenCalledWith(false);
  });

  it('closing while saving answers nothing twice', () => {
    const onAnswer = vi.fn();
    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <OnlineProvider>
          <ClubConsentSheet open saving onAnswer={onAnswer} />
        </OnlineProvider>
      </NextIntlClientProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onAnswer).not.toHaveBeenCalled();
  });

  it('closing while offline answers nothing, and the sheet cannot be swiped away', () => {
    const was = Object.getOwnPropertyDescriptor(Navigator.prototype, 'onLine');
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false });
    try {
      const { onAnswer } = renderSheet();
      fireEvent.click(screen.getByRole('button', { name: 'Close' }));
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(onAnswer).not.toHaveBeenCalled();
      expect(document.querySelector('[data-sheet-grab]')).toBeNull();
    } finally {
      delete (navigator as unknown as Record<string, unknown>).onLine;
      if (was) Object.defineProperty(Navigator.prototype, 'onLine', was);
    }
  });

  it('offers both answers as buttons', () => {
    renderSheet();
    expect(screen.getByRole('button', { name: 'Show me where I sit' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Keep it private' })).toBeTruthy();
  });

  it('reports yes as true', () => {
    const { onAnswer } = renderSheet();
    fireEvent.click(screen.getByRole('button', { name: 'Show me where I sit' }));
    expect(onAnswer).toHaveBeenCalledWith(true);
  });

  it('reports "Keep it private" as a real answer, not a dismissal', () => {
    const { onAnswer } = renderSheet();
    fireEvent.click(screen.getByRole('button', { name: 'Keep it private' }));
    // false, not undefined — this writes promptedAt exactly like yes does.
    expect(onAnswer).toHaveBeenCalledWith(false);
  });

  it('renders nothing when closed', () => {
    renderSheet(vi.fn(), false);
    expect(screen.queryByText('See how you compare?')).toBeNull();
  });

  it('disables both buttons while saving', () => {
    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <OnlineProvider>
          <ClubConsentSheet open saving onAnswer={vi.fn()} />
        </OnlineProvider>
      </NextIntlClientProvider>,
    );
    expect((screen.getByRole('button', { name: 'Show me where I sit' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Keep it private' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
