// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent, within } from '@testing-library/react';
import PaymentsCard from '@/components/admin/CommandCenter/PaymentsCard';

const originalFetch = global.fetch;

/** An element whose whole text is `text`, however it is split into spans —
 *  the innermost one, so a parent holding the same text does not match too. */
function byWholeText(text: string) {
  return screen.getByText((_, el) => !!el && el.textContent === text && ![...el.children].some((c) => c.textContent === text));
}

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
    expect(byWholeText('2 of 3 paid')).toBeTruthy();
    expect(screen.getByText('Payments')).toBeTruthy();
    // Unsettled: no frozen money, so no owed amount is invented.
    expect(screen.queryByText(/owed$/)).toBeNull();
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

    // An unpaid player is an owing row with a Mark paid target.
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
      // Two owing rows, each with its frozen $15 beside Mark paid.
      expect(screen.getAllByTitle(/What they owe/).map((e) => e.textContent)).toEqual(['$15', '$15']);
      expect(byWholeText('$30 owed')).toBeTruthy();
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
      // The date is the stepper's; the hero says what each person owes.
      expect(screen.getByText('Per player')).toBeTruthy();
      expect(byWholeText('1 of 2 paid')).toBeTruthy();
      // Frozen money only: the owed sum is the unpaid rows' owedAmount.
      expect(byWholeText('$15 owed')).toBeTruthy();
      // Mei owes — her row leads with Mark paid. Daisy has paid — her row is
      // the dimmed button to her actions, after the owing ones.
      expect(screen.getByRole('button', { name: 'Mark Mei paid' })).toBeTruthy();
      const daisy = screen.getByRole('button', { name: 'More actions for Daisy (paid)' });
      expect(within(daisy).getByText('Paid')).toBeTruthy();
      const order = [...document.querySelectorAll('li')].map((li) => li.textContent ?? '');
      expect(order.findIndex((t) => t.includes('Mei'))).toBeLessThan(order.findIndex((t) => t.includes('Daisy')));
    });


    it('summary header: Share disabled + "—" when the session has no cost', async () => {
      // ACTIVE_SESSION is unsettled with no court/bird cost → no per-person amount.
      fetchPlayers([{ id: 'p1', name: 'Daisy', paid: false }]);
      render(<PaymentsCard />);
      await waitFor(() => expect(screen.getByText('Daisy')).toBeTruthy());
      const share = screen.getByRole('button', { name: 'Receipt' });
      expect((share as HTMLButtonElement).disabled).toBe(true);
      expect(screen.getByText('—')).toBeTruthy();
    });

    it('summary header: Share enabled but shows the recipient reason when none is set', async () => {
      // fetchSettledPlayers 404s /api/admin/settings → no recipient.
      fetchSettledPlayers([{ id: 'p1', name: 'Daisy', paid: true, owedAmount: 15 }]);
      render(<PaymentsCard />);
      await waitFor(() => expect(screen.getByText('Daisy')).toBeTruthy());
      const share = screen.getByRole('button', { name: 'Receipt' });
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
      fireEvent.click(screen.getByRole('button', { name: 'Receipt' }));
      await waitFor(() => expect(screen.getByText('Share session cost')).toBeTruthy());
    });

    it('the ⋯ Send receipt opens the individual receipt for the VIEWED session', async () => {
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
      // The individual receipt lives in the row's ⋯ actions now.
      fireEvent.click(screen.getByRole('button', { name: 'More actions for Mei' }));
      fireEvent.click(await screen.findByText('Send receipt'));
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
      expect(screen.queryAllByTitle(/What they owe/)).toHaveLength(0);
    });
  });

  // Today first (docs/plans/payments-today-first.md): one session at a time,
  // stepped with ‹ ›, and a date that opens a calendar of session days.
  describe('the session stepper and date picker', () => {
    const OLDER = { id: 'session-2026-05-06', datetime: '2026-05-06T20:00:00-04:00', maxPlayers: 12 };
    const OLDEST = { id: 'session-2026-03-04', datetime: '2026-03-04T20:00:00-05:00', maxPlayers: 12 };

    function fetchHistory(historyUrls: string[] = []) {
      urlFetch(async (url) => {
        if (url.includes('/api/sessions/history')) {
          historyUrls.push(url);
          return new Response(JSON.stringify({ sessions: [
            { sessionId: OLDER.id, attendanceCount: 4, unpaidCount: 0 },
            { sessionId: OLDEST.id, attendanceCount: 4, unpaidCount: 2 },
          ] }), { status: 200 });
        }
        if (url.includes('/api/session') && !url.includes('/sessions')) {
          return new Response(JSON.stringify(ACTIVE_SESSION), { status: 200 });
        }
        if (url.includes('/api/sessions')) {
          return new Response(JSON.stringify([OLDER, OLDEST]), { status: 200 });
        }
        if (url.includes('/api/players')) {
          const sid = new URL(url, 'http://x').searchParams.get('sessionId');
          const name = sid === OLDER.id ? 'Viktor' : 'Daisy';
          return new Response(JSON.stringify([{ id: `p-${sid}`, name, paid: false }]), { status: 200 });
        }
        return new Response('not found', { status: 404 });
      });
    }

    it('opens on the current session and steps back one at a time', async () => {
      fetchHistory();
      render(<PaymentsCard />);
      await waitFor(() => expect(screen.getByText('Daisy')).toBeTruthy());
      // The newest session: nothing later to step to.
      expect((screen.getByRole('button', { name: 'Later session' }) as HTMLButtonElement).disabled).toBe(true);
      fireEvent.click(screen.getByRole('button', { name: 'Earlier session' }));
      await waitFor(() => expect(screen.getByText('Viktor')).toBeTruthy());
      expect((screen.getByRole('button', { name: 'Later session' }) as HTMLButtonElement).disabled).toBe(false);
    });

    it("asks for every session's counts, not the newest 24", async () => {
      const urls: string[] = [];
      fetchHistory(urls);
      render(<PaymentsCard />);
      await waitFor(() => expect(urls.length).toBeGreaterThan(0));
      expect(urls[0]).toContain('counts=1');
    });

    it('marks each session day by its money and jumps to a picked one', async () => {
      fetchHistory();
      render(<PaymentsCard />);
      await waitFor(() => expect(screen.getByText('Daisy')).toBeTruthy());
      fireEvent.click(screen.getByRole('button', { name: /pick another session/ }));
      const dialog = await screen.findByRole('dialog', { name: 'Pick a session' });
      // May: the current session (viewed) and an all-paid one.
      const current = within(dialog).getByRole('button', { name: 'May 13, current session' });
      expect(current.getAttribute('aria-pressed')).toBe('true');
      expect(within(dialog).getByRole('button', { name: 'May 6, all paid' })).toBeTruthy();
      // March still owes: ‹ says so in May and in April, until it is reached.
      fireEvent.click(within(dialog).getByRole('button', { name: /Previous month, an earlier session still owes/ }));
      fireEvent.click(within(dialog).getByRole('button', { name: /Previous month, an earlier session still owes/ }));
      expect(within(dialog).getByText('March 2026')).toBeTruthy();
      expect((within(dialog).getByRole('button', { name: 'Previous month' }) as HTMLButtonElement).disabled).toBe(true);
      fireEvent.click(within(dialog).getByRole('button', { name: 'March 4, still owing' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect((screen.getByRole('button', { name: 'Later session' }) as HTMLButtonElement).disabled).toBe(false);
      expect((screen.getByRole('button', { name: 'Earlier session' }) as HTMLButtonElement).disabled).toBe(true);
    });
  });
});
