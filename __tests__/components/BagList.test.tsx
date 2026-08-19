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

  // THE invariant this component exists to hold. BagList used to hide itself
  // below two rackets, which was fine inside the picker sheet and wrong the
  // moment the tab became the bag: it left a one-racket player with no way to
  // remove or replace the racket they own. If this test ever goes red because
  // the guard came back, the guard is the bug.
  it('renders the single racket, removable, when the bag holds exactly one', () => {
    const onRemove = vi.fn();
    renderBag({ items: [ITEMS[0]], activeId: 'a', onRemove });
    expect(screen.getByText('Yonex Astrox 100ZZ')).toBeTruthy();
    expect(screen.getByText('Using today')).toBeTruthy();

    fireEvent.click(screen.getByLabelText('Remove — Yonex Astrox 100ZZ'));
    expect(onRemove).toHaveBeenCalledWith('a');
  });

  it('renders nothing only when the bag is genuinely empty', () => {
    const { container } = renderBag({ items: [] });
    expect(container.textContent).toBe('');
  });

  it('disables every action while a write is in flight', () => {
    renderBag({ busy: true });
    for (const button of screen.getAllByRole('button')) {
      expect((button as HTMLButtonElement).disabled).toBe(true);
    }
  });
});
