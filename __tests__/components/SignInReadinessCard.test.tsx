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
  delete process.env.NEXT_PUBLIC_FLAG_MEMBERS_ONLY;
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  delete process.env.NEXT_PUBLIC_FLAG_MEMBERS_ONLY;
});

describe('SignInReadinessCard', () => {
  it('names the members with no way to sign in', async () => {
    answer({ total: 5, ready: 3, cannotSignIn: ['Akane', 'Kento'] });
    render(<SignInReadinessCard />);
    expect(await screen.findByText('Akane')).toBeDefined();
    expect(screen.getByText('Kento')).toBeDefined();
    expect(screen.getByText(/of 5 members can sign in/)).toBeDefined();
  });

  it('before the flip, says so plainly when nobody would be locked out', async () => {
    answer({ total: 4, ready: 4, cannotSignIn: [] });
    render(<SignInReadinessCard />);
    expect(await screen.findByText(/Nobody would be locked out/)).toBeDefined();
  });

  it('a failed load is an ERROR, never a confident zero', async () => {
    answer({ error: 'readiness_failed' }, 503);
    render(<SignInReadinessCard />);
    expect(await screen.findByRole('alert')).toBeDefined();
    expect(screen.queryByText(/Nobody would be locked out/)).toBeNull();
  });

  it('after the flip, disappears once nobody is locked out', async () => {
    process.env.NEXT_PUBLIC_FLAG_MEMBERS_ONLY = 'true';
    answer({ total: 4, ready: 4, cannotSignIn: [] });
    const { container } = render(<SignInReadinessCard />);
    await new Promise((r) => setTimeout(r, 20));
    expect(container.textContent).toBe('');
  });

  it('after the flip, still shows anyone who is locked out', async () => {
    process.env.NEXT_PUBLIC_FLAG_MEMBERS_ONLY = 'true';
    answer({ total: 4, ready: 3, cannotSignIn: ['Kento'] });
    render(<SignInReadinessCard />);
    expect(await screen.findByText('Kento')).toBeDefined();
    expect(screen.getByText(/locked out until you let them in/)).toBeDefined();
  });
});
