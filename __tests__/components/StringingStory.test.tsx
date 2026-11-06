// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import enMessages from '../../messages/en.json';
import StringingStory from '../../components/stringing/StringingStory';

/**
 * Grant, 2026-11-05: "a step by step animation when user send in an request …
 * Racket goes on to [the] machine > stringing through a racket > off machine >
 * tada", with "the string package tears open at the top". docs/plans/stringing-story.md
 */
afterEach(cleanup);

function show(props: Partial<React.ComponentProps<typeof StringingStory>> = {}) {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <StringingStory racketId="racket-li-ning-halbertec-9000" stringId="string-yx-bg80" stringName="Yonex BG80" tension="26" {...props} />
    </NextIntlClientProvider>,
  );
}

describe('StringingStory', () => {
  it('tells the five steps in the member\'s own string and tension', () => {
    const { container } = show();
    const caps = [...container.querySelectorAll('.ss-cap')].map((p) => p.textContent);
    expect(caps).toEqual([
      'Opening a fresh set of Yonex BG80',
      'Onto the stringing machine',
      'Stringing at 26 lb, mains then crosses',
      'Off the machine',
      "Ready to pick up. We'll let you know.",
    ]);
    expect(container.querySelector('.ss-done')?.textContent).toContain('Ready · Yonex BG80 at 26 lb');
  });

  it('strings the member\'s own racket: the bare frame under the strung picture', () => {
    const { container } = show();
    const srcs = [...container.querySelectorAll('.ss-racket img')].map((i) => i.getAttribute('src'));
    expect(srcs[0]).toMatch(/\/rackets\/bare\/racket-li-ning-halbertec-9000\.webp$/);
    expect(srcs[1]).toMatch(/\/rackets\/racket-li-ning-halbertec-9000\.webp$/);
  });

  it('tears the string\'s own packet, and draws none for a string without one', () => {
    const { container } = show();
    expect(container.querySelectorAll('.ss-pack')).toHaveLength(2);
    cleanup();
    const bare = show({ stringId: null, stringName: 'My own string' });
    expect(bare.container.querySelectorAll('.ss-pack')).toHaveLength(0);
  });

  it('a typed-in racket draws the default frame', () => {
    const { container } = show({ racketId: null });
    expect(container.querySelector('.ss-racket img')?.getAttribute('src')).toMatch(/\/rackets\/bare\/_default\.webp$/);
  });

  it('the picture is decorative; "Play again" restarts it', () => {
    const { container } = show();
    expect(container.querySelector('.ss-box')?.getAttribute('aria-hidden')).toBe('true');
    const before = container.querySelector('.ss-stage');
    fireEvent.click(screen.getByRole('button', { name: 'Play again' }));
    expect(container.querySelector('.ss-stage')).not.toBe(before);
  });
});
