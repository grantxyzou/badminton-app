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
vi.mock('@/components/auth/AskAccessForm', () => ({ default: capture('AskAccessForm') }));
vi.mock('@/components/auth/KeepAccountPage', () => ({ default: capture('KeepAccountPage') }));
vi.mock('@/components/auth/ForgotPasswordSheet', () => ({ default: capture('ForgotPasswordSheet') }));
vi.mock('@/components/auth/ChooseNameSheet', () => ({ default: capture('ChooseNameSheet') }));
vi.mock('@/components/auth/ResetPasswordSheet', () => ({ default: capture('ResetPasswordSheet') }));
// The multi-group doors, loaded lazily by the shell. Captured by contract too.
vi.mock('@/components/onboarding/CreateGroupPage', () => ({ default: capture('CreateGroupPage') }));
vi.mock('@/components/onboarding/JoinGroupPage', () => ({ default: capture('JoinGroupPage') }));
vi.mock('@/components/profile/GroupsPage', () => ({ default: capture('GroupsPage') }));
// jsdom cannot navigate; the explicit reloads of no-club mode go through here.
const { hardReload } = vi.hoisted(() => ({ hardReload: vi.fn() }));
vi.mock('@/lib/reload', () => ({ hardReload }));

import SignedOutShell, { type NoClub } from '@/components/onboarding/SignedOutShell';

const RESUME_KEY = 'badminton_onboarding_resume';
const RELOAD_MARK = 'badminton_signed_out_reload_at';

function json(body: unknown, status = 200) {
  return Promise.resolve({ ok: status >= 200 && status < 300, status, json: async () => body } as Response);
}

let fetchMock: ReturnType<typeof vi.fn>;

function at(search: string) {
  window.history.replaceState({}, '', `/bpm${search}`);
}

function renderShell(noClub?: NoClub) {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <SignedOutShell authProviders={['google']} noClub={noClub} />
    </NextIntlClientProvider>,
  );
}

