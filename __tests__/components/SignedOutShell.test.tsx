// @vitest-environment jsdom
// @vitest-environment-options { "url": "http://localhost:3000/bpm" }
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent, act } from '@testing-library/react';
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
vi.mock('@/components/auth/EmailSignUpForm', () => ({
  default: (props: Record<string, unknown>) => {
    captured.EmailSignUpForm = props;
    return <p>stub: email sign-up</p>;
  },
}));
vi.mock('@/components/onboarding/DoorJoinPage', () => ({ default: capture('DoorJoinPage') }));
vi.mock('@/components/onboarding/NameStep', () => ({ default: capture('NameStep') }));
vi.mock('@/components/auth/KeepAccountPage', () => ({ default: capture('KeepAccountPage') }));
vi.mock('@/components/auth/ForgotPasswordSheet', () => ({ default: capture('ForgotPasswordSheet') }));
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
    expect(screen.getByRole('button', { name: 'Join a club' })).toBeDefined();
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
  it('leads with Google and an email code; the PIN is behind "Other ways"; "Can\'t sign in?" is a page', () => {
    renderShell();
    fireEvent.click(screen.getByRole('button', { name: 'Log in' }));
    expect(screen.getByText('Continue with Google')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Email me a code' })).toBeDefined();
    expect(screen.queryByPlaceholderText('PIN')).toBeNull();
    // No card and no password route: a clean screen (docs/plans/sign-in-redesign.md).
    expect(screen.queryByRole('button', { name: 'Use my password instead' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Other ways' }));
    expect(screen.getByPlaceholderText('PIN')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Use email instead' }));
    expect(screen.getByRole('button', { name: 'Email me a code' })).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: "Can't sign in?" }));
    expect(screen.getByRole('heading', { name: "Get back in with your club's QR code" })).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Reset my password' }));
    expect(captured.ForgotPasswordSheet?.open).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByRole('button', { name: 'Email me a code' })).toBeDefined();
  });

  it('"Forgot your PIN?" goes to Can\'t sign in?', () => {
    renderShell();
    fireEvent.click(screen.getByRole('button', { name: 'Log in' }));
    fireEvent.click(screen.getByRole('button', { name: 'Other ways' }));
    fireEvent.click(screen.getByRole('button', { name: 'Forgot your PIN?' }));
    expect(screen.getByRole('heading', { name: "Get back in with your club's QR code" })).toBeDefined();
  });

  it('an emailed code on Log in says IF the address has an account', async () => {
    fetchMock.mockImplementation(() => json({ ok: true }));
    renderShell();
    fireEvent.click(screen.getByRole('button', { name: 'Log in' }));
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'lin@example.com' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Email me a code' }));
    });
    expect(screen.getByRole('heading', { name: 'Check your email' })).toBeDefined();
    expect(screen.getByRole('status').textContent).toBe('If lin@example.com has an account, a code is on its way.');
    // No step marker: this is not the three-step join.
    expect(screen.queryByRole('img', { name: /Step/ })).toBeNull();
  });
});

async function pinSignIn(methods: Record<string, unknown>) {
  fetchMock.mockImplementation((input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/api/players/recover')) return json({ deleteToken: null });
    if (url.includes('/api/auth/methods')) return json(methods);
    return json({});
  });
  renderShell();
  fireEvent.click(screen.getByRole('button', { name: 'Log in' }));
  fireEvent.click(screen.getByRole('button', { name: 'Other ways' }));
  fireEvent.change(screen.getByPlaceholderText('Your name'), { target: { value: 'Lin' } });
  fireEvent.change(screen.getByPlaceholderText('PIN'), { target: { value: '2468' } });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
  });
}

/**
 * docs/plans/sign-in-redesign.md, "Ask PIN-only members sooner": straight
 * after a PIN log-in, someone whose PIN is their only way in gets "Keep your
 * account" once, before the app opens.
 */
describe('a PIN log-in', () => {
  it('offers to keep the account when the PIN is the only way in, then goes in', async () => {
    await pinSignIn({ available: ['google'], linked: [], hasPassword: false, hasEmailCode: false, hasPin: true });
    await waitFor(() => expect(captured.KeepAccountPage?.reason).toBe('pinOnly'));
    expect(captured.KeepAccountPage?.name).toBe('Lin');
    expect(sessionStorage.getItem(RELOAD_MARK)).toBeNull();
    act(() => (captured.KeepAccountPage!.onDone as () => void)());
    await waitFor(() => expect(sessionStorage.getItem(RELOAD_MARK)).not.toBeNull());
  });

  it('goes straight in when the account has another way in', async () => {
    await pinSignIn({ available: ['google'], linked: ['google'], hasPassword: false, hasPin: true });
    await waitFor(() => expect(sessionStorage.getItem(RELOAD_MARK)).not.toBeNull());
    expect(captured.KeepAccountPage).toBeUndefined();
  });
});

