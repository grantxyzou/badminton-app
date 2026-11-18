// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import CardSkeleton, {
  TabSkeleton,
  AdminTabSkeleton,
  AdminPageSkeleton,
  CONSOLE_HEIGHTS,
} from '../../components/primitives/CardSkeleton';
import en from '@/messages/en.json';

function withIntl(node: ReactNode) {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      {node}
    </NextIntlClientProvider>,
  );
}

/** The skeleton cards inside a loading frame, in document order. */
function cards(container: HTMLElement) {
  return Array.from(container.querySelectorAll<HTMLElement>('.glass-card'));
}

describe('CardSkeleton', () => {
  afterEach(() => cleanup());

  it('is hidden from screen readers: it is shape, not content', () => {
    const { container } = render(<CardSkeleton />);
    expect(cards(container)[0].getAttribute('aria-hidden')).toBe('true');
  });

  it('reserves the default 96px when no height is given', () => {
    const { container } = render(<CardSkeleton />);
    expect(cards(container)[0].style.height).toBe('96px');
  });

  it('takes the measured height of the card it stands in for', () => {
    const { container } = render(<CardSkeleton height={358} className="extra" />);
    const card = cards(container)[0];
    expect(card.style.height).toBe('358px');
    expect(card.className).toContain('extra');
  });

  it('draws three shimmer lines', () => {
    const { container } = render(<CardSkeleton />);
    expect(container.querySelectorAll('.shimmer-line')).toHaveLength(3);
  });
});

describe('TabSkeleton (Home)', () => {
  afterEach(() => cleanup());

  it('announces itself once, through the translated a11y label', () => {
    withIntl(<TabSkeleton announcement={null} />);
    expect(screen.getByRole('status', { name: en.a11y.loading })).toBeTruthy();
  });

  // Home's week at 430px (2026-11-18): the two tiles, the sign-up card, the
  // level card and the balance row — the last two have slots of their own
  // INSIDE the week's, so only this frame can hold their place while the
  // week loads. Nothing is handed a default: Home always says whether the
  // server found an announcement.
  it('holds the tiles, the sign-up card, the level card and the balance, at the stack gap', () => {
    const { container } = withIntl(<TabSkeleton announcement={null} />);
    expect(cards(container).map((c) => c.style.height)).toEqual(['133px', '133px', '192px', '160px', '50px']);
    expect(container.querySelector('.bpm-home-skeleton')?.className).not.toMatch(/space-y/);
  });

  it('draws the server-rendered announcement for real, in its place, never a shimmer', () => {
    const { container } = withIntl(
      <TabSkeleton announcement={<section className="glass-card" data-announcement="">Courts 3 and 4 tonight</section>} />,
    );
    const all = cards(container);
    expect(all.map((c) => c.style.height)).toEqual(['133px', '133px', '', '192px', '160px', '50px']);
    expect(all[2].getAttribute('data-announcement')).toBe('');
    expect(all[2].getAttribute('aria-hidden')).toBeNull();
  });

});

describe('AdminTabSkeleton', () => {
  afterEach(() => cleanup());

  // The console reads the same CONSOLE_HEIGHTS, so a loading frame that
  // stopped reading them would jump when the console replaced it.
  it("reads the console's own measured heights, in the console's order", () => {
    const { container } = withIntl(<AdminTabSkeleton />);
    expect(cards(container).map((c) => c.style.height)).toEqual([
      `${CONSOLE_HEIGHTS.tile}px`,
      `${CONSOLE_HEIGHTS.tile}px`,
      `${CONSOLE_HEIGHTS.nextSession}px`,
    ]);
    expect(screen.getByRole('status', { name: en.a11y.loading })).toBeTruthy();
  });
});

describe('AdminPageSkeleton', () => {
  afterEach(() => cleanup());

  it('stacks two cards with no header strip (the caller draws the back header)', () => {
    const { container } = withIntl(<AdminPageSkeleton />);
    expect(cards(container).map((c) => c.style.height)).toEqual(['120px', '260px']);
    expect(screen.getByRole('status', { name: en.a11y.loading })).toBeTruthy();
  });
});
