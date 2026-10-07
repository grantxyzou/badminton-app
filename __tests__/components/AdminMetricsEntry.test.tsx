// @vitest-environment jsdom
// @vitest-environment-options { "url": "http://localhost:3000/bpm" }
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import CommandCenter from '../../components/admin/CommandCenter/CommandCenter';
import enMessages from '../../messages/en.json';

/**
 * Is there a way in to the Metrics page from the admin screen that renders?
 * The same question AdminBenchEntry.test.tsx asks of the stringing bench,
 * after that entry shipped somewhere nobody could tap it.
 */
beforeEach(() => {
  vi.stubGlobal('navigator', { ...global.navigator, onLine: true });
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) } as Response));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('the Metrics page is reachable from the Command Center', () => {
  it('has a Metrics row that opens the metrics view', async () => {
    const setView = vi.fn();
    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <CommandCenter refreshKey={0} setView={setView} onExit={() => {}} />
      </NextIntlClientProvider>,
    );
    (await screen.findByRole('button', { name: /^Metrics/i })).click();
    expect(setView).toHaveBeenCalledWith('metrics');
  });
});
