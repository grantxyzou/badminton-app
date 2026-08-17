// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import BagList from '../../components/stats/BagList';
import enMessages from '../../messages/en.json';
import type { GearItem } from '../../lib/types';

afterEach(cleanup);

const ITEMS: GearItem[] = [
  { id: 'a', catalogId: 'racket-a', category: 'racket', label: 'Yonex Astrox 100ZZ' },
  { id: 'b', catalogId: 'racket-b', category: 'racket', label: 'Victor DriveX 9X' },
];

function renderBag(props: Partial<React.ComponentProps<typeof BagList>> = {}) {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <BagList items={ITEMS} activeId="a" onActivate={vi.fn()} onRemove={vi.fn()} busy={false} {...props} />
    </NextIntlClientProvider>,
  );
}

describe('BagList', () => {
  it('lists every racket and marks the active one', () => {
    renderBag();
    expect(screen.getByText('Yonex Astrox 100ZZ')).toBeTruthy();
    expect(screen.getByText('Victor DriveX 9X')).toBeTruthy();
    expect(screen.getByText('Using today')).toBeTruthy();
  });

  it('activates an inactive racket on tap', () => {
    const onActivate = vi.fn();
    renderBag({ onActivate });
    fireEvent.click(screen.getByLabelText('Use this one — Victor DriveX 9X'));
    expect(onActivate).toHaveBeenCalledWith('b');
  });

  // Tapping the racket you are already using should do nothing, not re-POST.
  it('does not re-activate the racket already in use', () => {
    const onActivate = vi.fn();
    renderBag({ onActivate });
    expect(screen.queryByLabelText('Use this one — Yonex Astrox 100ZZ')).toBeNull();
    expect(onActivate).not.toHaveBeenCalled();
  });

  it('removes on tap', () => {
    const onRemove = vi.fn();
    renderBag({ onRemove });
    fireEvent.click(screen.getByLabelText('Remove — Victor DriveX 9X'));
    expect(onRemove).toHaveBeenCalledWith('b');
  });

  // Single-racket players see no bag — the experience is unchanged from today.
  it('renders nothing with fewer than two rackets', () => {
    const { container } = renderBag({ items: [ITEMS[0]] });
    expect(container.textContent).toBe('');
  });

  it('disables every action while a write is in flight', () => {
    renderBag({ busy: true });
    for (const button of screen.getAllByRole('button')) {
      expect((button as HTMLButtonElement).disabled).toBe(true);
    }
  });
});
