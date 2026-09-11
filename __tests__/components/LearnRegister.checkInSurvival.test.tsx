// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { OnlineProvider } from '../../lib/useOnline';
import enMessages from '../../messages/en.json';
import LearnRegister from '../../components/stats/LearnRegister';
import type { UseCheckIn } from '../../components/stats/useCheckIn';

/**
 * The check-in sheet must survive its own save — same subject as before, NEW
 * reason, which is why this file was rewritten rather than deleted.
 *
 * It used to be mounted INSIDE LearnRegister's `if (needsCheckIn)` branch, and
 * `onSaved` called `load()`, whose response sets `needsCheckIn(picks.length ===
 * 0)` — false once ratings exist — unmounting that branch and the sheet with
 * it. The SAVED step exists precisely so fourteen screens of self-assessment
 * don't end in the sheet vanishing with nothing to show for it. A `savedRef`
 * deferred the refresh to close to work around exactly that.
 *
 * The sheet now has ONE mount, in `SkillsTab`, outside every register — so the
 * branch disappearing underneath it cannot touch it, the workaround is gone,
 * and the refresh is simply a dependency on `savedAt`. What this file pins now:
 * this register mounts no sheet of its own, names itself as the door, and still
 * re-derives its drills after a save lands.
 */

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

function stubCheckIn(overrides: Partial<UseCheckIn> = {}): UseCheckIn {
  return {
    snapshots: [],
    status: 'ready',
    latest: undefined,
    previous: undefined,
    open: false,
    openFrom: () => {},
    close: () => {},
    reload: () => {},
    onSaved: () => {},
    savedAt: 0,
    ...overrides,
  };
}

function renderLearn(checkIn: UseCheckIn) {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <OnlineProvider>
        <LearnRegister activeName="Lin" checkIn={checkIn} />
      </OnlineProvider>
    </NextIntlClientProvider>,
  );
}

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('LearnRegister — the check-in sheet survives its own save', () => {
  it('mounts NO sheet of its own — a branch unmount can no longer destroy one', async () => {
    const state = { drills: [] as unknown[], getCount: 0 };
    mockFetch(state);
    renderLearn(stubCheckIn({ open: true }));

    await waitFor(() => expect(screen.getByRole('button', { name: 'Start check-in' })).toBeTruthy());
    // The owner says the sheet is OPEN and this register still renders none:
    // that is the structural guarantee replacing the old `savedRef` dance.
    expect(screen.queryByTestId('check-in-sheet')).toBeNull();
    expect(document.querySelector('.bottom-sheet')).toBeNull();
  });

  it('names itself as the door rather than opening a sheet directly', async () => {
    const state = { drills: [] as unknown[], getCount: 0 };
    mockFetch(state);
    const opened: string[] = [];
    renderLearn(stubCheckIn({ openFrom: (src) => opened.push(src) }));

    await waitFor(() => expect(screen.getByRole('button', { name: 'Start check-in' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Start check-in' }));

    // `source` is the only thing that can say WHICH door a member used, which
    // is the question the funnel's `entry` ratio exists to answer.
    expect(opened).toEqual(['learn']);
  });

  it('re-derives its drills once a save lands, wherever it was opened from', async () => {
    const state = { drills: [] as unknown[], getCount: 0 };
    mockFetch(state);
    const { rerender } = renderLearn(stubCheckIn());

    await waitFor(() => expect(screen.getByRole('button', { name: 'Start check-in' })).toBeTruthy());
    expect(state.getCount).toBe(1);

    // The save lands: the engine now has ratings to pick drills from.
    state.drills = [DRILL];
    rerender(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <OnlineProvider>
          <LearnRegister activeName="Lin" checkIn={stubCheckIn({ savedAt: 1234 })} />
        </OnlineProvider>
      </NextIntlClientProvider>,
    );

    await waitFor(() => expect(state.getCount).toBe(2));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Start check-in' })).toBeNull());
  });

  it('does not refetch when no save has landed', async () => {
    const state = { drills: [] as unknown[], getCount: 0 };
    mockFetch(state);
    const { rerender } = renderLearn(stubCheckIn());

    await waitFor(() => expect(screen.getByRole('button', { name: 'Start check-in' })).toBeTruthy());
    // An unrelated re-render — opening and closing the sheet, say — must not
    // re-ask. `savedAt` is unchanged, so nothing was saved.
    rerender(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <OnlineProvider>
          <LearnRegister activeName="Lin" checkIn={stubCheckIn({ open: true })} />
        </OnlineProvider>
      </NextIntlClientProvider>,
    );

    await waitFor(() => expect(screen.getByRole('button', { name: 'Start check-in' })).toBeTruthy());
    expect(state.getCount).toBe(1);
  });
});
