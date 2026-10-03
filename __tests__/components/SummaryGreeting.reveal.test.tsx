// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import enMessages from '../../messages/en.json';

/**
 * Loading cascade, phase 3. Before the active name resolves, useInsight reports
 * `loading: false` with nothing asked. SummaryGreeting took that as "ready, and
 * nothing to show", the You register let every card below it through, and the
 * greeting then landed on top of them — seen in a browser with a slow insight
 * read. It must report ready only on an ANSWER.
 */
const insight = vi.hoisted(() => ({ value: { data: null, loading: false, error: false, forbidden: false, serverError: false, reload: () => {} } as Record<string, unknown> }));
const active = vi.hoisted(() => ({ value: { name: null as string | null, resolved: false } }));
vi.mock('@/lib/useInsight', () => ({ useInsight: () => insight.value }));
vi.mock('@/lib/useActiveName', () => ({ useActiveName: () => active.value }));

import SummaryGreeting from '@/components/stats/SummaryGreeting';
import { RevealGroup, RevealSlot } from '@/components/primitives/Reveal';

afterEach(cleanup);

function YouRegister() {
  return (
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <RevealGroup>
        <RevealSlot canBeEmpty placeholder={<div>greeting skeleton</div>}><SummaryGreeting /></RevealSlot>
        <RevealSlot ready placeholder={<div>trend skeleton</div>}><p>trend card</p></RevealSlot>
      </RevealGroup>
    </NextIntlClientProvider>
  );
}

const visible = (t: string) => {
  const el = screen.queryByText(t);
  return !!el && !el.closest('[hidden]');
};

describe('SummaryGreeting in a RevealSlot', () => {
  it('holds the cards below while the name is unresolved', () => {
    active.value = { name: null, resolved: false };
    render(<YouRegister />);
    expect(visible('trend card')).toBe(false);
    expect(visible('greeting skeleton')).toBe(true);
  });

  it('holds them while the insight is still being asked', () => {
    active.value = { name: 'Lin', resolved: true };
    insight.value = { ...insight.value, data: null, loading: true };
    render(<YouRegister />);
    expect(visible('trend card')).toBe(false);
  });

  it('lets them through once the insight answered, even with nothing to say', () => {
    active.value = { name: 'Lin', resolved: true };
    insight.value = { ...insight.value, data: { greeting: null }, loading: false };
    render(<YouRegister />);
    expect(visible('trend card')).toBe(true);
  });
});