describe('Join a club needs the club link (one-way-in step 5)', () => {
  function toPaste() {
    renderShell();
    fireEvent.click(screen.getByRole('button', { name: 'Join a club' }));
    // Scan first (docs/plans/sign-in-redesign.md); the link is the quiet way.
    expect(screen.getByRole('heading', { name: "Scan your club's QR code" })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Scan QR code' })).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Paste a link' }));
  }

  it('scans first, pastes as the quiet way, and offers no account form', () => {
    toPaste();
    expect(screen.getByLabelText("Your club's link")).toBeDefined();
    expect(screen.queryByText('stub: email sign-up')).toBeNull();
  });

  it('a pasted link opens the club\'s page (sign in first, then ask)', async () => {
    toPaste();
    const token = 'a1'.repeat(16);
    fireEvent.change(screen.getByLabelText("Your club's link"), {
      target: { value: `https://bpm.grantzou.com/bpm/j/${token}` },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(captured.DoorJoinPage?.token).toBe(token));
    expect(String(fetchMock.mock.calls[0][0])).toContain(`token=${token}`);
  });

  it('an old invite code asks for the link, and checks nothing', async () => {
    toPaste();
    fireEvent.change(screen.getByLabelText("Your club's link"), { target: { value: 'ABCD2345' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/Paste the whole link/);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(captured.DoorJoinPage).toBeUndefined();
  });

  it('a link that does not resolve says so and goes no further', async () => {
    fetchMock.mockImplementation(() => json({ error: 'invite_not_found' }, 404));
    toPaste();
    fireEvent.change(screen.getByLabelText("Your club's link"), { target: { value: 'f'.repeat(32) } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/That link no longer works/);
    expect(captured.DoorJoinPage).toBeUndefined();
  });
});

describe('landings', () => {
  it('?join= (where /bpm/j/<token> lands) opens the club\'s page, and strips the credential from the URL', async () => {
    const token = 'b2'.repeat(16);
    at(`?join=${token}`);
    renderShell();
    await waitFor(() => expect(captured.DoorJoinPage?.token).toBe(token));
    expect(captured.EmailSignUpForm).toBeUndefined();
    expect(window.location.search).not.toContain('join');
  });

  it('?claim= opens the club’s page (sign in first, then ask), and strips the link from the URL', async () => {
    // docs/plans/one-way-in.md, step 4: the club's link is a page that signs
    // in first, and nothing else (the name-only claim went in step 4d).
    const token = 'c3'.repeat(16);
    at(`?claim=${token}`);
    renderShell();
    await waitFor(() => expect(captured.DoorJoinPage?.token).toBe(token));
    expect(window.location.search).not.toContain('claim');
  });

  it('the club’s page offers no name-only claim (one-way-in step 4d)', async () => {
    const token = 'c3'.repeat(16);
    at(`?claim=${token}`);
    renderShell();
    await waitFor(() => expect(captured.DoorJoinPage?.token).toBe(token));
    expect(captured.DoorJoinPage).not.toHaveProperty('onClaimName');
  });

  it('the club’s door link on the one-link path opens the club’s page, not the sign-up form', async () => {
    // docs/plans/door-link.md: /bpm/j/<token> redirects to ?join=, and the
    // preview says the token is the door rather than an invite.
    const token = 'e5'.repeat(16);
    fetchMock.mockImplementation((input: RequestInfo | URL) =>
      String(input).includes('/api/groups/preview') ? json({ name: 'BPM Badminton', kind: 'door' }) : json({}),
    );
    at(`?join=${token}`);
    renderShell();
    await waitFor(() => expect(captured.DoorJoinPage?.token).toBe(token));
    expect(captured.EmailSignUpForm).toBeUndefined();
    expect(window.location.search).not.toContain('join');
  });

  it('a new Google identity opens the club\'s page at its name step, with the link that rode the excursion', () => {
    localStorage.setItem(RESUME_KEY, JSON.stringify({ intent: 'join', token: 'c4'.repeat(16), at: Date.now() }));
    at('?authFlow=name');
    renderShell();
    // One name step for every way in (docs/plans/sign-in-redesign.md, merge 4).
    expect(captured.DoorJoinPage?.token).toBe('c4'.repeat(16));
    expect(captured.DoorJoinPage?.startAtName).toBe(true);
    expect(window.location.search).not.toContain('authFlow');
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
    setIdentity({ name: 'Lin', sessionId: '' });
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
 * MULTI-GROUP (docs/plans/multi-group.md, 2026-10-07): the doors a stranger
 * from the store walks through, and the mode a signed-in member in no club gets.
 */
describe('multi-group OFF: nothing of this exists', () => {
  it('Join a club offers no "Start your own club"', () => {
    renderShell();
    fireEvent.click(screen.getByRole('button', { name: 'Join a club' }));
    expect(screen.getByRole('button', { name: 'Log in' })).toBeDefined();
    expect(screen.queryByRole('button', { name: /Start your own club/ })).toBeNull();
  });

  it('ignores a noClub prop — a no-club member cannot exist with groups off', () => {
    renderShell(ORGANISER);
    expect(screen.getByRole('button', { name: 'Join a club' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Log in' })).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Create a club' })).toBeNull();
  });
});

describe('multi-group ON — a stranger', () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_FLAG_MULTI_GROUP = 'true';
  });

  it('Welcome is still two buttons; the create door is a link on Sign up, opening the ACCOUNT step', async () => {
    renderShell();
    expect(screen.getAllByRole('button')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'Join a club' }));
    fireEvent.click(screen.getByRole('button', { name: /Start your own club/ }));
    await waitFor(() => expect(captured.CreateGroupPage).toBeDefined());
    expect(captured.CreateGroupPage?.startAtAuth).toBe(true);
    expect(captured.CreateGroupPage?.defaultName).toBeUndefined();
  });

  it('after the account step the page hands over: the resume is MARKED and the shell reloads', async () => {
    renderShell();
    fireEvent.click(screen.getByRole('button', { name: 'Join a club' }));
    fireEvent.click(screen.getByRole('button', { name: /Start your own club/ }));
    await waitFor(() => expect(captured.CreateGroupPage).toBeDefined());
    (captured.CreateGroupPage?.onSignedIn as () => void)();
    expect(JSON.parse(localStorage.getItem(RESUME_KEY) ?? '{}')).toMatchObject({ intent: 'create' });
    expect(sessionStorage.getItem(RELOAD_MARK)).not.toBeNull();
  });

  it('an identity written while the create page is open does NOT reload on its own — the page owns that moment', async () => {
    renderShell();
    fireEvent.click(screen.getByRole('button', { name: 'Join a club' }));
    fireEvent.click(screen.getByRole('button', { name: /Start your own club/ }));
    await waitFor(() => expect(captured.CreateGroupPage).toBeDefined());
    setIdentity({ name: 'Organiser', sessionId: '' });
    await new Promise((r) => setTimeout(r, 20));
    expect(sessionStorage.getItem(RELOAD_MARK)).toBeNull();
  });

  it('a new Google identity from the create flow gets the name step with noGroup, and the resume re-marked', () => {
    localStorage.setItem(RESUME_KEY, JSON.stringify({ intent: 'create', at: Date.now() }));
    at('?authFlow=name');
    renderShell();
    expect(captured.NameStep?.noGroup).toBe(true);
    expect(captured.NameStep?.inviteToken).toBeUndefined();
    expect(captured.DoorJoinPage).toBeUndefined();
    expect(JSON.parse(localStorage.getItem(RESUME_KEY) ?? '{}')).toMatchObject({ intent: 'create' });
  });

  it('a join resume gets the club\'s name step, never noGroup', () => {
    localStorage.setItem(RESUME_KEY, JSON.stringify({ intent: 'join', token: 'c4'.repeat(16), at: Date.now() }));
    at('?authFlow=name');
    renderShell();
    expect(captured.NameStep).toBeUndefined();
    expect(captured.DoorJoinPage?.token).toBe('c4'.repeat(16));
  });
});

describe('multi-group ON — signed in, in no club', () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_FLAG_MULTI_GROUP = 'true';
  });

  it('a brand-new organiser gets three doors and no Sign up / Log in, on the welcome stage', async () => {
    renderShell(ORGANISER);
    expect(screen.getByRole('button', { name: 'Create a club' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'I have a club link' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Join a club' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Log in' })).toBeNull();
    expect(document.querySelector('[data-signed-out-welcome]')).not.toBeNull();
    await new Promise((r) => setTimeout(r, 20));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('Create a club opens the page on its FORM, named after the member', async () => {
    renderShell(ORGANISER);
    fireEvent.click(screen.getByRole('button', { name: 'Create a club' }));
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
    expect(screen.queryByRole('button', { name: 'Create a club' })).toBeNull();
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

