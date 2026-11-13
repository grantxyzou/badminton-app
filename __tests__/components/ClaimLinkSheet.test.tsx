// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import ClaimLinkSheet from '@/components/admin/CommandCenter/ClaimLinkSheet';

/**
 * Claim your name (docs/plans/claim-your-name.md): the organiser's link sheet.
 * Arriving through the link signs in first since step 4d of
 * docs/plans/one-way-in.md (`DoorJoinPage`).
 */
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function respond(body: unknown, status = 200) {
  return Promise.resolve({ ok: status < 400, status, json: async () => body } as unknown as Response);
}

describe('ClaimLinkSheet', () => {
  it('shows the link and who it is for', async () => {
    vi.stubGlobal('fetch', vi.fn(() => respond({ link: { token: 'a'.repeat(32), createdAt: '2026-11-04' }, unclaimed: 30 })));
    render(<ClaimLinkSheet open onClose={() => {}} clubName="Six Feathers" />);
    expect(await screen.findByText(/30 people on the roster haven’t signed in yet/)).toBeDefined();
    expect((screen.getByLabelText('The link') as HTMLInputElement).value).toContain(`/j/${'a'.repeat(32)}`);
  });

  it('offers to make one when the club has none', async () => {
    const fetchMock = vi.fn((_u: string, init?: { method?: string }) =>
      init?.method === 'POST'
        ? respond({ link: { token: 'b'.repeat(32), createdAt: '2026-11-04' } }, 201)
        : respond({ link: null, unclaimed: 2 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    render(<ClaimLinkSheet open onClose={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Make the club link' }));
    expect(await screen.findByLabelText('The link')).toBeDefined();
  });

  it('asks before a new link retires the old one', async () => {
    const fetchMock = vi.fn((_u: string, init?: { method?: string }) =>
      init?.method === 'POST'
        ? respond({ link: { token: 'c'.repeat(32), createdAt: '2026-11-05' } }, 201)
        : respond({ link: { token: 'a'.repeat(32), createdAt: '2026-11-04' }, unclaimed: 1 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    render(<ClaimLinkSheet open onClose={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: /New link/ }));
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Make a new link' }));
    await vi.waitFor(() =>
      expect((screen.getByLabelText('The link') as HTMLInputElement).value).toContain(`/j/${'c'.repeat(32)}`),
    );
  });
});
