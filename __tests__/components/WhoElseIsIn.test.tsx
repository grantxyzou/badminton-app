// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import enMessages from '../../messages/en.json';
import WhoElseIsIn from '@/components/home/WhoElseIsIn';

afterEach(cleanup);

function renderRow(names: string[], me: string | null) {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <WhoElseIsIn names={names} me={me} />
    </NextIntlClientProvider>,
  );
}

describe('WhoElseIsIn', () => {
  it('renders nothing when nobody else is in', () => {
    const { container } = renderRow(['Lin'], 'lin');
    expect(container.firstChild).toBeNull();
  });

  it('names one person', () => {
    renderRow(['Viktor'], 'Lin');
    expect(screen.getByText('Viktor is in')).toBeDefined();
  });

  it('names two, newest first', () => {
    renderRow(['Viktor', 'Akane'], null);
    expect(screen.getByText('Akane and Viktor are in')).toBeDefined();
  });

  it('names the two newest and counts the rest, leaving the viewer out', () => {
    renderRow(['Viktor', 'Akane', 'Lin', 'Kento', 'Sindhu'], 'Lin');
    expect(screen.getByText('Sindhu, Kento and 2 others are in')).toBeDefined();
  });

  it('shows at most three faces', () => {
    const { container } = renderRow(['A', 'B', 'C', 'D', 'E'], null);
    expect(container.querySelectorAll('.member-avatar')).toHaveLength(3);
  });
});
