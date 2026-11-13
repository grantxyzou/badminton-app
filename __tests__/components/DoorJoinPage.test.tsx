// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import enMessages from '@/messages/en.json';

/**
 * Joining a club through its link, signed out (docs/plans/one-way-in.md,
 * step 4a): sign in first, then the name, then the ask. Three ways through,
 * and the identity is written only when they leave the "asked" screen.
 */
const identities: Array<{ name: string }> = [];
vi.mock('@/lib/identity', () => ({ setIdentity: (v: { name: string }) => identities.push(v) }));
const resumes: Array<[string, string | undefined]> = [];
vi.mock('@/lib/onboardingResume', () => ({
  markOnboardingResume: (intent: string, token?: string) => resumes.push([intent, token]),
}));
vi.mock('@/components/auth/ProviderButtons', () => ({
  default: ({ onLeave }: { onLeave?: () => void }) => (
    <button type="button" onClick={onLeave}>
      Continue with Google
    </button>
  ),
}));

import DoorJoinPage from '@/components/onboarding/DoorJoinPage';

const TOKEN = 'd4'.repeat(16);

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  identities.length = 0;
  resumes.length = 0;
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function stub(routes: Record<string, () => Response>) {
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : {} });
    if (url.includes('/api/groups/preview')) return json({ name: 'Six Feathers', kind: 'door' });
    for (const [path, answer] of Object.entries(routes)) if (url.includes(path)) return answer();
    return json({});
  }));
  return calls;
}

function renderPage(onClaimName = vi.fn()) {
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <DoorJoinPage token={TOKEN} authProviders={['google']} onBack={vi.fn()} onClaimName={onClaimName} />
    </NextIntlClientProvider>,
  );
  return { onClaimName };
}

async function proveEmail(email: string) {
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: email } });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Email me a code' }));
  });
  fireEvent.change(screen.getByLabelText('6-digit code'), { target: { value: '123456' } });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Log in' }));
  });
}

describe('DoorJoinPage', () => {
  it('names the club, offers Google and an email code, and no password', async () => {
    stub({});
    renderPage();
    expect(await screen.findByText('Join Six Feathers')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Email me a code' })).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Use my password instead' })).toBeNull();
  });

  it('carries the link through Google as the resume', async () => {
    stub({});
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Continue with Google' }));
    expect(resumes).toEqual([['join', TOKEN]]);
  });

  it('a NEW address: code, then the name, then the account asks; Done signs in', async () => {
    const calls = stub({
      '/email-code/start': () => json({ ok: true }),
      '/email-code/verify': () => json({ signup: true }),
      '/auth/complete-signup': () => json({ name: 'Kento Momota', asked: { club: 'Six Feathers' } }, 201),
    });
    renderPage();
    await screen.findByText('Join Six Feathers');
    await proveEmail('kento@example.com');
    expect(calls.find((c) => c.url.includes('/email-code/start'))!.body).toEqual({ email: 'kento@example.com', doorToken: TOKEN });

    fireEvent.change(screen.getByLabelText('Your name on the list'), { target: { value: 'Kento Momota' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Ask to join' }));
    });
    expect(calls.find((c) => c.url.includes('/auth/complete-signup'))!.body).toEqual({ name: 'Kento Momota', inviteToken: TOKEN });
    expect(screen.getByText('Asked to join Six Feathers')).toBeDefined();
    expect(identities).toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(identities).toEqual([{ name: 'Kento Momota', sessionId: '' }]);
  });

  it('a one-word name is a hint first, then goes', async () => {
    const calls = stub({
      '/email-code/start': () => json({ ok: true }),
      '/email-code/verify': () => json({ signup: true }),
      '/auth/complete-signup': () => json({ name: 'Kento' }, 201),
    });
    renderPage();
    await screen.findByText('Join Six Feathers');
    await proveEmail('kento@example.com');
    fireEvent.change(screen.getByLabelText('Your name on the list'), { target: { value: 'Kento' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Ask to join' }));
    });
    expect(calls.some((c) => c.url.includes('/auth/complete-signup'))).toBe(false);
    expect(screen.getByText(/If the club knows you by one name/)).toBeDefined();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Ask to join' }));
    });
    expect(calls.some((c) => c.url.includes('/auth/complete-signup'))).toBe(true);
  });

  it('an address that HAS an account: signed in by the code, then asks as itself', async () => {
    const calls = stub({
      '/email-code/start': () => json({ ok: true }),
      '/email-code/verify': () => json({ name: 'Lin' }),
      '/api/groups/ask': () => json({ ok: true, groupId: 'club-x', club: 'Six Feathers' }),
    });
    renderPage();
    await screen.findByText('Join Six Feathers');
    await proveEmail('lin@example.com');
    expect(calls.find((c) => c.url.includes('/api/groups/ask'))!.body).toEqual({ doorToken: TOKEN, name: 'Lin' });
    expect(screen.getByText('Asked to join Six Feathers')).toBeDefined();
  });

  it('keeps the name-only claim reachable for imported names (until step 4b)', async () => {
    stub({});
    const { onClaimName } = renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /Claim your name/ }));
    expect(onClaimName).toHaveBeenCalled();
  });

  it('a dead link says so', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ error: 'invite_not_found' }, 404)));
    renderPage();
    expect((await screen.findByRole('alert')).textContent).toMatch(/That link no longer works/);
  });
});
