// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import KudosRosterHint from '../../components/KudosRosterHint';
import { isoWeekKey } from '../../lib/kudos';
import enMessages from '../../messages/en.json';

const KEY = 'badminton_kudos_hint_dismissed';
const HINT = /Tap the heart next to someone/;

function wrap() {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <KudosRosterHint />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => localStorage.clear());
afterEach(() => cleanup());

describe('KudosRosterHint', () => {
  it('shows until dismissed, then stays hidden for the week', () => {
    wrap();
    expect(screen.getByText(HINT)).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Hide this tip' }));
    expect(screen.queryByText(HINT)).toBeNull();
    expect(localStorage.getItem(KEY)).toBe(isoWeekKey(new Date()));
  });

  it('stays hidden when dismissed this week', () => {
    localStorage.setItem(KEY, isoWeekKey(new Date()));
    wrap();
    expect(screen.queryByText(HINT)).toBeNull();
  });

  it('comes back the week after', () => {
    localStorage.setItem(KEY, '2020-W01');
    wrap();
    expect(screen.getByText(HINT)).toBeDefined();
  });
});
