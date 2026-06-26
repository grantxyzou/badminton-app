// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import InstallSheet from '../../components/InstallSheet';
import enMessages from '../../messages/en.json';

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
