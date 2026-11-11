// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import enMessages from '@/messages/en.json';
import AskAccessForm from '@/components/auth/AskAccessForm';

/**
 * Spec Q3 (Grant, 2026-11-11: "Q3 yes"): the email typed at the club's door
 * becomes the new member's contact email — sent once the club has let them in,
 * never with the ask itself.
 */

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('AskAccessForm — the door email', () => {
  it('keeps the email off the ask, then saves it as the contact email once approved', async () => {
    vi.useFakeTimers();
    const calls: Array<{ url: string; method: string; body: Record<string, unknown> }> = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : {} });
      if (url.endsWith('/api/members/access-request')) return json({ secret: 's3cret' });
      if (url.endsWith('/api/members/access-request/claim')) return json({ status: 'approved', name: 'Akane Yamaguchi', hasPin: false });
      if (url.endsWith('/api/members/me')) return json({ success: true, contactEmail: 'akane@example.com' });
      return json({});
    }));
    const onApproved = vi.fn();
    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <AskAccessForm claim={{ token: 'door-token', clubName: 'BPM Core' }} onApproved={onApproved} />
      </NextIntlClientProvider>,
    );
    fireEvent.change(screen.getByLabelText('First and last name'), { target: { value: 'Akane Yamaguchi' } });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: ' akane@example.com ' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Ask to join' }));
    });

    const ask = calls.find((c) => c.url.endsWith('/api/members/access-request'));
    expect(ask?.body).not.toHaveProperty('email');
    expect(JSON.stringify(ask?.body)).not.toContain('akane@example.com');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_100);
    });

    const save = calls.find((c) => c.url.endsWith('/api/members/me'));
    expect(save).toMatchObject({ method: 'PATCH', body: { name: 'Akane Yamaguchi', contactEmail: 'akane@example.com' } });
    expect(onApproved).toHaveBeenCalledWith({ name: 'Akane Yamaguchi', hasPin: false, email: 'akane@example.com' });
  });
});
