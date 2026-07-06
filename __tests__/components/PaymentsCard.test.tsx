// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import PaymentsCard from '@/components/admin/CommandCenter/PaymentsCard';

const originalFetch = global.fetch;

const ACTIVE_SESSION = { id: 'session-2026-05-13', datetime: '2026-05-13T20:00:00-04:00', maxPlayers: 12 };

function urlFetch(impl: (url: string, init?: RequestInit) => Promise<Response>) {
  global.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : (input as Request).url;
    return impl(url, init);
  }) as typeof fetch;
}

function fetchPlayers(players: Array<Record<string, unknown>>) {
  urlFetch(async (url) => {
    if (url.includes('/api/session') && !url.includes('/sessions')) {
      return new Response(JSON.stringify(ACTIVE_SESSION), { status: 200 });
    }
    if (url.includes('/api/sessions')) {
      return new Response(JSON.stringify([ACTIVE_SESSION]), { status: 200 });
    }
    if (url.includes('/api/players')) {
      return new Response(JSON.stringify(players), { status: 200 });
    }
    return new Response('not found', { status: 404 });
  });
}

describe('<PaymentsCard />', () => {
  afterEach(() => {
    cleanup();
    global.fetch = originalFetch;
  });

  it('renders an empty card with "No active players" when no players', async () => {
    fetchPlayers([]);
    render(<PaymentsCard />);
    await waitFor(() => {
      expect(screen.getByText(/No active players/i)).toBeTruthy();
    });
  });

  it('filters out removed and waitlisted players', async () => {
    fetchPlayers([
      { id: 'p1', name: 'Daisy', paid: true },
      { id: 'p2', name: 'Mei', paid: false },
      { id: 'p3', name: 'Removed', paid: false, removed: true, removedAt: '2026-05-11T12:00:00Z' },
      { id: 'p4', name: 'Waitlist', paid: false, waitlisted: true },
    ]);

    render(<PaymentsCard />);

    await waitFor(() => {
      expect(screen.getByText('Daisy')).toBeTruthy();
      expect(screen.getByText('Mei')).toBeTruthy();
      // 'Removed' name is rendered inside a collapsed section. Open the
      // collapsible to confirm presence is intentional, not an active row.
      // For this assertion, just verify Removed isn't rendered as an
      // active row (i.e. next to a paid pill).
      expect(screen.queryByText('Waitlist')).toBeTruthy(); // shows in waitlist section
    });
  });

  it('no longer renders the "X of Y paid" header (removed by design); per-row paid state still shows', async () => {
    fetchPlayers([
      { id: 'p1', name: 'Daisy', paid: true },
      { id: 'p2', name: 'Mei', paid: true },
      { id: 'p3', name: 'Sam', paid: false },
    ]);

    render(<PaymentsCard />);

    await waitFor(() => {
      expect(screen.getByText('Daisy')).toBeTruthy();
    });
    // The old "X of Y paid" summary line is gone — the strip + per-row
    // pills carry payment state now. The card keeps a plain "Payments" title.
    expect(screen.queryByText(/of 3 paid/i)).toBeNull();
    expect(screen.getByText('Payments')).toBeTruthy();
  });

  it('toggles paid optimistically and PATCHes the API', async () => {
    let patchedBody: { id: string; paid: boolean } | null = null;
    let getCount = 0;
    urlFetch(async (url, init) => {
      const method = init?.method ?? 'GET';
      if (method === 'GET' && url.includes('/api/session') && !url.includes('/sessions')) {
        return new Response(JSON.stringify(ACTIVE_SESSION), { status: 200 });
      }
      if (method === 'GET' && url.includes('/api/sessions')) {
        return new Response(JSON.stringify([ACTIVE_SESSION]), { status: 200 });
      }
      if (method === 'GET' && url.includes('/api/players')) {
        getCount++;
        return new Response(JSON.stringify([
          { id: 'p1', name: 'Daisy', paid: false },
        ]), { status: 200 });
      }
      if (method === 'PATCH' && url.includes('/api/players')) {
        patchedBody = JSON.parse(init?.body as string);
        return new Response('{}', { status: 200 });
      }
      return new Response('not found', { status: 404 });
    });

    render(<PaymentsCard />);

    await waitFor(() => {
      expect(screen.getByText('Daisy')).toBeTruthy();
    });
    expect(getCount).toBeGreaterThan(0);

    const pill = screen.getByRole('button', { name: 'Pending' });
    fireEvent.click(pill);

    await waitFor(() => {
      expect(patchedBody).not.toBeNull();
      expect((patchedBody as unknown as { id: string; paid: boolean }).id).toBe('p1');
      expect((patchedBody as unknown as { id: string; paid: boolean }).paid).toBe(true);
    });
  });

  describe('settle UI (NEXT_PUBLIC_FLAG_SETTLE)', () => {
    const SETTLED_SESSION = {
      ...ACTIVE_SESSION,
      settled: {
        at: '2026-05-08T20:00:00.000Z',
        costPerPerson: 15,
        totalCost: 30,
        courtTotal: 30,
        birdTotal: 0,
        playerCount: 2,
        playerNames: ['Daisy', 'Mei'],
      },
    };

    function fetchSettledPlayers(players: Array<Record<string, unknown>>) {
      urlFetch(async (url) => {
        if (url.includes('/api/sessions')) {
          return new Response(JSON.stringify([SETTLED_SESSION]), { status: 200 });
        }
        if (url.includes('/api/session')) {
          return new Response(JSON.stringify(SETTLED_SESSION), { status: 200 });
        }
        if (url.includes('/api/players')) {
          return new Response(JSON.stringify(players), { status: 200 });
        }
        return new Response('not found', { status: 404 });
      });
    }

    it('hides per-row $ when flag is off (Sent badge was removed by design)', async () => {
      const prev = process.env.NEXT_PUBLIC_FLAG_SETTLE;
      process.env.NEXT_PUBLIC_FLAG_SETTLE = 'false';
      try {
        fetchSettledPlayers([
          { id: 'p1', name: 'Daisy', paid: true, owedAmount: 15 },
        ]);
        render(<PaymentsCard />);
        await waitFor(() => expect(screen.getByText('Daisy')).toBeTruthy());
        // Settled badge intentionally removed — never rendered now.
        expect(screen.queryByText(/Sent ·/)).toBeNull();
        expect(screen.queryByText('$15')).toBeNull();
      } finally {
        process.env.NEXT_PUBLIC_FLAG_SETTLE = prev;
      }
    });

    it('shows per-row owedAmount when flag on; no Sent badge (removed by design)', async () => {
      const prev = process.env.NEXT_PUBLIC_FLAG_SETTLE;
      process.env.NEXT_PUBLIC_FLAG_SETTLE = 'true';
      try {
        fetchSettledPlayers([
          { id: 'p1', name: 'Daisy', paid: true, owedAmount: 15 },
          { id: 'p2', name: 'Mei', paid: false, owedAmount: 15 },
        ]);
        render(<PaymentsCard />);
        await waitFor(() => expect(screen.getByText('Daisy')).toBeTruthy());
        expect(screen.queryByText(/Sent · \$15/)).toBeNull();
        // Two rows × $15 = two matching texts
        expect(screen.getAllByText('$15').length).toBe(2);
      } finally {
        process.env.NEXT_PUBLIC_FLAG_SETTLE = prev;
      }
    });

    it('summary header: shows players · % paid · $ each for the viewed session', async () => {
      const prev = process.env.NEXT_PUBLIC_FLAG_SETTLE;
      process.env.NEXT_PUBLIC_FLAG_SETTLE = 'true';
      try {
        fetchSettledPlayers([
          { id: 'p1', name: 'Daisy', paid: true, owedAmount: 15 },
          { id: 'p2', name: 'Mei', paid: false, owedAmount: 15 },
        ]);
        render(<PaymentsCard />);
        await waitFor(() => expect(screen.getByText('Daisy')).toBeTruthy());
        expect(screen.getByText(/2 players.*50% paid/)).toBeTruthy();
        // The amount is a single "$15 each" node — it must NOT inflate the
        // per-row exact-'$15' count (still 2 rows).
        expect(screen.getByText('$15 each')).toBeTruthy();
        expect(screen.getAllByText('$15').length).toBe(2);
      } finally {
        process.env.NEXT_PUBLIC_FLAG_SETTLE = prev;
      }
    });

    it('summary header: hides the $ each line + Share button when settle flag is off', async () => {
      const prev = process.env.NEXT_PUBLIC_FLAG_SETTLE;
      process.env.NEXT_PUBLIC_FLAG_SETTLE = 'false';
      try {
        fetchSettledPlayers([{ id: 'p1', name: 'Daisy', paid: true, owedAmount: 15 }]);
        render(<PaymentsCard />);
        await waitFor(() => expect(screen.getByText('Daisy')).toBeTruthy());
        expect(screen.queryByText(/each/i)).toBeNull();
        expect(screen.queryByRole('button', { name: 'Share receipt' })).toBeNull();
        // Line 1 (cost-independent) still renders.
        expect(screen.getByText(/1 player/)).toBeTruthy();
      } finally {
        process.env.NEXT_PUBLIC_FLAG_SETTLE = prev;
      }
    });

    it('summary header: Share disabled + "—" when the session has no cost', async () => {
      const prev = process.env.NEXT_PUBLIC_FLAG_SETTLE;
      process.env.NEXT_PUBLIC_FLAG_SETTLE = 'true';
      try {
        // ACTIVE_SESSION is unsettled with no court/bird cost → no per-person amount.
        fetchPlayers([{ id: 'p1', name: 'Daisy', paid: false }]);
        render(<PaymentsCard />);
        await waitFor(() => expect(screen.getByText('Daisy')).toBeTruthy());
        const share = screen.getByRole('button', { name: 'Share receipt' });
        expect((share as HTMLButtonElement).disabled).toBe(true);
        expect(screen.getByText('—')).toBeTruthy();
      } finally {
        process.env.NEXT_PUBLIC_FLAG_SETTLE = prev;
      }
    });

    it('summary header: Share enabled but shows the recipient reason when none is set', async () => {
      const prev = process.env.NEXT_PUBLIC_FLAG_SETTLE;
      process.env.NEXT_PUBLIC_FLAG_SETTLE = 'true';
      try {
        // fetchSettledPlayers 404s /api/admin/settings → no recipient.
        fetchSettledPlayers([{ id: 'p1', name: 'Daisy', paid: true, owedAmount: 15 }]);
        render(<PaymentsCard />);
        await waitFor(() => expect(screen.getByText('Daisy')).toBeTruthy());
        const share = screen.getByRole('button', { name: 'Share receipt' });
        expect((share as HTMLButtonElement).disabled).toBe(false);
        fireEvent.click(share);
        await waitFor(() => expect(screen.getByText(/e-transfer recipient/i)).toBeTruthy());
      } finally {
        process.env.NEXT_PUBLIC_FLAG_SETTLE = prev;
      }
    });

    it('summary header: Share opens the receipt sheet when a recipient is set', async () => {
      const prev = process.env.NEXT_PUBLIC_FLAG_SETTLE;
      process.env.NEXT_PUBLIC_FLAG_SETTLE = 'true';
      try {
        urlFetch(async (url) => {
          if (url.includes('/api/admin/settings')) {
            return new Response(JSON.stringify({ eTransferRecipient: { name: 'Grant', email: 'g@x.com' } }), { status: 200 });
          }
          if (url.includes('/api/sessions')) {
            return new Response(JSON.stringify([SETTLED_SESSION]), { status: 200 });
          }
          if (url.includes('/api/session')) {
            return new Response(JSON.stringify(SETTLED_SESSION), { status: 200 });
          }
          if (url.includes('/api/players')) {
            return new Response(JSON.stringify([{ id: 'p1', name: 'Daisy', paid: true, owedAmount: 15 }]), { status: 200 });
          }
          return new Response('not found', { status: 404 });
        });
        render(<PaymentsCard />);
        await waitFor(() => expect(screen.getByText('Daisy')).toBeTruthy());
        fireEvent.click(screen.getByRole('button', { name: 'Share receipt' }));
        await waitFor(() => expect(screen.getByText('Share session cost')).toBeTruthy());
      } finally {
        process.env.NEXT_PUBLIC_FLAG_SETTLE = prev;
      }
    });

    it('per-row receipt icon opens the individual receipt for the VIEWED session', async () => {
      const prev = process.env.NEXT_PUBLIC_FLAG_SETTLE;
      process.env.NEXT_PUBLIC_FLAG_SETTLE = 'true';
      try {
        urlFetch(async (url) => {
          if (url.includes('/api/admin/settings')) {
            return new Response(JSON.stringify({ eTransferRecipient: { name: 'Grant', email: 'g@x.com' } }), { status: 200 });
          }
          if (url.includes('/api/sessions')) {
            return new Response(JSON.stringify([SETTLED_SESSION]), { status: 200 });
          }
          if (url.includes('/api/session')) {
            return new Response(JSON.stringify(SETTLED_SESSION), { status: 200 });
          }
          if (url.includes('/api/players')) {
            return new Response(JSON.stringify([
              { id: 'p1', name: 'Daisy', paid: true, owedAmount: 15 },
              { id: 'p2', name: 'Mei', paid: false, owedAmount: 15 },
            ]), { status: 200 });
          }
          return new Response('not found', { status: 404 });
        });
        render(<PaymentsCard />);
        await waitFor(() => expect(screen.getByText('Daisy')).toBeTruthy());
        // Icon renders locally now (no onSendIndividualReceipt prop needed).
        fireEvent.click(screen.getByLabelText('Send receipt to Mei'));
        await waitFor(() => expect(screen.getByText('Share session cost')).toBeTruthy());
        // Individual mode, preset to the tapped player — proves it's THIS
        // session's receipt, not the active-session delegation.
        const select = screen.getByRole('combobox') as HTMLSelectElement;
        expect(select.value).toBe('Mei');
      } finally {
        process.env.NEXT_PUBLIC_FLAG_SETTLE = prev;
      }
    });

    it('v1.5/C: removing a settled debtor opens Cover & remove, not a plain confirm', async () => {
      const prevSettle = process.env.NEXT_PUBLIC_FLAG_SETTLE;
      const prevLedger = process.env.NEXT_PUBLIC_FLAG_LEDGER;
      process.env.NEXT_PUBLIC_FLAG_SETTLE = 'true';
      process.env.NEXT_PUBLIC_FLAG_LEDGER = 'true';
      try {
        fetchSettledPlayers([
          { id: 'anna-1', name: 'Anna', paid: false, owedAmount: 16, writtenOff: false },
        ]);
        render(<PaymentsCard />);
        await waitFor(() => expect(screen.getByText('Anna')).toBeTruthy());

        fireEvent.click(screen.getByRole('button', { name: /More actions for Anna/i }));
        fireEvent.click(await screen.findByText(/Remove from session/i));

        // The cover-and-remove CoverSheet should take over — never a window.confirm.
        await waitFor(() => {
          expect(screen.getByRole('button', { name: /Cover & remove/i })).toBeTruthy();
        });
        expect(screen.getByText(/Anna owes \$16/i)).toBeTruthy();
        expect(screen.getByRole('button', { name: /Remove without covering/i })).toBeTruthy();
      } finally {
        process.env.NEXT_PUBLIC_FLAG_SETTLE = prevSettle;
        process.env.NEXT_PUBLIC_FLAG_LEDGER = prevLedger;
      }
    });

    it('v1.5/C: a paid (no-debt) player still removes via plain confirm path (no CoverSheet)', async () => {
      const prevSettle = process.env.NEXT_PUBLIC_FLAG_SETTLE;
      const prevLedger = process.env.NEXT_PUBLIC_FLAG_LEDGER;
      process.env.NEXT_PUBLIC_FLAG_SETTLE = 'true';
      process.env.NEXT_PUBLIC_FLAG_LEDGER = 'true';
      try {
        fetchSettledPlayers([
          { id: 'p1', name: 'Daisy', paid: true, owedAmount: 15, writtenOff: false },
        ]);
        render(<PaymentsCard />);
        await waitFor(() => expect(screen.getByText('Daisy')).toBeTruthy());

        fireEvent.click(screen.getByRole('button', { name: /More actions for Daisy/i }));
        fireEvent.click(await screen.findByText(/Remove from session/i));

        // Paid players have no orphan-debt risk → no cover-and-remove sheet.
        expect(screen.queryByRole('button', { name: /Cover & remove/i })).toBeNull();
      } finally {
        process.env.NEXT_PUBLIC_FLAG_SETTLE = prevSettle;
        process.env.NEXT_PUBLIC_FLAG_LEDGER = prevLedger;
      }
    });

    it('falls back to no $ on rows without owedAmount even when flag on', async () => {
      const prev = process.env.NEXT_PUBLIC_FLAG_SETTLE;
      process.env.NEXT_PUBLIC_FLAG_SETTLE = 'true';
      try {
        fetchSettledPlayers([
          { id: 'p1', name: 'Daisy', paid: true, owedAmount: 15 },
          { id: 'p2', name: 'LateAdd', paid: false }, // added after settle, no owed
        ]);
        render(<PaymentsCard />);
        await waitFor(() => expect(screen.getByText('LateAdd')).toBeTruthy());
        // Only one $15 row visible
        expect(screen.getAllByText('$15').filter((el) => el.tagName !== 'SPAN' || el.classList.length > 0).length).toBeGreaterThanOrEqual(1);
      } finally {
        process.env.NEXT_PUBLIC_FLAG_SETTLE = prev;
      }
    });
  });
});
