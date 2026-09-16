// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import StringingTab from '../../components/StringingTab';
import SkillsTab from '../../components/SkillsTab';
import AdminTab from '../../components/AdminTab';
import enMessages from '../../messages/en.json';

describe('PageHeaders', () => {
  beforeEach(() => {
    // Stub fetch so tabs that fire requests in useEffect don't hit the network.
    // A never-resolving promise keeps the component in its initial state so we
    // can assert on the header without waiting for async data.
    global.fetch = vi.fn().mockImplementation(() => new Promise(() => {})) as unknown as typeof fetch;
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('StringingTab renders "Stringing" as an h1', () => {
    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <StringingTab />
      </NextIntlClientProvider>
    );
    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading.textContent).toBe('Stringing');
  });

  // One case, not two: Stage 8 removed the admin-only radar arrangement, so
  // `SkillsTab` no longer takes `isAdmin` and there is nothing to vary.
  it('SkillsTab renders "Your stats" as an h1', () => {
    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <SkillsTab />
      </NextIntlClientProvider>
    );
    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading.textContent).toBe('Your stats');
  });

  it('AdminTab renders "Admin" as an h1', () => {
    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <AdminTab onExit={() => {}} />
      </NextIntlClientProvider>
    );
    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading.textContent).toBe('Admin');
  });
});
