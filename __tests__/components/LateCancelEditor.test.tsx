// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import LateCancelEditor from '@/components/admin/CommandCenter/LateCancelEditor';

/**
 * The admin's late-cancellation setting (docs/plans/late-cancel-fee.md).
 * A failed load must never render as "off" — the next tap would overwrite the
 * club's real window — and a refused save is said in words, then rolled back.
 */

let stored: number | null;
let fetchMock: ReturnType<typeof vi.fn>;

function ok(body: unknown, status = 200) {
  return { ok: status < 300, status, json: async () => body } as Response;
}
const patches = () =>
  fetchMock.mock.calls
    .filter(([, init]) => (init as RequestInit | undefined)?.method === 'PATCH')
    .map(([, init]) => JSON.parse(String((init as RequestInit).body)) as Record<string, unknown>);

beforeEach(() => {
  stored = null;
  fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === 'PATCH') {
      stored = (JSON.parse(String(init.body)) as { lateCancelHours: number | null }).lateCancelHours;
      return ok({});
    }
    return ok({ eTransferRecipient: null, skipDates: [], lateCancelHours: stored });
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('LateCancelEditor', () => {
  it('loads off, and switching on saves 48 hours and shows the window choice', async () => {
    render(<LateCancelEditor />);
    const toggle = await screen.findByRole('switch', { name: 'Warn about late cancellations' });
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    expect(screen.queryByRole('radiogroup')).toBeNull();

    fireEvent.click(toggle);
    await waitFor(() => expect(patches()).toEqual([{ lateCancelHours: 48 }]));
    expect(await screen.findByText('On · 48 hours before the session')).toBeDefined();
    expect(screen.getByRole('radio', { name: '48 hours' }).getAttribute('aria-checked')).toBe('true');
  });

  it('choosing another window saves it; switching off saves null', async () => {
    stored = 48;
    render(<LateCancelEditor />);
    fireEvent.click(await screen.findByRole('radio', { name: '24 hours' }));
    await waitFor(() => expect(patches()).toEqual([{ lateCancelHours: 24 }]));

    fireEvent.click(screen.getByRole('switch', { name: 'Warn about late cancellations' }));
    await waitFor(() => expect(patches()).toEqual([{ lateCancelHours: 24 }, { lateCancelHours: null }]));
    expect(await screen.findByText('Off')).toBeDefined();
  });

  it('a failed load shows the error card, never an "off" switch that could overwrite the real window', async () => {
    fetchMock.mockImplementation(async () => ok({ error: 'read_failed' }, 503));
    render(<LateCancelEditor />);
    expect(await screen.findByText(/Couldn.t load the setting/)).toBeDefined();
    expect(screen.queryByRole('switch')).toBeNull();
  });

  it('says why a save was refused when the club has no settings record', async () => {
    fetchMock.mockImplementation(async (_input: RequestInfo | URL, init?: RequestInit) =>
      init?.method === 'PATCH' ? ok({ error: 'no_group' }, 409) : ok({ lateCancelHours: null }));
    render(<LateCancelEditor />);
    fireEvent.click(await screen.findByRole('switch', { name: 'Warn about late cancellations' }));
    expect(await screen.findByText(/no settings record yet/)).toBeDefined();
    expect(screen.getByRole('switch', { name: 'Warn about late cancellations' }).getAttribute('aria-checked')).toBe('false');
  });
});
