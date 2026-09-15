// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import TopToast, { type TopToastContent } from '../../components/primitives/TopToast';
import enMessages from '../../messages/en.json';

/**
 * The floating top message. Two behaviours matter and neither is visible in a
 * screenshot of one frame: it must keep its last content while it slides away
 * (or the exit has nothing to animate), and a message with no ✕ is one that
 * clears itself (offline) — offering a close there would dismiss a fact.
 */
afterEach(cleanup);

const signedIn: TopToastContent = { id: 'a', tone: 'success', icon: 'check_circle', title: "You're signed in" };

function wrap(ui: React.ReactNode) {
  return <NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>;
}

describe('TopToast', () => {
  it('shows the message and closes from the ✕', () => {
    const onClose = vi.fn();
    const { container } = render(wrap(<TopToast content={signedIn} onClose={onClose} />));
    expect(container.querySelector('.top-toast')?.getAttribute('data-open')).toBe('true');
    expect(screen.getByText("You're signed in")).toBeDefined();
    fireEvent.click(screen.getByRole('button'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('has no ✕ when the caller gives no way to close it', () => {
    render(wrap(<TopToast content={{ ...signedIn, id: 'offline', tone: 'warn', title: "You're offline" }} />));
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('keeps its last message while closing, hidden from assistive tech', () => {
    const { container, rerender } = render(wrap(<TopToast content={signedIn} onClose={() => {}} />));
    rerender(wrap(<TopToast content={null} onClose={() => {}} />));
    const root = container.querySelector('.top-toast')!;
    expect(root.getAttribute('data-open')).toBe('false');
    expect(root.getAttribute('aria-hidden')).toBe('true');
    // Still there to slide away.
    expect(screen.getByText("You're signed in")).toBeDefined();
  });

  it('swaps to a new message by id', () => {
    const { rerender } = render(wrap(<TopToast content={signedIn} />));
    rerender(wrap(<TopToast content={{ ...signedIn, id: 'b', title: 'Email confirmed' }} />));
    expect(screen.getByText('Email confirmed')).toBeDefined();
    expect(screen.queryByText("You're signed in")).toBeNull();
  });

  it('announces a problem assertively and good news politely', () => {
    const { rerender } = render(wrap(<TopToast content={signedIn} />));
    expect(screen.getByRole('status')).toBeDefined();
    rerender(wrap(<TopToast content={{ ...signedIn, id: 'c', tone: 'danger', title: 'Sign-in failed' }} />));
    expect(screen.getByRole('alert')).toBeDefined();
  });

  it('draws a countdown ring around the ✕ for exactly the message\u2019s lifetime', () => {
    const { container } = render(wrap(<TopToast content={{ ...signedIn, durationMs: 6000 }} onClose={() => {}} />));
    const ring = container.querySelector('.top-toast-ring') as SVGElement | null;
    expect(ring).not.toBeNull();
    expect(ring!.style.getPropertyValue('--toast-duration')).toBe('6000ms');
    expect(container.querySelector('.top-toast-ring-fill')).not.toBeNull();
  });

  it('has no ring without a duration, and none on a message with no ✕', () => {
    const { container, rerender } = render(wrap(<TopToast content={signedIn} onClose={() => {}} />));
    expect(container.querySelector('.top-toast-ring')).toBeNull();
    rerender(wrap(<TopToast content={{ ...signedIn, id: 'offline', durationMs: 6000 }} />));
    expect(container.querySelector('.top-toast-ring')).toBeNull();
  });
});
