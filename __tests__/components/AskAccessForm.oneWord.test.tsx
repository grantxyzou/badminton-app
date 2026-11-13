// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import enMessages from '@/messages/en.json';
import AskAccessForm from '@/components/auth/AskAccessForm';

/**
 * docs/plans/one-way-in.md, step 1.
 *
 * The door asks a NEW person for a first and last name, but an imported roster
 * name can be one word ("Lin"), and the server claims an unclaimed roster name
 * exactly as written. The form used to refuse a one-word name outright, so an
 * imported Lin could never claim her spot through the club's link. Now a
 * one-word name is a hint the first time and goes on the second tap.
 *
 * And "That request expired" was shown for three different things: an ask
 * that ran out, one an organiser ignored, and one under a name nothing was
 * stored for. The server answers all three the same on purpose (no name
 * oracle), so the words must be true of all three.
 */

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function stubFetch(claimStatus: 'pending' | 'none' = 'pending') {
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

function renderDoor() {
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <AskAccessForm claim={{ token: 'door-token', clubName: 'BPM Core' }} onApproved={vi.fn()} />
    </NextIntlClientProvider>,
  );
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'lin@example.com' } });
}

describe('AskAccessForm — a one-word name at the door', () => {
  it('hints first, then sends the same name on the second tap', async () => {
    const asks = stubFetch();
    renderDoor();
    fireEvent.change(screen.getByLabelText('First and last name'), { target: { value: 'Lin' } });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Ask to join' }));
    });
    expect(asks).toHaveLength(0);
    expect(screen.getByText(/If the club already knows you by one name/)).toBeDefined();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Ask to join' }));
    });
    expect(asks).toHaveLength(1);
    expect(asks[0]).toMatchObject({ name: 'Lin' });
  });

  it('hints again when the one-word name changes', async () => {
    const asks = stubFetch();
    renderDoor();
    const field = screen.getByLabelText('First and last name');
    fireEvent.change(field, { target: { value: 'Lin' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Ask to join' }));
    });
    fireEvent.change(field, { target: { value: 'Viktor' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Ask to join' }));
    });
    expect(asks).toHaveLength(0);
  });

  it('sends a first and last name on the first tap, with no hint', async () => {
    const asks = stubFetch();
    renderDoor();
    fireEvent.change(screen.getByLabelText('First and last name'), { target: { value: 'Lin Dan' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Ask to join' }));
    });
    expect(asks).toHaveLength(1);
    expect(screen.queryByText(/If the club already knows you by one name/)).toBeNull();
  });
});

describe('AskAccessForm — when no request is open', () => {
  // `none` now comes only when the hour is up or the link was replaced (step
  // 4c): a made-up name and an ignored ask read `pending` until then.
  it('`none` says the hour ran out, not that the name is unknown', async () => {
    vi.useFakeTimers();
    stubFetch('none');
    renderDoor();
    fireEvent.change(screen.getByLabelText('First and last name'), { target: { value: 'Lin Dan' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Ask to join' }));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_100);
    });
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toMatch(/the request ran out/);
    expect(alert.textContent).not.toMatch(/that name/);
  });
});
