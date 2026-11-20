// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import enMessages from '@/messages/en.json';
import WaitingAsks, { type Ask } from '@/components/onboarding/WaitingAsks';

/**
 * The one waiting page (docs/plans/one-way-in.md, step 4a;
 * docs/plans/sign-in-redesign.md): "Request sent" straight after asking,
 * "still pending" after, "Not this time" once closed. Checks back while open
 * and moves into the club once an organizer lets them in.
 */

afterEach(() => {
  cleanup();
  sessionStorage.clear();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const WAITING: Ask = { groupId: 'club-x', club: 'Six Feathers', name: 'Kento Momota', state: 'waiting' };

function renderAsks(asks: Ask[], onIn = vi.fn(), onJoin = vi.fn(), onSignOut = vi.fn()) {
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <WaitingAsks asks={asks} onIn={onIn} onJoin={onJoin} onSignOut={onSignOut} />
    </NextIntlClientProvider>,
  );
  return onIn;
}

describe('WaitingAsks', () => {
  it('says the request is still pending, for how long, and offers another club', () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ asks: [WAITING] })));
    renderAsks([WAITING]);
    expect(screen.getByRole('heading', { name: 'Your request is still pending' })).toBeDefined();
    expect(screen.getByText('Requests stay open for 3 days.')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Join another club' })).toBeDefined();
    // Drawn greyed out (the canvas, 2026-11-19).
    expect((screen.getByRole('button', { name: 'Start your own club' }) as HTMLButtonElement).disabled).toBe(true);    // No Profile tab in no club: this page is the only way to sign out.
    expect(screen.getByRole('button', { name: 'Use a different account' })).toBeDefined();
  });

  it('once let in, moves the cookie to the club and goes in', async () => {
    vi.useFakeTimers();
    const calls: Array<{ url: string; body?: string }> = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), body: init?.body ? String(init.body) : undefined });
      if (String(input).includes('/api/groups/ask')) return json({ asks: [{ ...WAITING, state: 'in' }] });
      return json({ ok: true });
    }));
    const onIn = renderAsks([WAITING]);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_100);
    });
    const sw = calls.find((c) => c.url.includes('/api/groups/switch'));
    expect(JSON.parse(sw!.body!)).toEqual({ groupId: 'club-x' });
    expect(onIn).toHaveBeenCalled();
  });

  it('says plainly when an ask was not let in, and offers another club', () => {
    renderAsks([{ ...WAITING, state: 'closed' }]);
    expect(screen.getByRole('heading', { name: 'Not this time' })).toBeDefined();
    expect(screen.getByText(/couldn't let you in this time/)).toBeDefined();
    expect(screen.getByRole('button', { name: 'Join another club' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Use a different account' })).toBeDefined();
  });

  it('says "Request sent", step 3 of 3, straight after asking', async () => {
    vi.resetModules();
    const { markJustAsked } = await import('@/lib/justAsked');
    markJustAsked('Six Feathers');
    const { default: Fresh } = await import('@/components/onboarding/WaitingAsks');
    vi.stubGlobal('fetch', vi.fn(async () => json({ asks: [WAITING] })));
    const onSignOut = vi.fn();
    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <Fresh asks={[WAITING]} onIn={vi.fn()} onJoin={vi.fn()} onSignOut={onSignOut} />
      </NextIntlClientProvider>,
    );
    expect(screen.getByRole('heading', { name: 'Request sent' })).toBeDefined();
    expect(screen.getByRole('img', { name: 'Step 3 of 3' })).toBeDefined();
    screen.getByRole('button', { name: 'Use a different account' }).click();
    expect(onSignOut).toHaveBeenCalled();
  });
});
