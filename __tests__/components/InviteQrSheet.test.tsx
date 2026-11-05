// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import enMessages from '../../messages/en.json';
import InviteQrSheet, { QR_POLL_MS } from '@/components/admin/CommandCenter/InviteQrSheet';
import { qrPath } from '@/lib/qr';
import { inviteUrl, type Invite } from '@/lib/useInvites';

/**
 * "Show as QR" (Task 1.3): the invite the card shows, drawn for a camera; the
 * sheet notices when it is used and offers the next one.
 */
const A: Invite = { id: 'inv-a', token: 'a'.repeat(32), code: 'AAAABBBB', createdAt: '2026-11-05T00:00:00Z', expiresAt: '2026-11-12T00:00:00Z' };
const B: Invite = { id: 'inv-b', token: 'b'.repeat(32), code: 'CCCCDDDD', createdAt: '2026-11-05T00:01:00Z', expiresAt: '2026-11-12T00:01:00Z' };

function respond(body: unknown, status = 200) {
  return Promise.resolve({ ok: status < 400, status, json: async () => body } as unknown as Response);
}

function mount(props: Partial<React.ComponentProps<typeof InviteQrSheet>> = {}) {
  const onNext = props.onNext ?? vi.fn(async () => B);
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <InviteQrSheet open onClose={() => {}} invite={A} groupName="BPM Core" onNext={onNext} {...props} />
    </NextIntlClientProvider>,
  );
  return { onNext };
}

function drawnPath(): string {
  return screen.getByRole('img', { name: 'QR code for the invite link' }).querySelector('path')!.getAttribute('d')!;
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

describe('InviteQrSheet', () => {
  it('draws the invite’s own one link, with the club and the code', () => {
    vi.stubGlobal('fetch', vi.fn(() => respond({ invites: [A] })));
    mount();
    expect(drawnPath()).toBe(qrPath(inviteUrl(A.token)).d);
    expect(inviteUrl(A.token)).toContain(`/j/${A.token}`);
    expect(screen.getByText('Scan to join BPM Core')).toBeDefined();
    expect(screen.getByText('AAAA BBBB')).toBeDefined();
  });

  it('keeps showing the code while the invite is still waiting', async () => {
    vi.stubGlobal('fetch', vi.fn(() => respond({ invites: [A] })));
    mount();
    await tick();
    await tick();
    expect(screen.getByRole('img', { name: 'QR code for the invite link' })).toBeDefined();
    expect(screen.queryByText("That invite has been used. They're in.")).toBeNull();
  });

  it('a failed check is skipped, never read as used', async () => {
    vi.stubGlobal('fetch', vi.fn(() => respond({ error: 'read_failed' }, 503)));
    mount();
    await tick();
    expect(screen.getByRole('img', { name: 'QR code for the invite link' })).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Next person' })).toBeNull();
  });

  it('when the invite leaves the list, it stops showing a dead code and offers the next', async () => {
    vi.stubGlobal('fetch', vi.fn(() => respond({ invites: [] })));
    const { onNext } = mount();
    await tick();
    expect(screen.getByText("That invite has been used. They're in.")).toBeDefined();
    expect(screen.queryByRole('img', { name: 'QR code for the invite link' })).toBeNull();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Next person' }));
    });
    expect(onNext).toHaveBeenCalledTimes(1);
    expect(drawnPath()).toBe(qrPath(inviteUrl(B.token)).d);
    expect(screen.getByText('CCCC DDDD')).toBeDefined();
  });

  it('says so when the next invite could not be made', async () => {
    vi.stubGlobal('fetch', vi.fn(() => respond({ invites: [] })));
    mount({ onNext: vi.fn(async () => null) });
    await tick();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Next person' }));
    });
    expect(screen.getByRole('alert').textContent).toBe("Couldn't make the next invite. Try again.");
  });

  it('stops asking once closed', async () => {
    const fetchMock = vi.fn(() => respond({ invites: [A] }));
    vi.stubGlobal('fetch', fetchMock);
    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <InviteQrSheet open={false} onClose={() => {}} invite={A} onNext={vi.fn()} />
      </NextIntlClientProvider>,
    );
    await tick();
    await tick();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
