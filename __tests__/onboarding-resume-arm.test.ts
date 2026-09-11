// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import {
  markOnboardingResume,
  consumeOnboardingResume,
  pruneStaleOnboardingResume,
} from '../lib/onboardingResume';

/**
 * THE ARM GATE, as a decision table.
 *
 * `HomeShell` owns the wiring, but the RULE is what matters and jsdom cannot
 * mount that component against a cross-origin OAuth redirect. So this pins the
 * decision itself, in the same shape the shell applies it:
 *
 *     armed  = landed-from-auth OR a staged handoff is waiting
 *     action = armed ? consume : prune
 *
 * The half that is easy to lose in a refactor is the `prune` branch. Replacing
 * it with a consume looks like a simplification and passes every other test —
 * and it means a second tab reloading mid-excursion destroys the record the
 * first tab is about to come back for.
 */
const KEY = 'badminton_onboarding_resume';

/** Exactly the expression in HomeShell's param effect. */
function armedFor(search: string, stagedHandoff = false): boolean {
  const params = new URLSearchParams(search);
  const landedFromAuth =
    params.get('authFlow') === 'name' || params.get('signedIn') === '1' || !!params.get('authError');
  return landedFromAuth || stagedHandoff;
}

function applyGate(search: string, stagedHandoff = false) {
  return armedFor(search, stagedHandoff)
    ? consumeOnboardingResume()
    : (pruneStaleOnboardingResume(), null);
}

beforeEach(() => window.localStorage.clear());

describe('which landings arm the resume', () => {
  it.each([
    ['a provider sign-in that resolved a member', '?signedIn=1&provider=google'],
    ['a provider sign-in with no member yet', '?authFlow=name'],
    ['a FAILED sign-in', '?authError=access_denied'],
  ])('%s arms it', (_label, search) => {
    markOnboardingResume('create');
    expect(applyGate(search)).toMatchObject({ intent: 'create' });
  });

  it('a failed sign-in arms it ON PURPOSE — you land back in the flow you left', () => {
    // Not a consolation prize: the banner renders above the page, so the retry
    // button is under it. The alternative is the doors with a banner and no
    // context about what you were doing.
    markOnboardingResume('create');
    expect(applyGate('?authError=access_denied')).not.toBeNull();
  });

  it('the installed-PWA return arms it with NO params at all', () => {
    // The system-browser sheet closes and the app is simply in the foreground
    // again, with a staged handoff waiting to be claimed.
    markOnboardingResume('create');
    expect(applyGate('', true)).toMatchObject({ intent: 'create' });
  });
});

describe('which landings must NOT', () => {
  it('a bare cold start navigates nobody, and LEAVES the record alone', () => {
    markOnboardingResume('create');
    expect(applyGate('')).toBeNull();
    // The two-tab case: tab B reloaded, tab A is still out at Google.
    expect(window.localStorage.getItem(KEY)).not.toBeNull();
  });

  it('an unrelated deep link does not arm it', () => {
    markOnboardingResume('create');
    expect(applyGate('?tab=profile')).toBeNull();
  });

  it('a password-reset landing does not arm it', () => {
    markOnboardingResume('create');
    expect(applyGate('?reset=abc&email=a%40b.c')).toBeNull();
  });

  it('`signedIn=0` is not a sign-in', () => {
    markOnboardingResume('create');
    expect(applyGate('?signedIn=0')).toBeNull();
  });

  it('an armed landing with NO record navigates nobody', () => {
    expect(applyGate('?signedIn=1')).toBeNull();
  });
});

describe('what the shell does with the record it gets', () => {
  it('a join resume carries the token, which is its only surviving copy', () => {
    // `?join=` was stripped from the URL as a bearer credential by a document
    // that has since died.
    markOnboardingResume('join', 'f'.repeat(32));
    expect(applyGate('?authFlow=name')).toMatchObject({ intent: 'join', token: 'f'.repeat(32) });
  });

  it('starts at the ACCOUNT step unless a member already resolved', () => {
    // The shell's rule: `signedIn=1` means the account step is behind us, and
    // starting there would flash a screen we are about to leave.
    const authFirst = (search: string) => new URLSearchParams(search).get('signedIn') !== '1';
    expect(authFirst('?signedIn=1&provider=google')).toBe(false);
    expect(authFirst('?authFlow=name')).toBe(true);
    expect(authFirst('?authError=access_denied')).toBe(true);
  });
});
