// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import enMessages from '@/messages/en.json';

/**
 * The migration link asks before it signs the app in (audit, 2026-11-05). A
 * link is minted by whoever is signed in on the web, so one sent to someone
 * else used to sign THEIR app in as the sender the moment it opened.
 */
async function mount() {
  vi.resetModules(); // the page caches the code per module load
  const { default: MigrateClaim } = await import('@/components/MigrateClaim');
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <MigrateClaim />
    </NextIntlClientProvider>,
  );
}

const m = enMessages.profile.migrate;

beforeEach(() => {
  window.history.replaceState(null, '', '/migrate?c=abc123');
  (window as unknown as { Capacitor?: unknown }).Capacitor = { isNativePlatform: () => true };
  localStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  delete (window as unknown as { Capacitor?: unknown }).Capacitor;
});

describe('MigrateClaim', () => {
  it('asks first and claims nothing until the tap', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await mount();
    expect(await screen.findByText(m.pageConfirm)).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
    // The credential is gone from the address bar before anything is tapped.
    expect(window.location.search).toBe('');
  });

  it('claims the code once the person taps, and only once', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false });
    vi.stubGlobal('fetch', fetchMock);
    await mount();
    const button = await screen.findByRole('button', { name: m.pageConfirmCta });
    fireEvent.click(button);
    fireEvent.click(button);
    await waitFor(() => expect(screen.getByText(m.pageFailed)).toBeTruthy());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ link: 'abc123' });
  });

  it('names whoever is signed in here now, who would be signed out', async () => {
    vi.stubGlobal('fetch', vi.fn());
    localStorage.setItem('badminton_identity', JSON.stringify({ name: 'Lin' }));
    await mount();
    expect(await screen.findByText(m.pageReplaces.replace('{name}', 'Lin'))).toBeTruthy();
  });
});
