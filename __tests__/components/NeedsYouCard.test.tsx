// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import NeedsYouCard from '@/components/admin/CommandCenter/NeedsYouCard';

/**
 * Admin audit, 2026-10-12: Profile said "3 need you" and the Command Center
 * had nowhere that said which three. This card lists the same signals, from
 * the same hook, each one a row that goes to the fix.
 */
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function stub(o: { players?: unknown[]; birds?: unknown; members?: unknown[]; jobs?: unknown[] }) {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/api/stringing/jobs')) return new Response(JSON.stringify({ jobs: o.jobs ?? [] }), { status: 200 });
    if (url.includes('/api/players')) return new Response(JSON.stringify(o.players ?? []), { status: 200 });
    if (url.includes('/api/birds')) return new Response(JSON.stringify(o.birds ?? { currentStock: 20, burnPerSession: 2 }), { status: 200 });
    if (url.includes('/api/members')) return new Response(JSON.stringify(o.members ?? []), { status: 200 });
    return new Response('[]', { status: 200 });
  }));
}

const handlers = () => ({ onOpenPayments: vi.fn(), onOpenBirds: vi.fn(), onOpenDormant: vi.fn(), onOpenBench: vi.fn() });

describe('<NeedsYouCard />', () => {
  it('lists each signal Profile counts, and each row goes to its fix', async () => {
    stub({
      players: [{ paid: false }, { paid: false }, { paid: true }],
      birds: { currentStock: 2, burnPerSession: 2 },
      jobs: [{ stringerId: null, status: 'requested', readyBy: null, paidAt: null }],
    });
    const h = handlers();
    render(<NeedsYouCard refreshKey={0} {...h} />);
    fireEvent.click(await screen.findByText('2 unpaid this session'));
    fireEvent.click(screen.getByText('Birds: reorder now'));
    fireEvent.click(screen.getByText('Stringing bench'));
    expect(screen.getByText('1 waiting')).toBeDefined();
    expect(h.onOpenPayments).toHaveBeenCalled();
    expect(h.onOpenBirds).toHaveBeenCalled();
    expect(h.onOpenBench).toHaveBeenCalled();
  });

  it('renders nothing when nothing needs anyone', async () => {
    stub({ players: [{ paid: true }] });
    const { container } = render(<NeedsYouCard refreshKey={0} {...handlers()} />);
    // Let the reads settle, then expect an empty slot — not a list of zeros.
    await new Promise((r) => setTimeout(r, 80));
    expect(container.textContent).toBe('');
  });

  it('says the check failed rather than showing an empty list', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 500 })));
    render(<NeedsYouCard refreshKey={0} {...handlers()} />);
    await waitFor(() => expect(screen.getByText(/Couldn.t check what needs you/)).toBeDefined());
  });
});
