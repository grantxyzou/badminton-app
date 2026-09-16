// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import enMessages from '../../messages/en.json';
import WhoElseIsIn from '@/components/home/WhoElseIsIn';

afterEach(cleanup);

function renderRow(active: string[], me: string | null) {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <WhoElseIsIn active={active} me={me} />
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

  it('is a disclosure: tapping the row opens the numbered roster, the viewer marked', () => {
    const { container } = renderRow(['Viktor', 'Akane', 'Lin', 'Kento'], 'Lin');
    const row = screen.getByRole('button', { name: /are in/ });
    expect(row.getAttribute('aria-expanded')).toBe('false');
    // Closed means absent, not hidden.
    expect(screen.queryByRole('list')).toBeNull();

    fireEvent.click(row);
    expect(row.getAttribute('aria-expanded')).toBe('true');
    const items = screen.getAllByRole('listitem').map((li) => li.textContent);
    expect(items).toEqual(['1VViktor', '2AAkane', '3LLin', '4KKento']);
    expect(container.querySelectorAll('.player-highlight-green')).toHaveLength(1);
    expect(container.querySelector('.player-highlight-green')?.textContent).toContain('Lin');
    expect(row.getAttribute('aria-controls')).toBe(screen.getByRole('list').closest('[id]')?.id);
  });

  it('draws no kudos buttons unless the card passes a handler', () => {
    renderRow(['Viktor', 'Lin'], 'Lin');
    fireEvent.click(screen.getByRole('button', { name: /is in/ }));
    expect(screen.queryByRole('button', { name: /Give kudos/ })).toBeNull();
  });
});
