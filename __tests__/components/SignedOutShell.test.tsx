// @vitest-environment jsdom
// @vitest-environment-options { "url": "http://localhost:3000/bpm" }
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import enMessages from '../../messages/en.json';
import { setIdentity } from '@/lib/identity';

/**
 * MEMBERS ONLY, PART 3 (docs/plans/members-only.md): what a signed-out visitor
 * sees, and all they see.
 *
 * The auth forms and sheets are stubbed down to their CONTRACT — the props this
 * screen hands them and the callbacks it relies on. Each has its own tests; what
 * is under test here is this screen's decisions: which view, which invite goes
 * where, what survives the trip to Google, and that signing in hands control to
 * the server by reloading.
 */

// Hoisted: `vi.mock` factories run before the module's own top-level code.
const { captured, capture } = vi.hoisted(() => {
  const captured: Record<string, Record<string, unknown>> = {};
  const capture = (name: string) => (props: Record<string, unknown>) => {
    captured[name] = props;
    return null;
  };
  return { captured, capture };
});

vi.mock('@/components/ThemeToggle', () => ({ default: () => null }));
vi.mock('@/components/LanguageToggle', () => ({ default: () => null }));
vi.mock('@/components/NativeBridge', () => ({ default: () => null }));
vi.mock('@/components/auth/ProviderButtons', () => ({
  default: (props: { onLeave?: () => void }) => {
    captured.ProviderButtons = props as Record<string, unknown>;
    return (
      <button type="button" onClick={() => props.onLeave?.()}>
        Continue with Google
      </button>
    );
  },
}));
vi.mock('@/components/SignInForm', () => ({
  default: (props: { onSuccess: (r: { name: string }) => void }) => (
    <button type="button" onClick={() => props.onSuccess({ name: 'Lin' })}>
      stub: PIN sign-in
    </button>
  ),
}));
vi.mock('@/components/auth/EmailSignInForm', () => ({ default: () => <p>stub: email sign-in</p> }));
vi.mock('@/components/auth/EmailSignUpForm', () => ({
  default: (props: Record<string, unknown>) => {
    captured.EmailSignUpForm = props;
    return <p>stub: email sign-up</p>;
  },
}));
vi.mock('@/components/AskAccessSheet', () => ({ default: capture('AskAccessSheet') }));
vi.mock('@/components/auth/ForgotPasswordSheet', () => ({ default: capture('ForgotPasswordSheet') }));
vi.mock('@/components/auth/ChooseNameSheet', () => ({ default: capture('ChooseNameSheet') }));
vi.mock('@/components/auth/ResetPasswordSheet', () => ({ default: capture('ResetPasswordSheet') }));

import SignedOutShell from '@/components/onboarding/SignedOutShell';

const RESUME_KEY = 'badminton_onboarding_resume';
const RELOAD_MARK = 'badminton_signed_out_reload_at';

function json(body: unknown, status = 200) {
  return Promise.resolve({ ok: status >= 200 && status < 300, status, json: async () => body } as Response);
}

let fetchMock: ReturnType<typeof vi.fn>;

function at(search: string) {
  window.history.replaceState({}, '', `/bpm${search}`);
}

function renderShell() {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <SignedOutShell authProviders={['google']} />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  for (const k of Object.keys(captured)) delete captured[k];
  process.env.NEXT_PUBLIC_FLAG_AUTH_PROVIDERS = 'true';
  fetchMock = vi.fn((input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/api/groups/preview')) {
      return url.includes('BADCODE1') ? json({ error: 'invite_not_found' }, 404) : json({ name: 'BPM Badminton' });
    }
    return json({});
  });
  vi.stubGlobal('fetch', fetchMock);
  at('');
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete process.env.NEXT_PUBLIC_FLAG_AUTH_PROVIDERS;
});

