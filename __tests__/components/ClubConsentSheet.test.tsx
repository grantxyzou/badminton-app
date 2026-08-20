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

  // ── It must be ANSWERED, not dismissed ──────────────────────────────────
  it('renders no close button', () => {
    renderSheet();
    // Every other sheet in the app hand-rolls a close affordance. This one
    // must not: dismissal would mean asking again next week.
    expect(screen.queryByRole('button', { name: /close/i })).toBeNull();
  });

  it('does not close on Escape', () => {
    const { onAnswer } = renderSheet();
    fireEvent.keyDown(document, { key: 'Escape' });
    // Still open, and nothing was answered on the member's behalf.
    expect(screen.getByText('See how you compare?')).toBeTruthy();
    expect(onAnswer).not.toHaveBeenCalled();
  });

  it('offers exactly two exits, and both are answers', () => {
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
