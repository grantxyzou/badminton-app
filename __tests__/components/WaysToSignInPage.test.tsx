// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import enMessages from '@/messages/en.json';
import WaysToSignInPage from '@/components/profile/WaysToSignInPage';
import type { UseSignInMethods } from '@/components/auth/useSignInMethods';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const state: UseSignInMethods = {
  methods: { available: [], linked: ['google'], hasPin: true, hasPassword: false, nudge: false },
  loadError: false,
  reload: vi.fn(async () => {}),
} as unknown as UseSignInMethods;

function renderPage(pinIsSet: boolean | null) {
  const props = { state, pinIsSet, onChangePin: vi.fn(), onRecoveryCode: vi.fn(), onBack: vi.fn() };
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <WaysToSignInPage {...props} />
    </NextIntlClientProvider>,
  );
  return props;
}

describe('WaysToSignInPage', () => {
  it('holds the methods, then the PIN and the recovery code', () => {
    const props = renderPage(true);
    expect(screen.getByRole('heading', { name: 'How you sign in' })).toBeTruthy();
    expect(screen.getByText('Google connected')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Update PIN/ }));
    fireEvent.click(screen.getByRole('button', { name: /Have a recovery code\?/ }));
    expect(props.onChangePin).toHaveBeenCalledOnce();
    expect(props.onRecoveryCode).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'Profile' }));
    expect(props.onBack).toHaveBeenCalledOnce();
  });

  it('offers no new PIN to someone without one: PINs are being phased out', () => {
    renderPage(false);
    expect(screen.queryByRole('button', { name: /PIN/ })).toBeNull();
    expect(screen.getByRole('button', { name: /Have a recovery code\?/ })).toBeTruthy();
  });

  it('an unknown PIN status shows the neutral title, never a claim either way', () => {
    renderPage(null);
    expect(screen.getByRole('button', { name: new RegExp(enMessages.profile.pinSectionTitle) })).toBeTruthy();
    expect(screen.queryByText('Update PIN')).toBeNull();
  });
});

describe('WaysToSignInPage — loading', () => {
  it('holds the card’s place with a skeleton while the methods load, never an empty box', () => {
    const loading = { methods: null, loadError: false, reload: vi.fn() } as unknown as UseSignInMethods;
    const { container } = render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <WaysToSignInPage state={loading} pinIsSet={true} onChangePin={vi.fn()} onRecoveryCode={vi.fn()} onBack={vi.fn()} />
      </NextIntlClientProvider>,
    );
    expect(container.querySelector('.shimmer-line')).not.toBeNull();
  });
});
