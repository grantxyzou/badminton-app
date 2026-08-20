// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import GearRegister from '../../components/stats/GearRegister';
import enMessages from '../../messages/en.json';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('GearRegister — single owner of the gear document', () => {
  beforeEach(() => {
    global.fetch = vi.fn().mockImplementation((_url: string) =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({ gear: null, items: [], entries: [] }) }),
    ) as unknown as typeof fetch;
  });

  it('issues exactly ONE GET /api/equipment/gear per mount', async () => {
    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <GearRegister activeName="Lin" />
      </NextIntlClientProvider>,
    );

    await waitFor(() => {
      const calls = (global.fetch as ReturnType<typeof vi.fn>).mock.calls
        .map((c) => String(c[0]))
        .filter((u) => u.includes('/api/equipment/gear') && !u.includes('method'));
      expect(calls.length).toBe(1);
    });
  });
});
