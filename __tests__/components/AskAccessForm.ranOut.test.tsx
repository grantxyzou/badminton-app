// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import enMessages from '@/messages/en.json';
import AskAccessForm from '@/components/auth/AskAccessForm';

/**
 * "I play here already" (docs/plans/one-way-in.md, steps 1 and 4c).
 *
 * The poll answers `pending` for every name inside the ask's hour, a made-up
 * one and an ignored ask included, so `none` means one thing: the hour ran
 * out. The words must say that, and never that the name is unknown.
 */

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function stubFetch(claimStatus: 'pending' | 'none') {
  const asks: Array<Record<string, unknown>> = [];
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith('/api/members/access-request')) {
      asks.push(init?.body ? JSON.parse(String(init.body)) : {});
      return json({ secret: 's3cret' });
    }
    if (url.endsWith('/api/members/access-request/claim')) return json({ status: claimStatus });
    return json({});
  }));
  return asks;
}

async function askAs(name: string) {
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <AskAccessForm onApproved={vi.fn()} />
    </NextIntlClientProvider>,
  );
  fireEvent.change(screen.getByLabelText('Your name'), { target: { value: name } });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Ask to be let in' }));
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(3_100);
  });
}

describe('AskAccessForm — the answer', () => {
  it('waits with the same words for any name, and sends no club link', async () => {
    vi.useFakeTimers();
    const asks = stubFetch('pending');
    await askAs('Lin');
    expect(screen.getByRole('status').textContent).toMatch(/If the club knows that name/);
    expect(asks).toEqual([{ name: 'Lin' }]);
  });

  it('`none` says the hour ran out, not that the name is unknown', async () => {
    vi.useFakeTimers();
    stubFetch('none');
    await askAs('Lin Dan');
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toMatch(/the request ran out/);
    expect(alert.textContent).not.toMatch(/that name/);
  });
});
