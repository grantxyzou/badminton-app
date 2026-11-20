// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import enMessages from '@/messages/en.json';

/**
 * Joining a club through its link, signed out (docs/plans/one-way-in.md,
 * step 4a; drawn in docs/plans/sign-in-redesign.md): sign in first ("Check
 * your email", step 1 of 3), then "What's your name?" (step 2), then the ask.
 * Asking signs the phone in, which reloads into the waiting page, so the
 * identity is written the moment the ask lands, with "Request sent" marked.
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
  sessionStorage.clear();
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

function renderPage() {
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <DoorJoinPage token={TOKEN} authProviders={['google']} onBack={vi.fn()} />
    </NextIntlClientProvider>,
  );
}

async function proveEmail(email: string) {
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: email } });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Email me a code' }));
  });
  // A club's link sends every address a code, so the page says so plainly.
  expect(screen.getByRole('heading', { name: 'Check your email' })).toBeDefined();
  expect(screen.getByRole('img', { name: 'Step 1 of 3' })).toBeDefined();
  expect(screen.getByRole('status').textContent).toBe(`We emailed a verification code to ${email}.`);
  fireEvent.change(screen.getByLabelText('6-digit code'), { target: { value: '123456' } });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
  });
}

const justAsked = () => sessionStorage.getItem('badminton_just_asked');

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

  it('a NEW address: code, then the name, then the account asks and signs in', async () => {
    const calls = stub({
      '/email-code/start': () => json({ ok: true }),
      '/email-code/verify': () => json({ signup: true }),
      '/auth/complete-signup': () => json({ name: 'Kento Momota', asked: { club: 'Six Feathers' } }, 201),
    });
    renderPage();
    await screen.findByText('Join Six Feathers');
    await proveEmail('kento@example.com');
    expect(calls.find((c) => c.url.includes('/email-code/start'))!.body).toEqual({ email: 'kento@example.com', doorToken: TOKEN });

    expect(screen.getByRole('heading', { name: "What's your name?" })).toBeDefined();
    expect(screen.getByRole('img', { name: 'Step 2 of 3' })).toBeDefined();
    fireEvent.change(screen.getByLabelText('Your name'), { target: { value: 'Kento Momota' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Ask to join' }));
    });
    expect(calls.find((c) => c.url.includes('/auth/complete-signup'))!.body).toEqual({ name: 'Kento Momota', inviteToken: TOKEN });
    // Signed in, which reloads into the waiting page, told to say "Request sent".
    expect(identities).toEqual([{ name: 'Kento Momota', sessionId: '' }]);
    expect(JSON.parse(justAsked()!).club).toBe('Six Feathers');
  });

  it('a name someone signs in under asks "Is that you?", and the PIN signs straight in (step 6)', async () => {
    const calls = stub({
      '/email-code/start': () => json({ ok: true }),
      '/email-code/verify': () => json({ signup: true }),
      '/auth/complete-signup': () => json({ error: 'name_taken' }, 409),
      '/auth/claim-name': () => json({ ok: true, name: 'Lin Dan' }),
    });
    renderPage();
    await screen.findByText('Join Six Feathers');
    await proveEmail('lin@example.com');
    fireEvent.change(screen.getByLabelText('Your name'), { target: { value: 'Lin Dan' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Ask to join' }));
    });
    expect(screen.getByText('Is that you?')).toBeDefined();
    expect(screen.getByRole('heading', { name: 'Lin Dan already plays at Six Feathers' })).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: 'Enter my PIN' }));
    fireEvent.change(screen.getByLabelText('PIN'), { target: { value: '2468' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    });
    expect(calls.find((c) => c.url.includes('/auth/claim-name'))!.body).toEqual({ name: 'Lin Dan', inviteToken: TOKEN, pin: '2468' });
    // Already in the club: no ask, straight in.
    expect(identities).toEqual([{ name: 'Lin Dan', sessionId: '' }]);
  });

  async function toIsThatYou(routes: Record<string, () => Response>) {
    const calls = stub({
      '/email-code/start': () => json({ ok: true }),
      '/email-code/verify': () => json({ signup: true }),
      '/auth/complete-signup': () => json({ error: 'name_taken' }, 409),
      ...routes,
    });
    renderPage();
    await screen.findByText('Join Six Feathers');
    await proveEmail('lin@example.com');
    fireEvent.change(screen.getByLabelText('Your name'), { target: { value: 'Lin Dan' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Ask to join' }));
    });
    return calls;
  }

  it('"Is that you?" offers the PIN and the other phone, an organizer as the quiet way, and no typed code (step 3)', async () => {
    await toIsThatYou({});
    expect(screen.getByRole('button', { name: 'Enter my PIN' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Approve on my other phone' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Ask an organizer' })).toBeDefined();
    expect(screen.queryByRole('button', { name: /organizer's code/ })).toBeNull();
  });

  it('the other phone: shows the number to tap there, and signs in once that phone says yes', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let approved = false;
    const calls = await toIsThatYou({
      '/auth/claim-ask': () => json({ ok: true, secret: 'sealed', match: 47, club: 'club-x' }),
      '/access-request/claim': () => json(approved ? { status: 'approved', name: 'Lin Dan' } : { status: 'pending' }),
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Approve on my other phone' }));
    });
    expect(calls.find((c) => c.url.includes('/auth/claim-ask'))!.body).toEqual({ name: 'Lin Dan', inviteToken: TOKEN });
    expect(screen.getByRole('heading', { name: 'Check your other phone' })).toBeDefined();
    expect(screen.getByRole('img', { name: 'Your number is 47' }).textContent).toBe('47');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3100);
    });
    expect(identities).toHaveLength(0);
    approved = true;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3100);
    });
    expect(calls.find((c) => c.url.includes('/access-request/claim'))!.body).toEqual({ name: 'Lin Dan', secret: 'sealed', club: 'club-x' });
    expect(identities).toEqual([{ name: 'Lin Dan', sessionId: '' }]);
    vi.useRealTimers();
  });

  it('asking an organizer instead files a fresh ask in its place', async () => {
    const calls = await toIsThatYou({
      '/auth/claim-ask': () => json({ ok: true, secret: 'sealed', match: 47, club: 'club-x' }),
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Approve on my other phone' }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Ask an organizer instead' }));
    });
    const asks = calls.filter((c) => c.url.includes('/auth/claim-ask'));
    expect(asks[1].body).toEqual({ name: 'Lin Dan', inviteToken: TOKEN, organizer: true });
    expect(screen.getByRole('heading', { name: 'Request sent' })).toBeDefined();
    expect(screen.getByText('Requests stay open for an hour.')).toBeDefined();
  });

  it('a request that ran out says so, instead of waiting forever', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await toIsThatYou({
      '/auth/claim-ask': () => json({ ok: true, secret: 'sealed', match: 47, club: 'club-x' }),
      '/access-request/claim': () => json({ status: 'none' }),
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Approve on my other phone' }));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3100);
    });
    expect((await screen.findByRole('alert')).textContent).toMatch(/ran out/);
    expect(screen.getByRole('button', { name: 'Approve on my other phone' })).toBeDefined();
    vi.useRealTimers();
  });

  it('too many PIN tries counts down on "Is that you?" too', async () => {
    await toIsThatYou({ '/auth/claim-name': () => json({ error: 'pin_paused', retryAfter: 60 }, 429) });
    fireEvent.click(screen.getByRole('button', { name: 'Enter my PIN' }));
    fireEvent.change(screen.getByLabelText('PIN'), { target: { value: '0000' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    });
    expect((await screen.findByRole('alert')).textContent).toMatch(/try again in 1:00/);
    expect((screen.getByLabelText('PIN') as HTMLInputElement).disabled).toBe(true);
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
    fireEvent.change(screen.getByLabelText('Your name'), { target: { value: 'Kento' } });
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
    expect(identities).toEqual([{ name: 'Lin', sessionId: '' }]);
    expect(justAsked()).not.toBeNull();
  });

  it('an account already in the club goes straight in, with no "Request sent"', async () => {
    stub({
      '/email-code/start': () => json({ ok: true }),
      '/email-code/verify': () => json({ name: 'Lin' }),
      '/api/groups/ask': () => json({ ok: true, alreadyIn: true }),
    });
    renderPage();
    await screen.findByText('Join Six Feathers');
    await proveEmail('lin@example.com');
    expect(identities).toEqual([{ name: 'Lin', sessionId: '' }]);
    expect(justAsked()).toBeNull();
  });

  it('back from Google or Apple, it opens on the name step', async () => {
    stub({ '/auth/complete-signup': () => json({ pending: true }) });
    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <DoorJoinPage token={TOKEN} authProviders={['google']} onBack={vi.fn()} startAtName />
      </NextIntlClientProvider>,
    );
    expect(await screen.findByRole('heading', { name: "What's your name?" })).toBeDefined();
  });

  it('offers no name-only claim: an imported name signs in like everyone (one-way-in step 4d)', async () => {
    stub({});
    renderPage();
    await screen.findByText(/Six Feathers/);
    expect(screen.queryByRole('button', { name: /Claim your name/ })).toBeNull();
  });

  it('a dead link says so', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ error: 'invite_not_found' }, 404)));
    renderPage();
    expect(await screen.findByRole('heading', { name: 'This link no longer works' })).toBeDefined();
    expect(screen.getByText("Ask your club's organizer for the current link.")).toBeDefined();
  });
});
