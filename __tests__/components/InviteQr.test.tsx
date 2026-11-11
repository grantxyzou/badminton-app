// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import enMessages from '../../messages/en.json';
import InviteQr, { QR_POLL_MS } from '@/components/admin/CommandCenter/InviteQr';
import { qrPath } from '@/lib/qr';
import { inviteUrl, type Invite } from '@/lib/useInvites';

/**
 * The invite's QR on the Invite page (Task 1.3): the invite the card shows,
 * drawn for a camera, and a watch that tells the card once it has been used.
 */
const A: Invite = { id: 'inv-a', token: 'a'.repeat(32), code: 'AAAABBBB', createdAt: '2026-11-05T00:00:00Z', expiresAt: '2026-11-12T00:00:00Z' };

function respond(body: unknown, status = 200) {
  return Promise.resolve({ ok: status < 400, status, json: async () => body } as unknown as Response);
}

function mount(onUsed = vi.fn()) {
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <InviteQr invite={A} onUsed={onUsed} />
    </NextIntlClientProvider>,
  );
  return onUsed;
}

async function tick() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(QR_POLL_MS);
  });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('InviteQr', () => {
  it('draws the invite’s own one link', () => {
    vi.stubGlobal('fetch', vi.fn(() => respond({ invites: [A] })));
    mount();
    const d = screen.getByRole('img', { name: 'QR code for the invite link' }).querySelector('path')!.getAttribute('d');
    expect(d).toBe(qrPath(inviteUrl(A.token)).d);
    expect(inviteUrl(A.token)).toContain(`/j/${A.token}`);
  });

  it('says nothing while the invite is still waiting', async () => {
    vi.stubGlobal('fetch', vi.fn(() => respond({ invites: [A] })));
    const onUsed = mount();
    await tick();
    await tick();
    expect(onUsed).not.toHaveBeenCalled();
  });

  it('a failed check is skipped, never read as used', async () => {
    vi.stubGlobal('fetch', vi.fn(() => respond({ error: 'read_failed' }, 503)));
    const onUsed = mount();
    await tick();
    expect(onUsed).not.toHaveBeenCalled();
  });

  it('tells the card once, when the invite leaves the list', async () => {
    vi.stubGlobal('fetch', vi.fn(() => respond({ invites: [] })));
    const onUsed = mount();
    await tick();
    await tick();
    expect(onUsed).toHaveBeenCalledTimes(1);
    expect(onUsed).toHaveBeenCalledWith('inv-a');
  });

  it('stops asking once it is gone from the page', async () => {
    const fetchMock = vi.fn(() => respond({ invites: [A] }));
    vi.stubGlobal('fetch', fetchMock);
    mount();
    cleanup();
    await tick();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
