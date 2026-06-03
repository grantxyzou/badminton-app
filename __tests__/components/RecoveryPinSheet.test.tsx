// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import RecoveryPinSheet from '../../components/RecoveryPinSheet';
import enMessages from '../../messages/en.json';

const identity = { name: 'Riley', token: 'tok', sessionId: 'session-2026-04-27' };

function renderSheet(props: { hasPin: boolean; authed: boolean | null }) {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <RecoveryPinSheet
        open
        onClose={vi.fn()}
        identity={identity}
        hasPin={props.hasPin}
        authed={props.authed}
        onSaved={vi.fn()}
      />
    </NextIntlClientProvider>,
  );
}

describe('RecoveryPinSheet — first-set requires an active session', () => {
  afterEach(() => cleanup());

  it('blocks first-PIN set with guidance when the member is not authed', () => {
    renderSheet({ hasPin: false, authed: false });
    // Actionable guidance instead of the set form.
    expect(screen.getByText(/sign up for this week/i)).toBeDefined();
    // The Save action must not be offered — there's no valid credential.
    expect(screen.queryByRole('button', { name: /^save$/i })).toBeNull();
  });

  it('allows first-PIN set when the member is authed (holds a member cookie)', () => {
    renderSheet({ hasPin: false, authed: true });
    expect(screen.queryByText(/sign up for this week/i)).toBeNull();
    expect(screen.getByRole('button', { name: /^save$/i })).toBeDefined();
  });

  it('does not block on unknown auth (authed null) — server is the backstop', () => {
    renderSheet({ hasPin: false, authed: null });
    expect(screen.queryByText(/sign up for this week/i)).toBeNull();
    expect(screen.getByRole('button', { name: /^save$/i })).toBeDefined();
  });

  it('never blocks the change-PIN path (hasPin true)', () => {
    renderSheet({ hasPin: true, authed: false });
    expect(screen.queryByText(/sign up for this week/i)).toBeNull();
  });
});
