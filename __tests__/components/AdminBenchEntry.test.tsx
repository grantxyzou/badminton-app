// @vitest-environment jsdom
// @vitest-environment-options { "url": "http://localhost:3000/bpm" }
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import CommandCenter from '../../components/admin/CommandCenter/CommandCenter';
import enMessages from '../../messages/en.json';

/**
 * Can an admin actually REACH the bench?
 *
 * This file exists because of a bug that every other test missed. The bench
 * entry point was first added to the `btn-ghost` row in AdminDashboard that
 * holds Members / Birds / Releases — a row belonging to the pre-Command-Center
 * layout, which is not rendered at all once NEXT_PUBLIC_FLAG_COMMAND_CENTER is
 * on. It is on in dev and in production. So the button existed, compiled,
 * passed 2199 tests, and could not be tapped by anybody.
 *
 * Route tests, unit tests and the bench's own component tests all still passed,
 * because each of them reached the feature by importing it directly. Nothing
 * asked the question a person asks: is there a way in from the screen I am on.
 */
const FLAG = 'NEXT_PUBLIC_FLAG_STRINGING';
const before = process.env[FLAG];

function renderCenter() {
  const setView = vi.fn();
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <CommandCenter refreshKey={0} setView={setView} onExit={() => {}} />
    </NextIntlClientProvider>,
  );
  return setView;
}

beforeEach(() => {
  vi.stubGlobal('navigator', { ...global.navigator, onLine: true });
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) } as Response),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  if (before === undefined) delete process.env[FLAG];
  else process.env[FLAG] = before;
});

describe('the bench is reachable from the admin screen that actually renders', () => {
  it('offers a Stringing bench row when the flag is on', () => {
    process.env[FLAG] = 'true';
    renderCenter();
    expect(screen.getByRole('button', { name: /Stringing bench/i })).toBeDefined();
  });

  it('opens the bench view when tapped', () => {
    process.env[FLAG] = 'true';
    const setView = renderCenter();
    screen.getByRole('button', { name: /Stringing bench/i }).click();
    expect(setView).toHaveBeenCalledWith('stringing');
  });

  it('hides it entirely when the flag is off', () => {
    process.env[FLAG] = 'false';
    renderCenter();
    expect(screen.queryByRole('button', { name: /Stringing bench/i })).toBeNull();
    // The rest of the list is untouched — the flag hides one row, not the menu.
    expect(screen.getByRole('button', { name: /Past sessions/i })).toBeDefined();
  });
});
