// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import RacketRecCard from '../../components/stats/cards/RacketRecCard';
import enMessages from '../../messages/en.json';

/**
 * EI Task 4: RacketRecCard consumes the equipment insight card via the shared
 * useInsight hook. The safety property under test is the FALLBACK: flag off,
 * no equipment signal, a stale `suggests` id, or a failed insight fetch must
 * all render exactly today's card (deterministic /api/recommend pick +
 * templated reason) — never an error surface, since the card is fully usable
 * without the insight (CLAUDE.md legible-fail / not-an-error-state rule).
 */

const DEFAULT_ITEM = { id: 'racket-default', category: 'racket', brand: 'Yonex', model: 'Nanoflare 800' };
const CATALOG = [
  DEFAULT_ITEM,
  { id: 'racket-suggested', category: 'racket', brand: 'Victor', model: 'Thruster K Falcon' },
];

const { mockUseInsight } = vi.hoisted(() => ({ mockUseInsight: vi.fn() }));
vi.mock('@/lib/useInsight', () => ({ useInsight: mockUseInsight }));

function mockFetch(opts: { recommendReason?: string | null; recommendStatus?: number } = {}) {
  global.fetch = vi.fn(async (url: RequestInfo | URL) => {
    const u = String(url);
    if (u.includes('/api/recommend')) {
      if (opts.recommendStatus && opts.recommendStatus >= 400) {
        return new Response('{}', { status: opts.recommendStatus });
      }
      return new Response(
        JSON.stringify({
          item: DEFAULT_ITEM,
          reason: 'recommendReason' in opts ? opts.recommendReason : 'A solid all-rounder lots of players start with.',
        }),
        { status: 200 },
      );
    }
    if (u.includes('/api/equipment/catalog')) {
      return new Response(JSON.stringify({ items: CATALOG }), { status: 200 });
    }
    return new Response('{}', { status: 404 });
  }) as unknown as typeof fetch;
}

function renderCard() {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <RacketRecCard name="Lin" mine={null} />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  vi.useRealTimers();
  delete process.env.NEXT_PUBLIC_FLAG_EQUIPMENT_INSIGHT;
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  mockUseInsight.mockReset();
  delete process.env.NEXT_PUBLIC_FLAG_EQUIPMENT_INSIGHT;
});

describe('RacketRecCard — equipment insight consumption', () => {
  it('flag off: renders the templated reason, never generated text, even if the hook somehow returns an equipment slice', async () => {
    delete process.env.NEXT_PUBLIC_FLAG_EQUIPMENT_INSIGHT;
    mockUseInsight.mockReturnValue({
      data: { account: true, greeting: null, level: null, trend: null, equipment: { headline: 'AI headline', support: 'AI support', kind: 'weakness-conflict' } },
      loading: false,
      error: false,
    });
    mockFetch();
    renderCard();

    expect(await screen.findByText('Yonex Nanoflare 800')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Why this\?/ }));
    expect(await screen.findByText('A solid all-rounder lots of players start with.')).toBeTruthy();
    expect(screen.queryByText('AI headline')).toBeNull();
    expect(screen.queryByText('AI support')).toBeNull();
    // Pin the actual mechanism, not just the outcome: useInsight itself must
    // be called with enabled=false when the flag is off, or this test would
    // still pass even if the `equipmentOn ?` guard around `equipment` were
    // deleted (the mock always returns the same data regardless of args).
    expect(mockUseInsight).toHaveBeenCalledWith(false);
  });

  it('flag on + equipment card: renders the generated headline and support (support fills the reveal even when /api/recommend has no reason)', async () => {
    process.env.NEXT_PUBLIC_FLAG_EQUIPMENT_INSIGHT = 'true';
    mockUseInsight.mockReturnValue({
      data: { account: true, greeting: null, level: null, trend: null, equipment: { headline: 'Your racket is fighting your drops', support: 'Extra-stiff, head-heavy builds make touch shots harder.', kind: 'weakness-conflict' } },
      loading: false,
      error: false,
    });
    // No reason from /api/recommend — the generated support must still surface
    // (widened "anything to reveal" guard), not silently swallow the insight.
    mockFetch({ recommendReason: null });
    renderCard();

    expect(await screen.findByText('Your racket is fighting your drops')).toBeTruthy();
    const btn = screen.getByRole('button', { name: /Why this\?/ });
    fireEvent.click(btn);
    expect(await screen.findByText('Extra-stiff, head-heavy builds make touch shots harder.')).toBeTruthy();
  });

  it('flag on + equipment card with `suggests`: renders THAT racket, not recommendRacket\'s default pick', async () => {
    process.env.NEXT_PUBLIC_FLAG_EQUIPMENT_INSIGHT = 'true';
    mockUseInsight.mockReturnValue({
      data: {
        account: true,
        greeting: null,
        level: null,
        trend: null,
        equipment: { headline: 'A better fit exists', support: 'Try this one instead.', kind: 'phase-mismatch', suggests: 'racket-suggested' },
      },
      loading: false,
      error: false,
    });
    mockFetch();
    renderCard();

    expect(await screen.findByText('Victor Thruster K Falcon')).toBeTruthy();
    expect(screen.queryByText('Yonex Nanoflare 800')).toBeNull();
  });

  it('a stale/unknown `suggests` id (absent from the fetched catalog) falls back to the default pick, not a blank card', async () => {
    process.env.NEXT_PUBLIC_FLAG_EQUIPMENT_INSIGHT = 'true';
    mockUseInsight.mockReturnValue({
      data: {
        account: true,
        greeting: null,
        level: null,
        trend: null,
        equipment: { headline: 'A better fit exists', support: 'Try this one instead.', kind: 'phase-mismatch', suggests: 'racket-does-not-exist' },
      },
      loading: false,
      error: false,
    });
    mockFetch();
    renderCard();

    expect(await screen.findByText('Yonex Nanoflare 800')).toBeTruthy();
  });

  it('flag on + equipment null: falls back to the templated reason, not an error', async () => {
    process.env.NEXT_PUBLIC_FLAG_EQUIPMENT_INSIGHT = 'true';
    mockUseInsight.mockReturnValue({
      data: { account: true, greeting: null, level: null, trend: null, equipment: null },
      loading: false,
      error: false,
    });
    mockFetch();
    renderCard();

    expect(await screen.findByText('Yonex Nanoflare 800')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Why this\?/ }));
    expect(await screen.findByText('A solid all-rounder lots of players start with.')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('a failed insight fetch renders the templated reason and NO role="alert" — the card must stay usable without the insight', async () => {
    process.env.NEXT_PUBLIC_FLAG_EQUIPMENT_INSIGHT = 'true';
    mockUseInsight.mockReturnValue({ data: null, loading: false, error: true });
    mockFetch();
    renderCard();

    expect(await screen.findByText('Yonex Nanoflare 800')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Why this\?/ }));
    expect(await screen.findByText('A solid all-rounder lots of players start with.')).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  });
});
