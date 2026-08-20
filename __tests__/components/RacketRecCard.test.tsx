// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import RacketRecCard from '../../components/stats/cards/RacketRecCard';
import enMessages from '../../messages/en.json';

function Wrapper({ children }: { children: React.ReactNode }) {
  return <NextIntlClientProvider locale="en" messages={enMessages}>{children}</NextIntlClientProvider>;
}

function mockFetch(body: unknown, ok = true) {
  global.fetch = vi.fn(async () => new Response(JSON.stringify(body), { status: ok ? 200 : 500 })) as unknown as typeof fetch;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('RacketRecCard — reasons, warnings, check-in prompt (Task 7)', () => {
  it('lists every reason and warning when the engine supplies them', async () => {
    mockFetch({
      item: { id: 'r1', category: 'racket', brand: 'Yonex', model: 'ArcSaber 7 Pro', skillRange: [2, 5], attributes: {} },
      reason: 'Even balance suits your all-round game',
      reasons: ['Even balance suits your all-round game', 'Mid-range tier matches your intermediate skill level'],
      warnings: ['At up to 88g this may tire your arm'],
    });
    render(<Wrapper><RacketRecCard name="Lin" mine={null} /></Wrapper>);
    fireEvent.click(await screen.findByRole('button'));
    expect(screen.getByText(/Mid-range tier matches/)).toBeTruthy();
    expect(screen.getByText(/may tire your arm/)).toBeTruthy();
  });

  it('prompts for the check-in instead of inventing a pick', async () => {
    mockFetch({ item: null, reason: null, needsCheckIn: true });
    render(<Wrapper><RacketRecCard name="Lin" mine={null} /></Wrapper>);
    expect(await screen.findByText(/Do the check-in/)).toBeTruthy();
  });

  // The needsCheckIn state has nothing to expand — it must stay a plain,
  // non-interactive card (the existing conditional-interactivity rule).
  it('does not render a button for the needsCheckIn state', async () => {
    mockFetch({ item: null, reason: null, needsCheckIn: true });
    const { container } = render(<Wrapper><RacketRecCard name="Lin" mine={null} /></Wrapper>);
    await screen.findByText(/Do the check-in/);
    expect(container.querySelector('button')).toBeNull();
  });

  // Unknown is not known-false: a 403 means the session expired, not "no pick".
  it('shows an actionable state on 403 rather than an empty recommendation', async () => {
    global.fetch = vi.fn(async () => new Response(JSON.stringify({ error: 'forbidden' }), { status: 403 })) as unknown as typeof fetch;
    render(<Wrapper><RacketRecCard name="Lin" mine={null} /></Wrapper>);
    expect(await screen.findByRole('alert')).toBeTruthy();
  });

  // Fix round 1: the engine can legitimately return an empty `reasons` array
  // alongside a non-empty `warnings` (e.g. scoreWeight's pure safety-flag
  // branch with none of the other scorers landing on a reason branch). The
  // card must still be expandable and must still surface the warning — a
  // warning is the one thing this card must never silently drop.
  it('is still expandable and surfaces the warning when reasons is empty but warnings is not', async () => {
    mockFetch({
      item: { id: 'r3', category: 'racket', brand: 'Yonex', model: 'Nanoflare 800', skillRange: [4, 6], attributes: {} },
      reason: null,
      reasons: [],
      warnings: ['At up to 88g this may tire your arm'],
    });
    render(<Wrapper><RacketRecCard name="Lin" mine={null} /></Wrapper>);
    fireEvent.click(await screen.findByRole('button'));
    expect(screen.getByText(/may tire your arm/)).toBeTruthy();
  });

  // Flag-off shape (no reasons/warnings array) must keep working unchanged.
  it('still renders the single reason when the engine omits reasons/warnings', async () => {
    mockFetch({
      item: { id: 'r2', category: 'racket', brand: 'Victor', model: 'Thruster K Falcon Claw', skillRange: [1, 4], attributes: {} },
      reason: 'A solid all-rounder lots of players start with.',
    });
    render(<Wrapper><RacketRecCard name="Lin" mine={null} /></Wrapper>);
    fireEvent.click(await screen.findByRole('button'));
    expect(screen.getByText('A solid all-rounder lots of players start with.')).toBeTruthy();
  });

  // Important fix (final review): the card must refetch when its inputs
  // change (format, budget, or the owned-racket set) rather than only after a
  // reload — otherwise "stops recommending a racket you already own" only
  // takes effect once. RacketRow derives a `refreshKey` from the gear state
  // and folds it into the fetch effect's deps alongside `name`.
  it('refetches when refreshKey changes, even though name stays the same', async () => {
    let callCount = 0;
    global.fetch = vi.fn(async () => {
      callCount += 1;
      return new Response(JSON.stringify({
        item: { id: `r${callCount}`, category: 'racket', brand: 'Yonex', model: `Pick ${callCount}`, skillRange: [1, 6], attributes: {} },
        reason: null,
      }), { status: 200 });
    }) as unknown as typeof fetch;

    const { rerender } = render(
      <Wrapper><RacketRecCard name="Lin" mine={null} refreshKey="a" /></Wrapper>,
    );
    await waitFor(() => expect(screen.getByText('Yonex Pick 1')).toBeTruthy());
    expect(callCount).toBe(1);

    // Same name, different refreshKey (e.g. the player just changed format) —
    // must trigger a second fetch, not silently keep the stale pick.
    rerender(<Wrapper><RacketRecCard name="Lin" mine={null} refreshKey="b" /></Wrapper>);
    await waitFor(() => expect(screen.getByText('Yonex Pick 2')).toBeTruthy());
    expect(callCount).toBe(2);
  });
});
