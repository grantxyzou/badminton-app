// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import enMessages from '../../messages/en.json';
import DeleteAccountSheet from '../../components/auth/DeleteAccountSheet';

/**
 * The confirmation for an irreversible action.
 *
 * These pin the DISCLOSURES, not the layout. Each of the three lines on this
 * sheet is there because leaving it off would mislead someone at the moment
 * they can least afford it, and each is the kind of line that gets quietly
 * trimmed later by someone tightening copy who does not know why it was there.
 */

const online = vi.fn(() => true);
vi.mock('@/lib/useOnline', () => ({ useOnline: () => online() }));

const clearIdentity = vi.fn();
vi.mock('@/lib/identity', () => ({ clearIdentity: () => clearIdentity() }));

afterEach(() => cleanup());

function renderSheet(props: Partial<Parameters<typeof DeleteAccountSheet>[0]> = {}) {
  const onClose = vi.fn();
  const onDeleted = vi.fn();
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <DeleteAccountSheet open onClose={onClose} onDeleted={onDeleted} {...props} />
    </NextIntlClientProvider>,
  );
  return { onClose, onDeleted };
}

beforeEach(() => {
  online.mockReturnValue(true);
  clearIdentity.mockClear();
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ success: true }) })));
});

describe('what the sheet has to say', () => {
  /**
   * Deleting an account is not a way out of a balance. Letting anyone believe
   * otherwise would be the app lying by omission about money — and it cannot be
   * fixed by BLOCKING the deletion instead, because App Store 5.1.1(v) requires
   * the path to work regardless.
   */
  it('says that deleting does not cancel what you owe', () => {
    renderSheet();
    expect(screen.getByText(/doesn't cancel anything you still owe/i)).toBeTruthy();
  });

  /**
   * Someone deleting their account to erase themselves deserves to know a row
   * survives, even an anonymous one. Finding out later would feel like the app
   * kept something back.
   */
  it('admits that an unnamed line survives in past sessions', () => {
    renderSheet();
    expect(screen.getByText(/past sessions keep an unnamed line/i)).toBeTruthy();
  });

  it('names what is destroyed rather than only saying it is permanent', () => {
    renderSheet();
    const body = screen.getByText(/removes your PIN/i);
    expect(body.textContent).toMatch(/gear/i);
    expect(body.textContent).toMatch(/stats/i);
  });

  /** "Yes" under "Delete your account?" reads as "yes, cancel the deletion". */
  it('labels the destructive button with what it does', () => {
    renderSheet();
    expect(screen.getByRole('button', { name: /delete my account/i })).toBeTruthy();
  });
});

describe('the gates', () => {
  it('cannot be fired while offline', () => {
    online.mockReturnValue(false);
    renderSheet();
    const btn = screen.getByRole('button', { name: /delete my account/i }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(screen.getByText(/you're offline/i)).toBeTruthy();
  });

  it('sends the explicit confirmation the server demands', async () => {
    renderSheet();
    fireEvent.click(screen.getByRole('button', { name: /delete my account/i }));
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    const [, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(init.method).toBe('DELETE');
    expect(JSON.parse(init.body)).toEqual({ confirm: true });
  });

  it('clears the local identity so the device stops holding a dead account', async () => {
    const { onDeleted } = renderSheet();
    fireEvent.click(screen.getByRole('button', { name: /delete my account/i }));
    // Without this the browser keeps a name and a deleteToken for an account
    // that no longer exists, and Home offers to sign a ghost up for next week.
    await waitFor(() => expect(clearIdentity).toHaveBeenCalled());
    expect(onDeleted).toHaveBeenCalled();
  });
});

describe('failure is legible', () => {
  /** Closing on a failure would leave someone guessing whether it worked. */
  it('stays open and says so when the server refuses', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })));
    const { onClose, onDeleted } = renderSheet();
    fireEvent.click(screen.getByRole('button', { name: /delete my account/i }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(onClose).not.toHaveBeenCalled();
    expect(onDeleted).not.toHaveBeenCalled();
    expect(clearIdentity).not.toHaveBeenCalled();
  });

  it('survives a network throw the same way', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline mid-flight'); }));
    renderSheet();
    fireEvent.click(screen.getByRole('button', { name: /delete my account/i }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(clearIdentity).not.toHaveBeenCalled();
  });
});
