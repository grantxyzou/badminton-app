// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import CreateAccountSheet from '../../components/CreateAccountSheet';
import enMessages from '../../messages/en.json';

const SESSION = 'session-2026-05-04';

const renderSheet = (open = true, onClose = vi.fn()) =>
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <CreateAccountSheet open={open} onClose={onClose} sessionId={SESSION} />
    </NextIntlClientProvider>,
  );

describe('CreateAccountSheet', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });
  afterEach(() => cleanup());

  it('renders title, body, name + two PIN inputs, and disabled submit until valid', () => {
    renderSheet();
    expect(screen.getByText('Create your account')).toBeDefined();
    expect(screen.getByText(/Set a name and PIN/i)).toBeDefined();
    expect(screen.getByPlaceholderText('Enter your name')).toBeDefined();
    expect(screen.getAllByLabelText(/PIN/i).length).toBeGreaterThanOrEqual(2);
    const submit = screen.getByRole('button', { name: 'Create account' });
    expect((submit as HTMLButtonElement).disabled).toBe(true);
  });

  it('shows mismatch error when PINs differ', async () => {
    renderSheet();
    fireEvent.change(screen.getByPlaceholderText('Enter your name'), { target: { value: 'Riley' } });
    const pinInputs = screen.getAllByLabelText(/PIN/i) as HTMLInputElement[];
    fireEvent.change(pinInputs[0], { target: { value: '4827' } });
    fireEvent.change(pinInputs[1], { target: { value: '4828' } });
    const submit = screen.getByRole('button', { name: 'Create account' });
    fireEvent.click(submit);
    await waitFor(() => {
      expect(screen.getByText("PINs don't match")).toBeDefined();
    });
  });

  it('on success, sets identity (server-side hasPin is the source of truth — no localStorage flag)', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ id: 'm1', name: 'Riley', deleteToken: null }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const onClose = vi.fn();
    renderSheet(true, onClose);

    fireEvent.change(screen.getByPlaceholderText('Enter your name'), { target: { value: 'Riley' } });
    const pinInputs = screen.getAllByLabelText(/PIN/i) as HTMLInputElement[];
    fireEvent.change(pinInputs[0], { target: { value: '4827' } });
    fireEvent.change(pinInputs[1], { target: { value: '4827' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalled();
    });
    const [, init] = fetchSpy.mock.calls[0];
    expect(init?.method).toBe('POST');
    const body = JSON.parse(init?.body as string);
    expect(body).toEqual({ name: 'Riley', pin: '4827', sessionSignup: false });

    await waitFor(() => {
      const stored = localStorage.getItem('badminton_identity');
      expect(stored).toBeTruthy();
      const parsed = JSON.parse(stored!);
      expect(parsed.name).toBe('Riley');
      expect(parsed.token).toBeUndefined();
      // Stale localStorage flag retired in favor of server hasPin via /api/members/me
      expect(localStorage.getItem('badminton_pin_set')).toBeNull();
    });
  });

  it('surfaces too_common error from API', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: 'pin_too_common' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    renderSheet();
    fireEvent.change(screen.getByPlaceholderText('Enter your name'), { target: { value: 'Riley' } });
    const pinInputs = screen.getAllByLabelText(/PIN/i) as HTMLInputElement[];
    fireEvent.change(pinInputs[0], { target: { value: '1234' } });
    fireEvent.change(pinInputs[1], { target: { value: '1234' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));

    await waitFor(() => {
      expect(screen.getByText(/Pick a less common PIN/i)).toBeDefined();
    });
    expect(localStorage.getItem('badminton_identity')).toBeNull();
  });

  it('surfaces rate_limited error from API', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: 'Too many' }), { status: 429 }),
    );
    renderSheet();
    fireEvent.change(screen.getByPlaceholderText('Enter your name'), { target: { value: 'Riley' } });
    const pinInputs = screen.getAllByLabelText(/PIN/i) as HTMLInputElement[];
    fireEvent.change(pinInputs[0], { target: { value: '4827' } });
    fireEvent.change(pinInputs[1], { target: { value: '4827' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));

    await waitFor(() => {
      expect(screen.getByText(/Too many tries/i)).toBeDefined();
    });
  });
});
