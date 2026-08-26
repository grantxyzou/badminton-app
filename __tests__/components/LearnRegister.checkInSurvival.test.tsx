// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { OnlineProvider } from '../../lib/useOnline';
import enMessages from '../../messages/en.json';

/**
 * The check-in sheet must survive its own save.
 *
 * `CheckInSheet` is mounted INSIDE LearnRegister's `if (needsCheckIn)` branch.
 * `onSaved` used to call `load()`, whose response sets
 * `needsCheckIn(picks.length === 0)` — false once ratings exist — unmounting
 * that whole branch and the sheet with it. The SAVED step exists precisely so
 * fourteen screens of self-assessment don't end in the sheet vanishing with
 * nothing to show for it; refreshing on save destroyed it, and the sheet's
 * in-flight level fetch then resolved into an unmounted component.
 *
 * The sheet is stubbed rather than driven for real: the fix is about WHEN the
 * parent refreshes relative to the sheet's lifecycle, so the stub exposes the
 * two callbacks directly and keeps the test about that and nothing else.
 */
vi.mock('../../components/stats/CheckInSheet', () => ({
  default: ({ open, onSaved, onClose }: { open: boolean; onSaved: () => void; onClose: () => void }) =>
    open ? (
      <div data-testid="check-in-sheet">
        <button type="button" onClick={onSaved}>stub-save</button>
        <button type="button" onClick={onClose}>stub-close</button>
      </div>
    ) : null,
}));

const { default: LearnRegister } = await import('../../components/stats/LearnRegister');

const DRILL = {
  id: 'd1',
  skillKey: 'drops',
  skillLabel: 'Drops',
  title: 'Ten drops from the back corner',
  description: 'Feed yourself a high lift, recover to base, then play ten drops.',
  minutes: 12,
  setting: 'solo',
  reason: 'For your drops (rated 2/5)',
};

/** Empty until the member checks in, then populated — the real sequence. */
function mockFetch(state: { drills: unknown[]; getCount: number }) {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => {
      state.getCount += 1;
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ drills: state.drills, done: [] }),
      } as Response);
    }) as unknown as typeof fetch,
  );
}

function renderLearn() {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <OnlineProvider>
        <LearnRegister activeName="Lin" />
      </OnlineProvider>
    </NextIntlClientProvider>,
  );
}

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('LearnRegister — the check-in sheet survives its own save', () => {
  it('keeps the sheet mounted on save and defers the refresh to close', async () => {
    const state = { drills: [] as unknown[], getCount: 0 };
    mockFetch(state);
    renderLearn();

    await waitFor(() => expect(screen.getByRole('button', { name: 'Start check-in' })).toBeTruthy());
    expect(state.getCount).toBe(1);

    fireEvent.click(screen.getByRole('button', { name: 'Start check-in' }));
    expect(screen.getByTestId('check-in-sheet')).toBeTruthy();

    // The save lands and the engine now has ratings to pick from. The sheet
    // must still be on screen showing its result — and the register must NOT
    // have refetched yet, because that refetch is what unmounts the sheet.
    state.drills = [DRILL];
    fireEvent.click(screen.getByText('stub-save'));

    await waitFor(() => expect(state.getCount).toBe(1));
    expect(screen.getByTestId('check-in-sheet')).toBeTruthy();

    // Dismissing is what hands control back to the register.
    fireEvent.click(screen.getByText('stub-close'));
    await waitFor(() => expect(state.getCount).toBe(2));
    expect(screen.queryByTestId('check-in-sheet')).toBeNull();
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Start check-in' })).toBeNull());
  });

  it('does not refetch on close when nothing was saved', async () => {
    const state = { drills: [] as unknown[], getCount: 0 };
    mockFetch(state);
    renderLearn();

    await waitFor(() => expect(screen.getByRole('button', { name: 'Start check-in' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Start check-in' }));
    fireEvent.click(screen.getByText('stub-close'));

    await waitFor(() => expect(screen.queryByTestId('check-in-sheet')).toBeNull());
    expect(state.getCount).toBe(1);
  });
});
