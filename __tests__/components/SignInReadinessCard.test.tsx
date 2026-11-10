// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import SignInReadinessCard from '@/components/admin/CommandCenter/SignInReadinessCard';

/**
 * MEMBERS ONLY, PART 4: the admin's "who would be locked out" card. The flag
 * flip waits on it, so the case that matters most is the one that must NOT
 * happen — a failed load reading as "nobody would be locked out".
 */

function answer(body: unknown, status = 200) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: status < 300, status, json: async () => body }) as Response),
  );
}

beforeEach(() => {
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('SignInReadinessCard', () => {
  it('names the members with no way to sign in', async () => {
    answer({ total: 5, ready: 3, cannotSignIn: ['Akane', 'Kento'] });
    render(<SignInReadinessCard />);
    expect(await screen.findByText('Akane')).toBeDefined();
    expect(screen.getByText('Kento')).toBeDefined();
    expect(screen.getByText(/of 5 members can sign in/)).toBeDefined();
  });

  it('a failed load is an ERROR, never a confident zero', async () => {
    answer({ error: 'readiness_failed' }, 503);
    render(<SignInReadinessCard />);
    expect(await screen.findByRole('alert')).toBeDefined();
  });

  it('disappears once nobody is locked out', async () => {
    answer({ total: 4, ready: 4, cannotSignIn: [] });
    const { container } = render(<SignInReadinessCard />);
    await new Promise((r) => setTimeout(r, 20));
    expect(container.textContent).toBe('');
  });

  it('on its own page, lists who has only a PIN, organisers and admins marked', async () => {
    answer({
      total: 6,
      ready: 6,
      cannotSignIn: [],
      pinOnly: [{ name: 'Chong Wei', rank: 'organiser' }, { name: 'Zhang', rank: 'admin' }, { name: 'Lin' }],
    });
    render(<SignInReadinessCard standalone onOpenMember={() => {}} />);
    expect(await screen.findByText('Only a PIN')).toBeDefined();
    expect(screen.getByText(/3/, { selector: 'strong' })).toBeDefined();
    expect(screen.getByText(/of 6 members sign in with a PIN only/)).toBeDefined();
    expect(screen.getByRole('button', { name: 'Open Chong Wei in the roster' }).textContent).toBe('Chong Wei · Organiser');
    expect(screen.getByRole('button', { name: 'Open Zhang in the roster' }).textContent).toBe('Zhang · Admin');
    expect(screen.getByRole('button', { name: 'Open Lin in the roster' }).textContent).toBe('Lin');
  });

  it('on its own page, an honest zero says nobody relies on a PIN alone', async () => {
    answer({ total: 4, ready: 4, cannotSignIn: [], pinOnly: [] });
    render(<SignInReadinessCard standalone />);
    expect(await screen.findByText('Nobody relies on a PIN alone.')).toBeDefined();
  });

  it('an older server without the list shows no PIN section, rather than a false zero', async () => {
    answer({ total: 4, ready: 4, cannotSignIn: [] });
    render(<SignInReadinessCard standalone />);
    expect(await screen.findByText(/members can sign in/)).toBeDefined();
    expect(screen.queryByText('Only a PIN')).toBeNull();
  });

  it('the console card stays quiet about PINs: it renders only while someone is locked out', async () => {
    answer({ total: 4, ready: 4, cannotSignIn: [], pinOnly: [{ name: 'Lin' }] });
    const { container } = render(<SignInReadinessCard />);
    await new Promise((r) => setTimeout(r, 20));
    expect(container.textContent).toBe('');
  });

  it('shows anyone who is locked out', async () => {
    answer({ total: 4, ready: 3, cannotSignIn: ['Kento'] });
    render(<SignInReadinessCard />);
    expect(await screen.findByText('Kento')).toBeDefined();
    expect(screen.getByText(/locked out until you let them in/)).toBeDefined();
  });
});