const ORGANISER: NoClub = { memberName: 'Organiser', groups: [] };
const TWO_CLUBS: NoClub = {
  memberName: 'Lin',
  groups: [
    { id: 'club-a', name: 'Club A', role: 'member', rosterName: 'Lin A', joinedAt: '2026-02-01', current: false },
    { id: 'club-b', name: 'Club B', role: 'admin', rosterName: 'Lin B', joinedAt: '2026-03-01', current: false },
  ],
};

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  for (const k of Object.keys(captured)) delete captured[k];
  hardReload.mockClear();
  delete process.env.NEXT_PUBLIC_FLAG_MULTI_GROUP;
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
    // A page, not a sheet (Grant, 2026-11-08): a real person approves it.
    expect(screen.getByText('Can\'t sign in?')).toBeDefined();
    expect(captured.AskAccessForm?.claim).toBeNull();
    // Back goes to Log in, where they came from.
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByText('stub: PIN sign-in')).toBeDefined();
  });

  it('prefills "I play here already" with a stale local name', () => {
    localStorage.setItem('badminton_identity', JSON.stringify({ name: 'Viktor', sessionId: 'old' }));
    renderShell();
    fireEvent.click(screen.getByRole('button', { name: 'Log in' }));
    fireEvent.click(screen.getByRole('button', { name: 'I play here already' }));
    expect(captured.AskAccessForm?.initialName).toBe('Viktor');
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
  it('asks for a code when they did not come by the link', () => {
    renderShell();
    fireEvent.click(screen.getByRole('button', { name: 'Sign up' }));
    expect(screen.getByLabelText('Invite code')).toBeDefined();
    expect(screen.queryByText('stub: email sign-up')).toBeNull();
  });

  it('a typed CODE resolves the club, then the account step carries the code', async () => {
    renderShell();
    fireEvent.click(screen.getByRole('button', { name: 'Sign up' }));
    fireEvent.change(screen.getByLabelText('Invite code'), { target: { value: 'ABCD2345' } });
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
    fireEvent.change(screen.getByLabelText('Invite code'), {
      target: { value: `https://bpm.grantzou.com/bpm?join=${token}` },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await screen.findByText('Join BPM Badminton');
    expect(captured.EmailSignUpForm?.inviteToken).toBe(token);
  });

  it('an invite that does not resolve says so and goes no further', async () => {
    renderShell();
    fireEvent.click(screen.getByRole('button', { name: 'Sign up' }));
    fireEvent.change(screen.getByLabelText('Invite code'), { target: { value: 'BADCODE1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/That code doesn't work/);
    expect(screen.queryByText('stub: email sign-up')).toBeNull();
  });

  it('the invite survives the trip to Google', async () => {
    renderShell();
    fireEvent.click(screen.getByRole('button', { name: 'Sign up' }));
    fireEvent.change(screen.getByLabelText('Invite code'), { target: { value: 'ABCD2345' } });
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

  it('a ?join= link that no longer resolves says the LINK no longer works, not that a code is wrong', async () => {
    fetchMock.mockImplementation((input: RequestInfo | URL) =>
      String(input).includes('/api/groups/preview') ? json({ error: 'invite_not_found' }, 404) : json({}),
    );
    at(`?join=${'e5'.repeat(16)}`);
    renderShell();
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/That link no longer works/);
    expect(alert.textContent).not.toMatch(/code/);
  });

  it('?claim= opens the club’s ask page, and strips the link from the URL', async () => {
    // docs/plans/claim-your-name.md: an imported name asks to be let in.
    const token = 'c3'.repeat(16);
    at(`?claim=${token}`);
    renderShell();
    await waitFor(() => expect(captured.AskAccessForm?.claim).toEqual({ token, clubName: 'BPM Badminton' }));
    expect(screen.getByText('Join BPM Badminton')).toBeDefined();
    // A new person's name, not a stale one from this phone.
    expect(captured.AskAccessForm?.initialName).toBe('');
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes(`/api/groups/preview?claim=${token}`))).toBe(true);
    expect(window.location.search).not.toContain('claim');
  });

  it('the club’s door link on the one-link path opens the ask, not the sign-up form', async () => {
    // docs/plans/door-link.md: /bpm/j/<token> redirects to ?join=, and the
    // preview says the token is the door rather than an invite.
    const token = 'e5'.repeat(16);
    fetchMock.mockImplementation((input: RequestInfo | URL) =>
      String(input).includes('/api/groups/preview') ? json({ name: 'BPM Badminton', kind: 'door' }) : json({}),
    );
    at(`?join=${token}`);
    renderShell();
    await waitFor(() => expect(captured.AskAccessForm?.claim).toEqual({ token, clubName: 'BPM Badminton' }));
    expect(captured.EmailSignUpForm).toBeUndefined();
    expect(window.location.search).not.toContain('join');
  });

  it('a person let in through the door gets the "Keep your account" page, and goes in when they leave it', async () => {
    const token = 'f6'.repeat(16);
    at(`?claim=${token}`);
    renderShell();
    await waitFor(() => expect(captured.AskAccessForm?.claim).toBeTruthy());
    (captured.AskAccessForm!.onApproved as (r: { name: string; hasPin: boolean; email?: string }) => void)({
      name: 'Akane Yamaguchi',
      hasPin: false,
      email: 'akane@example.com',
    });
    // The account step first, with the email they typed, and not signed in yet:
    // writing the identity would reload this screen out from under it.
    await waitFor(() => expect(captured.KeepAccountPage?.name).toBe('Akane Yamaguchi'));
    expect(captured.KeepAccountPage?.initialEmail).toBe('akane@example.com');
    expect(sessionStorage.getItem(RELOAD_MARK)).toBeNull();
    (captured.KeepAccountPage!.onDone as () => void)();
    await waitFor(() => expect(sessionStorage.getItem(RELOAD_MARK)).not.toBeNull());
    expect(JSON.parse(localStorage.getItem('badminton_identity') ?? '{}').name).toBe('Akane Yamaguchi');
  });

  it('a claim link that no longer resolves says so, and opens nothing', async () => {
    fetchMock.mockImplementation((input: RequestInfo | URL) =>
      String(input).includes('/api/groups/preview') ? json({ error: 'invite_not_found' }, 404) : json({}),
    );
    at(`?claim=${'d4'.repeat(16)}`);
    renderShell();
    expect((await screen.findByRole('alert')).textContent).toMatch(/link has been replaced/);
    expect(captured.AskAccessForm).toBeUndefined();
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
 * credential. Since 2026-11-08 the ask page itself offers "Keep your account"
 * before going in, instead of leaving Home a marker.
 */
describe('after an admin lets someone in', () => {
  function approve(result: { name: string; hasPin: boolean }) {
    renderShell();
    fireEvent.click(screen.getByRole('button', { name: 'Log in' }));
    fireEvent.click(screen.getByRole('button', { name: 'I play here already' }));
    (captured.AskAccessForm!.onApproved as (r: { name: string; hasPin: boolean }) => void)(result);
  }

  it('offers to keep the account when they have nothing to sign in with', async () => {
    approve({ name: 'Kento', hasPin: false });
    await waitFor(() => expect(captured.KeepAccountPage?.name).toBe('Kento'));
    expect(sessionStorage.getItem(RELOAD_MARK)).toBeNull();
  });

  it('goes straight in when they already have a PIN', async () => {
    approve({ name: 'Lin', hasPin: true });
    await waitFor(() => expect(sessionStorage.getItem(RELOAD_MARK)).not.toBeNull());
    expect(captured.KeepAccountPage).toBeUndefined();
  });
});

/**
 * MULTI-GROUP (docs/plans/multi-group.md, 2026-10-07): the doors a stranger
 * from the store walks through, and the mode a signed-in member in no club gets.
 */
describe('multi-group OFF: nothing of this exists', () => {
  it('Sign up explains, and offers no "Start your own club"', () => {
    renderShell();
    fireEvent.click(screen.getByRole('button', { name: 'Sign up' }));
    expect(screen.getByText(/No invite\? Ask someone/)).toBeDefined();
    expect(screen.queryByRole('button', { name: /Start your own group/ })).toBeNull();
  });

  it('ignores a noClub prop — a no-club member cannot exist with groups off', () => {
    renderShell(ORGANISER);
    expect(screen.getByRole('button', { name: 'Sign up' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Log in' })).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Create a group' })).toBeNull();
  });
});

describe('multi-group ON — a stranger', () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_FLAG_MULTI_GROUP = 'true';
  });

  it('Welcome is still two buttons; the create door is a link on Sign up, opening the ACCOUNT step', async () => {
    renderShell();
    expect(screen.getAllByRole('button')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'Sign up' }));
    fireEvent.click(screen.getByRole('button', { name: /Start your own group/ }));
    await waitFor(() => expect(captured.CreateGroupPage).toBeDefined());
    expect(captured.CreateGroupPage?.startAtAuth).toBe(true);
    expect(captured.CreateGroupPage?.defaultName).toBeUndefined();
  });

  it('after the account step the page hands over: the resume is MARKED and the shell reloads', async () => {
    renderShell();
    fireEvent.click(screen.getByRole('button', { name: 'Sign up' }));
    fireEvent.click(screen.getByRole('button', { name: /Start your own group/ }));
    await waitFor(() => expect(captured.CreateGroupPage).toBeDefined());
    (captured.CreateGroupPage?.onSignedIn as () => void)();
    expect(JSON.parse(localStorage.getItem(RESUME_KEY) ?? '{}')).toMatchObject({ intent: 'create' });
    expect(sessionStorage.getItem(RELOAD_MARK)).not.toBeNull();
  });

  it('an identity written while the create page is open does NOT reload on its own — the page owns that moment', async () => {
    renderShell();
    fireEvent.click(screen.getByRole('button', { name: 'Sign up' }));
    fireEvent.click(screen.getByRole('button', { name: /Start your own group/ }));
    await waitFor(() => expect(captured.CreateGroupPage).toBeDefined());
    setIdentity({ name: 'Organiser', sessionId: '' });
    await new Promise((r) => setTimeout(r, 20));
    expect(sessionStorage.getItem(RELOAD_MARK)).toBeNull();
  });

  it('a new Google identity from the create flow gets the name sheet with noGroup, and the resume re-marked', () => {
    localStorage.setItem(RESUME_KEY, JSON.stringify({ intent: 'create', at: Date.now() }));
    at('?authFlow=name');
    renderShell();
    expect(captured.ChooseNameSheet?.open).toBe(true);
    expect(captured.ChooseNameSheet?.noGroup).toBe(true);
    expect(captured.ChooseNameSheet?.inviteToken).toBeUndefined();
    expect(JSON.parse(localStorage.getItem(RESUME_KEY) ?? '{}')).toMatchObject({ intent: 'create' });
  });

  it('a join resume still gets the name sheet WITHOUT noGroup', () => {
    localStorage.setItem(RESUME_KEY, JSON.stringify({ intent: 'join', code: 'ABCD2345', at: Date.now() }));
    at('?authFlow=name');
    renderShell();
    expect(captured.ChooseNameSheet?.noGroup).toBe(false);
    expect(captured.ChooseNameSheet?.inviteCode).toBe('ABCD2345');
  });
});

describe('multi-group ON — signed in, in no club', () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_FLAG_MULTI_GROUP = 'true';
  });

  it('a brand-new organiser gets three doors and no Sign up / Log in, on the welcome stage', async () => {
    renderShell(ORGANISER);
    expect(screen.getByRole('button', { name: 'Create a group' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'I have an invite' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Sign up' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Log in' })).toBeNull();
    expect(document.querySelector('[data-signed-out-welcome]')).not.toBeNull();
    await new Promise((r) => setTimeout(r, 20));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('Create a club opens the page on its FORM, named after the member', async () => {
    renderShell(ORGANISER);
    fireEvent.click(screen.getByRole('button', { name: 'Create a group' }));
    await waitFor(() => expect(captured.CreateGroupPage).toBeDefined());
    expect(captured.CreateGroupPage?.startAtAuth).toBe(false);
    expect(captured.CreateGroupPage?.defaultName).toBe('Organiser');
    expect(captured.CreateGroupPage?.onSignedIn).toBeUndefined();
    (captured.CreateGroupPage?.onDone as () => void)();
    expect(hardReload).toHaveBeenCalledTimes(1);
  });

  it('a create resume skips the doors and lands on the form', async () => {
    localStorage.setItem(RESUME_KEY, JSON.stringify({ intent: 'create', at: Date.now() }));
    renderShell(ORGANISER);
    await waitFor(() => expect(captured.CreateGroupPage).toBeDefined());
    expect(captured.CreateGroupPage?.startAtAuth).toBe(false);
    expect(localStorage.getItem(RESUME_KEY)).toBeNull();
  });

  it('?join= goes straight to the join page, and the credential leaves the URL', async () => {
    const token = 'c3'.repeat(16);
    at(`?join=${token}`);
    renderShell(ORGANISER);
    await waitFor(() => expect(captured.JoinGroupPage).toBeDefined());
    expect(captured.JoinGroupPage?.initialToken).toBe(token);
    expect(captured.JoinGroupPage?.defaultName).toBe('Organiser');
    expect(captured.JoinGroupPage?.hasOtherGroup).toBe(false);
    expect(window.location.search).not.toContain('join');
    (captured.JoinGroupPage?.onJoined as () => void)();
    expect(hardReload).toHaveBeenCalledTimes(1);
  });

  it('an identity write does not reload — the account already exists', async () => {
    renderShell(ORGANISER);
    setIdentity({ name: 'Organiser', sessionId: '' });
    await new Promise((r) => setTimeout(r, 20));
    expect(sessionStorage.getItem(RELOAD_MARK)).toBeNull();
    expect(hardReload).not.toHaveBeenCalled();
  });

  it('a member of other clubs gets them as a LIST, and a switch reloads', async () => {
    renderShell(TWO_CLUBS);
    await waitFor(() => expect(captured.GroupsPage).toBeDefined());
    expect((captured.GroupsPage?.groups as NoClub['groups']).map((g) => g.id)).toEqual(['club-a', 'club-b']);
    expect(captured.GroupsPage?.onBack).toBeUndefined();
    expect(screen.queryByRole('button', { name: 'Create a group' })).toBeNull();
    (captured.GroupsPage?.onSwitched as () => void)();
    expect(hardReload).toHaveBeenCalledTimes(1);
    (captured.GroupsPage?.onCreateAnother as () => void)();
    await waitFor(() => expect(captured.CreateGroupPage).toBeDefined());
    expect(captured.CreateGroupPage?.startAtAuth).toBe(false);
  });

  it('Sign out clears both cookies on the server, forgets the local identity, and reloads', async () => {
    localStorage.setItem('badminton_identity', JSON.stringify({ name: 'Organiser', sessionId: '' }));
    renderShell(ORGANISER);
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    await waitFor(() => expect(hardReload).toHaveBeenCalledTimes(1));
    const del = fetchMock.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === 'DELETE');
    expect(String(del?.[0])).toContain('/api/admin');
    expect(localStorage.getItem('badminton_identity')).toBeNull();
  });
});

