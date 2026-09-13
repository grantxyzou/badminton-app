// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import InstallSheet from '../../components/InstallSheet';
import rawMessages from '../../messages/en.json';
import { brandMessages } from '../../i18n/request';

/* The provider is handed BRANDED messages, because that is what production
   hands it: `app/layout.tsx` passes `getMessages()`, which comes from
   `getRequestConfig` with `brandMessages` already applied. Rendering the raw
   JSON here would assert against copy no user ever sees -- the literal
   `%APP_SHORT%` sentinel rather than the product's name. */
const enMessages = brandMessages(rawMessages);

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function wrap(open: boolean) {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <InstallSheet open={open} onClose={() => {}} />
    </NextIntlClientProvider>,
  );
}

describe('<InstallSheet />', () => {
  it('renders the title and platform steps when open', () => {
    wrap(true);
    expect(screen.getByText('Add BPM to your home screen')).toBeTruthy();
    // jsdom's default UA is not iOS → Android steps lead. Match a unique step.
    expect(screen.getByText(/Tap the menu/i)).toBeTruthy();
    expect(screen.getByText(/Got it/i)).toBeTruthy();
  });

  it('renders nothing while closed', () => {
    const { container } = wrap(false);
    expect(container.textContent).toBe('');
  });
});