describe('Welcome', () => {
  it('offers Sign up and Log in, and nothing about the club', () => {
    renderShell();
    expect(screen.getByRole('button', { name: 'Sign up' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Log in' })).toBeDefined();
    expect(screen.queryByRole('navigation')).toBeNull();
  });

  it('makes no request at all', async () => {
    renderShell();
    // Give any mount effect the chance to fire.
    await new Promise((r) => setTimeout(r, 20));
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('Log in', () => {
  it('offers Google, name-and-PIN, and "I play here already"', () => {
    renderShell();
    fireEvent.click(screen.getByRole('button', { name: 'Log in' }));
    expect(screen.getByText('Continue with Google')).toBeDefined();
    expect(screen.getByText('stub: PIN sign-in')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'I play here already' }));
    expect(captured.AskAccessSheet?.open).toBe(true);
  });

  it('prefills "I play here already" with a stale local name', () => {
    localStorage.setItem('badminton_identity', JSON.stringify({ name: 'Viktor', sessionId: 'old' }));
    renderShell();
    fireEvent.click(screen.getByRole('button', { name: 'Log in' }));
    expect(captured.AskAccessSheet?.initialName).toBe('Viktor');
  });

  it('switches to email and routes "forgot" to the password sheet', () => {
    renderShell();
    fireEvent.click(screen.getByRole('button', { name: 'Log in' }));
    fireEvent.click(screen.getByRole('button', { name: 'Use email instead' }));
    expect(screen.getByText('stub: email sign-in')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Forgot password?' }));
    expect(captured.ForgotPasswordSheet?.open).toBe(true);
  });
});

describe('Sign up needs an invite', () => {
  it('asks for a link or code before anything else', () => {
    renderShell();
    fireEvent.click(screen.getByRole('button', { name: 'Sign up' }));
    expect(screen.getByLabelText('Invite link or code')).toBeDefined();
    expect(screen.queryByText('stub: email sign-up')).toBeNull();
  });

  it('a typed CODE resolves the club, then the account step carries the code', async () => {
    renderShell();
    fireEvent.click(screen.getByRole('button', { name: 'Sign up' }));
    fireEvent.change(screen.getByLabelText('Invite link or code'), { target: { value: 'ABCD2345' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    expect(await screen.findByText('Join BPM Badminton')).toBeDefined();
    expect(String(fetchMock.mock.calls[0][0])).toContain('code=ABCD2345');
    expect(captured.EmailSignUpForm?.inviteCode).toBe('ABCD2345');
    expect(captured.EmailSignUpForm?.inviteToken).toBeUndefined();
  });

  it('a pasted LINK is read as a token, not a code', async () => {
    renderShell();
    fireEvent.click(screen.getByRole('button', { name: 'Sign up' }));
    const token = 'a1'.repeat(16);
    fireEvent.change(screen.getByLabelText('Invite link or code'), {
      target: { value: `https://bpm.grantzou.com/bpm?join=${token}` },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await screen.findByText('Join BPM Badminton');
    expect(captured.EmailSignUpForm?.inviteToken).toBe(token);
  });

  it('an invite that does not resolve says so and goes no further', async () => {
    renderShell();
    fireEvent.click(screen.getByRole('button', { name: 'Sign up' }));
    fireEvent.change(screen.getByLabelText('Invite link or code'), { target: { value: 'BADCODE1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByRole('alert')).toBeDefined();
    expect(screen.queryByText('stub: email sign-up')).toBeNull();
  });

  it('the invite survives the trip to Google', async () => {
    renderShell();
    fireEvent.click(screen.getByRole('button', { name: 'Sign up' }));
    fireEvent.change(screen.getByLabelText('Invite link or code'), { target: { value: 'ABCD2345' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await screen.findByText('Join BPM Badminton');
    fireEvent.click(screen.getByText('Continue with Google'));
    expect(JSON.parse(localStorage.getItem(RESUME_KEY) ?? '{}')).toMatchObject({ intent: 'join', code: 'ABCD2345' });
  });
});

describe('landings', () => {
  it('?join= opens Sign up already naming the club, and strips the credential from the URL', async () => {
    const token = 'b2'.repeat(16);
    at(`?join=${token}`);
    renderShell();
    expect(await screen.findByText('Join BPM Badminton')).toBeDefined();
    expect(captured.EmailSignUpForm?.inviteToken).toBe(token);
    expect(window.location.search).not.toContain('join');
  });

  it('a new Google identity gets the name sheet, carrying the invite that rode the excursion', () => {
    localStorage.setItem(RESUME_KEY, JSON.stringify({ intent: 'join', code: 'ABCD2345', at: Date.now() }));
    at('?authFlow=name');
    renderShell();
    expect(captured.ChooseNameSheet?.open).toBe(true);
    expect(captured.ChooseNameSheet?.inviteCode).toBe('ABCD2345');
  });

  it('leaves ?tab and ?intent in the URL for the app to act on after signing in', () => {
    at('?tab=profile&intent=delete');
    renderShell();
    expect(window.location.search).toContain('tab=profile');
    expect(window.location.search).toContain('intent=delete');
  });

  it('a reset link opens the reset sheet and strips the token', () => {
    at('?reset=tok123&email=lin%40example.com');
    renderShell();
    expect(captured.ResetPasswordSheet?.open).toBe(true);
    expect(window.location.search).not.toContain('reset');
  });
});

describe('signing in hands control to the server', () => {
  it('reloads once an identity is written — any way in', async () => {
    renderShell();
    fireEvent.click(screen.getByRole('button', { name: 'Log in' }));
    fireEvent.click(screen.getByText('stub: PIN sign-in'));
    // jsdom cannot navigate; the reload guard's mark is the observable proof
    // that a reload was attempted.
    await waitFor(() => expect(sessionStorage.getItem(RELOAD_MARK)).not.toBeNull());
  });

  it('does not reload again within the guard window (no loop if the cookie never landed)', async () => {
    renderShell();
    setIdentity({ name: 'Lin', sessionId: '' });
    await waitFor(() => expect(sessionStorage.getItem(RELOAD_MARK)).not.toBeNull());
    const first = sessionStorage.getItem(RELOAD_MARK);
    setIdentity({ name: 'Lin', sessionId: '' });
    expect(sessionStorage.getItem(RELOAD_MARK)).toBe(first);
  });
});

/**
 * 2026-09-13 flow audit, finding 1: an admin approval signs someone in with no
 * credential. This screen leaves a one-shot marker so Home opens the PIN sheet.
 */
describe('after an admin lets someone in', () => {
  it('leaves the "offer a PIN" marker when they have no PIN', () => {
    renderShell();
    fireEvent.click(screen.getByRole('button', { name: 'Log in' }));
    const onSignedIn = captured.AskAccessSheet?.onSignedIn as (r: { name: string; hasPin: boolean }) => void;
    onSignedIn({ name: 'Kento', hasPin: false });
    expect(sessionStorage.getItem('badminton_offer_pin')).toBe('1');
  });

  it('leaves no marker when they already have one', () => {
    renderShell();
    fireEvent.click(screen.getByRole('button', { name: 'Log in' }));
    const onSignedIn = captured.AskAccessSheet?.onSignedIn as (r: { name: string; hasPin: boolean }) => void;
    onSignedIn({ name: 'Lin', hasPin: true });
    expect(sessionStorage.getItem('badminton_offer_pin')).toBeNull();
  });
});

