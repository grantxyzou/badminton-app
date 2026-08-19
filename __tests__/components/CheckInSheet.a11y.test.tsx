// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import CheckInSheet from '@/components/stats/CheckInSheet';
import { SKILLS } from '@/lib/assessment';
import enMessages from '@/messages/en.json';

beforeEach(() => {
  // The sheet fetches /api/games for the "mirror" on open — return none.
  global.fetch = vi.fn(async () => new Response(JSON.stringify({ games: [] }), { status: 200 })) as unknown as typeof fetch;
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('CheckInSheet rating anchors — a11y', () => {
  it('anchors expose aria-pressed selection state and hide the decorative icon', () => {
    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <CheckInSheet name="Lin" open onClose={vi.fn()} onSaved={vi.fn()} />
      </NextIntlClientProvider>,
    );

    // Advance from the intro to the first skill's rating anchors.
    fireEvent.click(screen.getByRole('button', { name: 'Start check-in' }));

    const anchors = () => screen.getAllByRole('button').filter((b) => b.hasAttribute('aria-pressed'));
    expect(anchors()).toHaveLength(5);
    expect(anchors()[0].getAttribute('aria-pressed')).toBe('false');

    fireEvent.click(anchors()[0]);

    const after = anchors();
    expect(after[0].getAttribute('aria-pressed')).toBe('true');
    expect(after[1].getAttribute('aria-pressed')).toBe('false');
    // The check_circle selection icon is decorative — must not be announced.
    expect(after[0].querySelector('.material-icons')?.getAttribute('aria-hidden')).toBe('true');
  });
});

describe('CheckInSheet save — 401 needs_signin branch', () => {
  it('shows a distinct sign-in-expired message, not the generic save error', async () => {
    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/games')) return new Response(JSON.stringify({ games: [] }), { status: 200 });
      if (url.includes('/api/assessments')) {
        return new Response(JSON.stringify({ error: 'needs_signin' }), { status: 401 });
      }
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;

    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <CheckInSheet name="Lin" open onClose={vi.fn()} onSaved={vi.fn()} />
      </NextIntlClientProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Start check-in' }));

    // Rate the first skill, then skip the rest to reach the review/save step.
    const anchors = () => screen.getAllByRole('button').filter((b) => b.hasAttribute('aria-pressed'));
    fireEvent.click(anchors()[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    for (let i = 1; i < SKILLS.length; i++) {
      fireEvent.click(screen.getByRole('button', { name: 'Skip' }));
    }

    fireEvent.click(screen.getByRole('button', { name: 'Save check-in' }));

    const alert = await waitFor(() => screen.getByRole('alert'));
    expect(alert.textContent).toBe(enMessages.stats.assess.saveErrorAuth);
    expect(alert.textContent).not.toBe(enMessages.stats.assess.saveError);
  });
});
