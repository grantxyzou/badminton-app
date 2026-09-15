// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import enMessages from '../../messages/en.json';

/**
 * The page a Google/Apple sign-in lands on when the APP finishes it. The one
 * thing it must never do is hand the return code to a window that is not ours;
 * the one thing it must always do is show the typed code when nothing heard it.
 */

const CODE = 'd'.repeat(64);

async function renderAt(hash: string, opener: unknown) {
  vi.resetModules(); // the page reads its fragment once per module load
  window.history.replaceState(null, '', `/bpm/auth/done?provider=google${hash}`);
  Object.defineProperty(window, 'opener', { value: opener, configurable: true });
  const { default: HandoffDone } = await import('../../components/auth/HandoffDone');
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <HandoffDone />
    </NextIntlClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  Object.defineProperty(window, 'opener', { value: null, configurable: true });
});

describe('/bpm/auth/done', () => {
  it('with no opener, shows the typed code at once and strips the fragment', async () => {
    await renderAt('#tc=482913', null);
    expect(screen.getByTestId('handoff-typed-code').textContent).toBe('482 913');
    expect(window.location.hash).toBe('');
  });

  it('posts the return code ONLY to the recorded opener origin, and never shows the code once acknowledged', async () => {
    vi.useFakeTimers();
    const opener = { postMessage: vi.fn() };
    const ho = encodeURIComponent('https://bpm.grantzou.com');
    await renderAt(`#hc=${CODE}&ho=${ho}&tc=482913`, opener);

    expect(opener.postMessage).toHaveBeenCalledWith({ type: 'bpm-handoff', returnCode: CODE }, 'https://bpm.grantzou.com');
    const close = vi.spyOn(window, 'close').mockImplementation(() => {});
    act(() => {
      window.dispatchEvent(new MessageEvent('message', { data: { type: 'bpm-handoff-ack' } }));
    });
    // A message from anywhere but the opener is not an acknowledgement.
    expect(screen.queryByText(/You're signed in/)).toBeNull();
    close.mockRestore();
  });

  it('falls back to the typed code when the opener never acknowledges', async () => {
    vi.useFakeTimers();
    const opener = { postMessage: vi.fn() };
    await renderAt(`#hc=${CODE}&ho=${encodeURIComponent('https://bpm.grantzou.com')}&tc=482913`, opener);
    expect(screen.queryByTestId('handoff-typed-code')).toBeNull();
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(screen.getByTestId('handoff-typed-code').textContent).toBe('482 913');
  });

  it('with no opener origin, posts nothing at all', async () => {
    const opener = { postMessage: vi.fn() };
    await renderAt(`#hc=${CODE}&tc=482913`, opener);
    expect(opener.postMessage).not.toHaveBeenCalled();
    expect(screen.getByTestId('handoff-typed-code')).toBeTruthy();
  });
});
