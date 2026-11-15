// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import enMessages from '@/messages/en.json';
import WaitingAsks, { type Ask } from '@/components/onboarding/WaitingAsks';

/**
 * "Waiting for {club}" (docs/plans/one-way-in.md, step 4a): checks back while
 * open and moves into the club once an organiser lets them in.
 */

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const WAITING: Ask = { groupId: 'club-x', club: 'Six Feathers', name: 'Kento Momota', state: 'waiting' };

function renderAsks(asks: Ask[], onIn = vi.fn()) {
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <WaitingAsks asks={asks} onIn={onIn} />
    </NextIntlClientProvider>,
  );
  return onIn;
}

describe('WaitingAsks', () => {
  it('says who is waiting for which club', () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ asks: [WAITING] })));
    renderAsks([WAITING]);
    expect(screen.getByText('Waiting for Six Feathers')).toBeDefined();
    expect(screen.getByText(/You asked to join as Kento Momota/)).toBeDefined();
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

  it('says plainly when an ask was not let in', () => {
    renderAsks([{ ...WAITING, state: 'closed' }]);
    expect(screen.getByText("Six Feathers didn't let you in this time")).toBeDefined();
  });
});
