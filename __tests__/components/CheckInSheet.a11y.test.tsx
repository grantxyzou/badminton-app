// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import CheckInSheet from '@/components/stats/CheckInSheet';
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
