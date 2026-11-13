// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import enMessages from '../../messages/en.json';
import ClaimLinkSheet from '@/components/admin/CommandCenter/ClaimLinkSheet';
import AskAccessSheet from '@/components/AskAccessSheet';

/**
 * Claim your name (docs/plans/claim-your-name.md): the organiser's link sheet,
 * and the person's ask sheet when they arrive through the link.
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

describe('AskAccessSheet through a claim link', () => {
  it('names the club and sends the link with the ask', async () => {
    const fetchMock = vi.fn(() => respond({ ok: true, secret: 's'.repeat(64) }));
    vi.stubGlobal('fetch', fetchMock);
    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <AskAccessSheet
          open
          onClose={() => {}}
          sessionId=""
          onSignedIn={() => {}}
          claim={{ token: 'a'.repeat(32), clubName: 'Six Feathers' }}
        />
      </NextIntlClientProvider>,
    );
    expect(screen.getByText('Join Six Feathers')).toBeDefined();
    fireEvent.change(screen.getByLabelText('First and last name'), { target: { value: 'Lin Dan' } });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'lin@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ask to join' }));
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, { body: string }];
    // The email stays on the phone until the person saves a password with it.
    expect(JSON.parse(init.body)).toEqual({ name: 'Lin Dan', claimToken: 'a'.repeat(32) });
  });

  it('asks a new person for a first and last name and an email, and sends nothing without them', async () => {
    const fetchMock = vi.fn(() => respond({ ok: true, secret: 's'.repeat(64) }));
    vi.stubGlobal('fetch', fetchMock);
    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <AskAccessSheet open onClose={() => {}} sessionId="" onSignedIn={() => {}} claim={{ token: 'a'.repeat(32), clubName: 'BPM Core' }} />
      </NextIntlClientProvider>,
    );
    expect(screen.getByText("Hey, glad you're here! What's your name and email?")).toBeDefined();
    expect(screen.getByText("Don't worry, we don't have the bandwidth to send you junk mail.")).toBeDefined();
    fireEvent.change(screen.getByLabelText('First and last name'), { target: { value: 'Sandra' } });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'not-an-email' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ask to join' }));
    // A one-word name is a hint, not a wall (docs/plans/one-way-in.md): an
    // imported roster name can be one word, and only the server knows.
    expect(screen.getByText(/^Add your last name too\./)).toBeDefined();
    expect(screen.getByText("That email doesn't look right.")).toBeDefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('hands the email on once the organiser lets them in', async () => {
    const fetchMock = vi.fn((url: string) =>
      url.includes('/claim')
        ? respond({ status: 'approved', name: 'Sandra Lee', hasPin: false })
        : respond({ ok: true, secret: 's'.repeat(64) }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const onSignedIn = vi.fn();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      render(
        <NextIntlClientProvider locale="en" messages={enMessages}>
          <AskAccessSheet open onClose={() => {}} sessionId="" onSignedIn={onSignedIn} claim={{ token: 'a'.repeat(32), clubName: 'BPM Core' }} />
        </NextIntlClientProvider>,
      );
      fireEvent.change(screen.getByLabelText('First and last name'), { target: { value: 'Sandra Lee' } });
      fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'sandra@example.com' } });
      fireEvent.click(screen.getByRole('button', { name: 'Ask to join' }));
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      await vi.advanceTimersByTimeAsync(3_100);
      await vi.waitFor(() => expect(onSignedIn).toHaveBeenCalled());
      expect(onSignedIn).toHaveBeenCalledWith({ name: 'Sandra Lee', hasPin: false, email: 'sandra@example.com' });
    } finally {
      vi.useRealTimers();
    }
  });
});
