// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import enMessages from '@/messages/en.json';

const toasts: Array<{ title: string }> = [];
vi.mock('@/lib/topToast', () => ({ showTopToast: (t: { title: string }) => toasts.push(t) }));

import NewPhonePrompt from '@/components/auth/NewPhonePrompt';

/**
 * "Someone is signing in as you on a new phone. Is this you?"
 * (docs/plans/sign-in-redesign.md, step 3). The signed-in phone shows how the
 * new one signed in and three numbers; tapping the one it shows lets it in.
 */

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const ASK = { id: 'ask-1', provider: 'google', email: 'lin.new@example.com', choices: [12, 47, 83] };

function stub(answer: unknown) {
  const posts: unknown[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST') {
        posts.push(JSON.parse(String(init.body)));
        return json(answer);
      }
      // The ask is there until it is answered.
      return json({ asks: posts.length === 0 ? [ASK] : [] });
    }),
  );
  return posts;
}

async function renderPrompt() {
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <NewPhonePrompt />
    </NextIntlClientProvider>,
  );
  await act(async () => {});
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  toasts.length = 0;
});

describe('NewPhonePrompt', () => {
  it('asks "Is this you?", says how the new phone signed in, and offers three numbers', async () => {
    stub({ ok: true, outcome: 'approved' });
    await renderPrompt();
    expect(screen.getByText('Someone is signing in as you on a new phone.')).toBeDefined();
    expect(screen.getByText(/Signed in with Google · lin\.new@example\.com/)).toBeDefined();
    expect(screen.getAllByRole('button', { name: /^Tap \d+$/ }).map((b) => b.textContent)).toEqual(['12', '47', '83']);
  });

  it('tapping a number answers with it, and says the new phone is in', async () => {
    const posts = stub({ ok: true, outcome: 'approved' });
    await renderPrompt();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Tap 47' }));
    });
    expect(posts).toEqual([{ id: 'ask-1', pick: 47 }]);
    expect(toasts.map((t) => t.title)).toEqual(['Your new phone is signed in']);
  });

  it('"No, it\'s not me" stops it', async () => {
    const posts = stub({ ok: true, outcome: 'stopped' });
    await renderPrompt();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: "No, it's not me" }));
    });
    expect(posts).toEqual([{ id: 'ask-1', notMe: true }]);
    expect(toasts.map((t) => t.title)).toEqual(['That sign-in was stopped']);
  });

  it('shows nothing when no phone is asking, or the read fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ error: 'read_failed' }, 503)));
    await renderPrompt();
    expect(screen.queryByText('Is this you?')).toBeNull();
  });
});
