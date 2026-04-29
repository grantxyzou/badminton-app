// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import ForcePinModal from '../../components/ForcePinModal';
import enMessages from '../../messages/en.json';

const renderModal = () =>
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <ForcePinModal />
    </NextIntlClientProvider>,
  );

describe('ForcePinModal — fire conditions', () => {
  beforeEach(() => {
    localStorage.clear();
  });
  afterEach(() => cleanup());

  it('does not render when there is no identity', () => {
    renderModal();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('does not render when identity exists AND badminton_pin_set is "true"', () => {
    localStorage.setItem(
      'badminton_identity',
      JSON.stringify({ name: 'Michael', token: 'tok', sessionId: 'session-1' }),
    );
    localStorage.setItem('badminton_pin_set', 'true');
    renderModal();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('does not render when identity exists AND badminton_pin_set is "never" (sign-out escape)', () => {
    localStorage.setItem(
      'badminton_identity',
      JSON.stringify({ name: 'Michael', token: 'tok', sessionId: 'session-1' }),
    );
    localStorage.setItem('badminton_pin_set', 'never');
    renderModal();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('renders the blocking dialog when identity exists AND badminton_pin_set is missing', () => {
    localStorage.setItem(
      'badminton_identity',
      JSON.stringify({ name: 'Michael', token: 'tok', sessionId: 'session-1' }),
    );
    renderModal();
    const dialog = screen.queryByRole('dialog');
    expect(dialog).not.toBeNull();
    // The dialog announces its purpose via the title heading
    expect(screen.getByText(/Set a PIN to keep your spot/i)).toBeDefined();
    // Both the save button and the sign-out escape are present
    expect(screen.getByRole('button', { name: /Save PIN/i })).toBeDefined();
    expect(screen.getByRole('button', { name: /Sign out instead/i })).toBeDefined();
  });

  it('marks the dialog with aria-modal so assistive tech treats it as blocking', () => {
    localStorage.setItem(
      'badminton_identity',
      JSON.stringify({ name: 'Michael', token: 'tok', sessionId: 'session-1' }),
    );
    renderModal();
    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
  });
});
