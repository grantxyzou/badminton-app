// @vitest-environment jsdom
// @vitest-environment-options { "url": "http://localhost:3000/bpm" }
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import enMessages from '../../messages/en.json';
import type { DualScreenInfo } from '../../lib/fold';

/**
 * The outer-screen probe on the courtside board
 * (docs/plans/outer-screen-scoreboard.md, step 1). The answer comes from the
 * store app's plugin, faked here through `useDualScreen`; the board shows one
 * Preview line for a phone with an outer screen and nothing anywhere else.
 */
let answer: DualScreenInfo | null = null;
vi.mock('../../lib/fold', async (importActual) => ({
  ...(await importActual<typeof import('../../lib/fold')>()),
  useDualScreen: () => answer,
}));

import CourtsideScoreboard from '../../components/stats/CourtsideScoreboard';

function renderBoard() {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <CourtsideScoreboard open onClose={vi.fn()} onSave={vi.fn()} />
    </NextIntlClientProvider>,
  );
}

const line = () => screen.queryByTestId('outer-screen-probe')?.textContent ?? null;

describe('CourtsideScoreboard outer-screen probe', () => {
  afterEach(() => {
    cleanup();
    answer = null;
  });

  it('a browser, or a build without the probe: nothing', () => {
    renderBoard();
    expect(line()).toBeNull();
  });

  it('a phone with one screen: nothing, even though dual-screen reads unsupported', () => {
    answer = { outerScreen: false, dualScreen: 'unsupported', rearDisplay: 'unsupported' };
    renderBoard();
    expect(line()).toBeNull();
  });

  it.each([
    ['available', 'Outer screen: this phone can show the score there.'],
    ['unavailable', 'Outer screen: supported, but not right now. Open the phone flat and try again.'],
    ['active', 'Outer screen: another app is using it.'],
    ['unsupported', 'Outer screen: this phone can’t show the score there.'],
    ['unknown', 'Outer screen: still checking…'],
  ] as const)('a foldable answering %s says so, marked Preview', (status, text) => {
    answer = { outerScreen: true, dualScreen: status, rearDisplay: 'available' };
    renderBoard();
    expect(line()).toBe(`Preview ${text}`);
  });
});
