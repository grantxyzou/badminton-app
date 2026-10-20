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

  // Loading cascade, phase 5: between the sessions answering and the players
  // answering, `allPlayers` is [] — and the card said "No active players yet"
  // over a roster nobody had read. A lying empty state on a payments surface.
  it('does not say "No active players" while the players are still loading', async () => {
    urlFetch(async (url) => {
      if (url.includes('/api/players')) return new Promise<Response>(() => {});
      if (url.includes('/api/session') && !url.includes('/sessions')) {
        return new Response(JSON.stringify(ACTIVE_SESSION), { status: 200 });
      }
      if (url.includes('/api/sessions')) return new Response(JSON.stringify([ACTIVE_SESSION]), { status: 200 });
      return new Response('not found', { status: 404 });
    });
    render(<PaymentsCard />);
    await waitFor(() => expect(screen.getByLabelText('Payments')).toBeTruthy());
    expect(screen.queryByText(/No active players/i)).toBeNull();
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
    });
    // The waitlisted and removed players sit behind the footer's Show — one
    // line ("1 waitlisted · 1 removed"), neither of them money to collect.
    expect(screen.queryByText('Waitlist')).toBeNull();
    expect(screen.queryByText('Removed')).toBeNull();
    expect(screen.getByText('1 waitlisted · 1 removed')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Show/ }));
    expect(await screen.findByText('Waitlist')).toBeTruthy();
    expect(screen.getByText('Removed')).toBeTruthy();
  });

  it('the hero carries "N of M paid"; the card keeps a plain "Payments" title', async () => {
    fetchPlayers([
      { id: 'p1', name: 'Daisy', paid: true },
      { id: 'p2', name: 'Mei', paid: true },
      { id: 'p3', name: 'Sam', paid: false },
    ]);

    render(<PaymentsCard />);

    await waitFor(() => {
      expect(screen.getByText('Daisy')).toBeTruthy();
    });
    // The count left the header in 2026-06 and came back in the hero block
    // with the redesign (canvas board 10f, 2026-10-20): one line under the
    // progress bar, beside the still-owed sum once the bill is out.
    expect(screen.getByText('2 of 3 paid')).toBeTruthy();
    expect(screen.getByText('Payments')).toBeTruthy();
    // Unsettled: no frozen money, so no "still owed" amount is invented.
    expect(screen.queryByText(/still owed/)).toBeNull();
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

    // An unpaid player is a "Still owed" row with a Mark paid target.
    expect(screen.getByText(/Still owed · 1/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Mark Daisy paid' }));

    await waitFor(() => {
      expect(patchedBody).not.toBeNull();
      expect((patchedBody as unknown as { id: string; paid: boolean }).id).toBe('p1');
      expect((patchedBody as unknown as { id: string; paid: boolean }).paid).toBe(true);
    });
  });

  describe('settle UI', () => {
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


    it('shows per-row owedAmount on the still-owed rows; no Sent badge (removed by design)', async () => {
      fetchSettledPlayers([
        { id: 'p1', name: 'Daisy', paid: false, owedAmount: 15 },
        { id: 'p2', name: 'Mei', paid: false, owedAmount: 15 },
      ]);
      render(<PaymentsCard />);
      await waitFor(() => expect(screen.getByText('Daisy')).toBeTruthy());
      expect(screen.queryByText(/Sent · \$15/)).toBeNull();
      // Two still-owed rows × $15 = two matching texts
      expect(screen.getAllByText('$15').length).toBe(2);
      expect(screen.getByText(/\$30 still owed/)).toBeTruthy();
    });

    it('hides per-row $ once the session is unsettled, even if owedAmount lingers on player docs', async () => {
      // ACTIVE_SESSION is unsettled, but the players still carry a frozen
      // owedAmount from a settle that was later undone ("Edit bill"). The
      // stale amount must NOT render — a per-person owed only means anything
      // while the session is settled. (Regression: it used to stay on-screen.)
      fetchPlayers([
        { id: 'p1', name: 'Daisy', paid: true, owedAmount: 19.28 },
        { id: 'p2', name: 'Mei', paid: false, owedAmount: 19.28 },
      ]);
      render(<PaymentsCard />);
      await waitFor(() => expect(screen.getByText('Daisy')).toBeTruthy());
      expect(screen.queryByText('$19.28')).toBeNull();
    });

    it('hero: shows players · $ each · N of M paid · still owed for the viewed session', async () => {
      fetchSettledPlayers([
        { id: 'p1', name: 'Daisy', paid: true, owedAmount: 15 },
        { id: 'p2', name: 'Mei', paid: false, owedAmount: 15 },
      ]);
      render(<PaymentsCard />);
      await waitFor(() => expect(screen.getByText('Daisy')).toBeTruthy());
      expect(screen.getByText(/2 players/)).toBeTruthy();
      expect(screen.getByText('1 of 2 paid')).toBeTruthy();
      // Frozen money only: the still-owed sum is the unpaid rows' owedAmount.
      expect(screen.getByText(/\$15 still owed/)).toBeTruthy();
      // The amount is a single "$15 each" node — it must NOT inflate the
      // exact-'$15' count: Mei's row and the Still-owed heading's sum.
      expect(screen.getByText('$15 each')).toBeTruthy();
      expect(screen.getAllByText('$15').length).toBe(2);
      // Daisy has paid, so she is a chip (Paid · 1), not a row.
      expect(screen.getByText(/Paid · 1/)).toBeTruthy();
      // The viewed chip counts its live roster.
      expect(screen.getByRole('tab').textContent).toMatch(/1 owing/);
    });


    it('summary header: Share disabled + "—" when the session has no cost', async () => {
      // ACTIVE_SESSION is unsettled with no court/bird cost → no per-person amount.
      fetchPlayers([{ id: 'p1', name: 'Daisy', paid: false }]);
      render(<PaymentsCard />);
      await waitFor(() => expect(screen.getByText('Daisy')).toBeTruthy());
      const share = screen.getByRole('button', { name: 'Share receipt' });
      expect((share as HTMLButtonElement).disabled).toBe(true);
      expect(screen.getByText('—')).toBeTruthy();
    });

    it('summary header: Share enabled but shows the recipient reason when none is set', async () => {
      // fetchSettledPlayers 404s /api/admin/settings → no recipient.
      fetchSettledPlayers([{ id: 'p1', name: 'Daisy', paid: true, owedAmount: 15 }]);
      render(<PaymentsCard />);
      await waitFor(() => expect(screen.getByText('Daisy')).toBeTruthy());
      const share = screen.getByRole('button', { name: 'Share receipt' });
      expect((share as HTMLButtonElement).disabled).toBe(false);
      fireEvent.click(share);
      await waitFor(() => expect(screen.getByText(/e-transfer recipient/i)).toBeTruthy());
    });

    it('summary header: Share opens the receipt sheet when a recipient is set', async () => {
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
    });

    it('per-row receipt icon opens the individual receipt for the VIEWED session', async () => {
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
    });

    it('v1.5/C: removing a settled debtor opens Cover & remove, not a plain confirm', async () => {
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
    });

    it('v1.5/C: a paid (no-debt) player still removes via plain confirm path (no CoverSheet)', async () => {
      fetchSettledPlayers([
        { id: 'p1', name: 'Daisy', paid: true, owedAmount: 15, writtenOff: false },
      ]);
      render(<PaymentsCard />);
      await waitFor(() => expect(screen.getByText('Daisy')).toBeTruthy());

      fireEvent.click(screen.getByRole('button', { name: /More actions for Daisy/i }));
      fireEvent.click(await screen.findByText(/Remove from session/i));

      // Paid players have no orphan-debt risk → no cover-and-remove sheet.
      expect(screen.queryByRole('button', { name: /Cover & remove/i })).toBeNull();
    });

    it('falls back to no $ on rows without owedAmount even when flag on', async () => {
      fetchSettledPlayers([
        { id: 'p1', name: 'Daisy', paid: true, owedAmount: 15 },
        { id: 'p2', name: 'LateAdd', paid: false }, // added after settle, no owed
      ]);
      render(<PaymentsCard />);
      await waitFor(() => expect(screen.getByText('LateAdd')).toBeTruthy());
      // LateAdd owes with no frozen amount: a still-owed row with no $ beside it.
      expect(screen.getByRole('button', { name: 'Mark LateAdd paid' })).toBeTruthy();
      expect(screen.queryByText('$15')).toBeNull();
    });
  });
});
