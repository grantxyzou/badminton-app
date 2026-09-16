// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
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

  it('shows at most five faces, then a count of the rest', () => {
    const { container } = renderRow(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'], null);
    expect(container.querySelectorAll('.avatar-stack .member-avatar')).toHaveLength(5);
    expect(screen.getByText('+3')).toBeDefined();
  });

  it('draws no count chip when every face fits', () => {
    const { container } = renderRow(['A', 'B', 'C'], null);
    expect(container.querySelector('.avatar-stack__more')).toBeNull();
  });

  it('is a disclosure: tapping the row lists everyone else who is in', () => {
    renderRow(['Viktor', 'Akane', 'Lin', 'Kento'], 'Lin');
    const row = screen.getByRole('button', { name: /are in/ });
    expect(row.getAttribute('aria-expanded')).toBe('false');
    // Closed means absent, not hidden.
    expect(screen.queryByRole('list')).toBeNull();

    fireEvent.click(row);
    expect(row.getAttribute('aria-expanded')).toBe('true');
    const items = screen.getAllByRole('listitem').map((li) => li.textContent);
    expect(items).toEqual(['KKento', 'AAkane', 'VViktor']);
    expect(row.getAttribute('aria-controls')).toBe(screen.getByRole('list').closest('[id]')?.id);
  });
});
