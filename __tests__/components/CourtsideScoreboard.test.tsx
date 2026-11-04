// @vitest-environment jsdom
// @vitest-environment-options { "url": "http://localhost:3000/bpm" }
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import enMessages from '../../messages/en.json';
import CourtsideScoreboard from '../../components/stats/CourtsideScoreboard';

/**
 * The courtside scoreboard keeps a game by the umpire's rules and hands it to
 * Add a game on Save (docs/plans/foldable-layout.md, step 3). jsdom knows no
 * fold, so the board splits at the centre — the same board a flat phone gets.
 */
function renderBoard(onSave: ((s: { a: number; b: number }) => void) | null = vi.fn(), onClose = vi.fn()) {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <CourtsideScoreboard open onClose={onClose} onSave={onSave} />
    </NextIntlClientProvider>,
  );
}

const pointA = () => fireEvent.click(screen.getByRole('button', { name: '+1 A side' }));
const pointB = () => fireEvent.click(screen.getByRole('button', { name: '+1 B side' }));
const scoreA = () => screen.getByTestId('score-a').textContent;
const scoreB = () => screen.getByTestId('score-b').textContent;

describe('CourtsideScoreboard', () => {
  afterEach(cleanup);

  it('opens at love all with the hint, and counts a point for each side', () => {
    renderBoard();
    expect(screen.getByRole('dialog', { name: 'Courtside score' })).toBeTruthy();
    expect(scoreA()).toBe('0');
    expect(scoreB()).toBe('0');
    expect(screen.getByText(/Prop the phone half-open/)).toBeTruthy();
    pointA();
    pointB();
    pointB();
    expect(scoreA()).toBe('1');
    expect(scoreB()).toBe('2');
    // The server is whoever won the last rally.
    expect(screen.getByText('B side serving')).toBeTruthy();
  });

  it('calls game point, "20 all" and "29 all · next point wins" in the umpire\'s words', () => {
    renderBoard();
    for (let i = 0; i < 20; i++) pointA();
    expect(screen.getByText('Game point · A side')).toBeTruthy();
    for (let i = 0; i < 20; i++) pointB();
    expect(screen.getByText('20 all')).toBeTruthy();
    for (let i = 0; i < 9; i++) {
      pointA();
      pointB();
    }
    expect(scoreA()).toBe('29');
    expect(screen.getByText('29 all · next point wins')).toBeTruthy();
  });

  it('ends the game at 21 won by two, stops scoring, and marks the winner', () => {
    renderBoard();
    for (let i = 0; i < 21; i++) pointA();
    const over = screen.getByText('Game · A side');
    expect(over).toBeTruthy();
    // The one consequential moment takes the celebrate entrance; every other
    // line, and every new digit, takes the plain appear fade.
    expect(over.className).toContain('status-celebrate');
    expect(over.getAttribute('data-over')).toBe('true');
    expect(screen.getByTestId('score-a').className).toContain('motion-fade');
    expect(screen.getByRole('button', { name: '+1 A side' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByTestId('score-a').closest('.courtside-side')?.getAttribute('data-winner')).toBe('true');
  });

  it('shows the interval when the leader first reaches 11', () => {
    vi.useFakeTimers();
    try {
      renderBoard();
      for (let i = 0; i < 11; i++) pointA();
      expect(screen.getByText('Interval')).toBeTruthy();
      act(() => {
        vi.advanceTimersByTime(4500);
      });
      expect(screen.queryByText('Interval')).toBeNull();
      expect(screen.getByText('A side serving')).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it('Undo takes back the last point and New game clears the board', () => {
    renderBoard();
    pointA();
    pointA();
    pointB();
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(scoreA()).toBe('2');
    expect(scoreB()).toBe('0');
    fireEvent.click(screen.getByRole('button', { name: 'New game' }));
    expect(scoreA()).toBe('0');
    expect(screen.getByRole('button', { name: 'Undo' }).hasAttribute('disabled')).toBe(true);
  });

  it('Save hands the score over; with no session it is disabled and says why', () => {
    const onSave = vi.fn();
    renderBoard(onSave);
    pointA();
    pointA();
    pointB();
    fireEvent.click(screen.getByRole('button', { name: 'Save game' }));
    expect(onSave).toHaveBeenCalledWith({ a: 2, b: 1 });
    cleanup();

    renderBoard(null);
    pointA();
    expect(screen.getByRole('button', { name: 'Save game' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByText("Saving needs this week's session to log into.")).toBeTruthy();
  });

  it('Close and Escape both close it; closed, it renders nothing', () => {
    const onClose = vi.fn();
    renderBoard(vi.fn(), onClose);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(2);
    cleanup();
    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <CourtsideScoreboard open={false} onClose={onClose} onSave={null} />
      </NextIntlClientProvider>,
    );
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('writes the split onto the element when it opens LATER, not only when mounted open', () => {
    // The real sequence: Stats is on screen, the viewport is measured, then
    // someone taps Keep score. The split has not changed since the last
    // render, so an effect keyed on the split alone would skip the element
    // that just mounted (found on screen 2026-11-04).
    const onClose = vi.fn();
    const { rerender } = render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <CourtsideScoreboard open={false} onClose={onClose} onSave={null} />
      </NextIntlClientProvider>,
    );
    expect(screen.queryByRole('dialog')).toBeNull();
    rerender(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <CourtsideScoreboard open onClose={onClose} onSave={null} />
      </NextIntlClientProvider>,
    );
    const board = screen.getByRole('dialog');
    expect(board.style.getPropertyValue('--court-first')).toMatch(/^\d+px$/);
    expect(board.style.getPropertyValue('--court-gap')).toBe('0px');
    expect(board.style.getPropertyValue('--court-second')).toMatch(/^\d+px$/);
  });

  it('with no fold known, splits at the centre with an empty gap', () => {
    renderBoard();
    const board = screen.getByRole('dialog');
    // Opens with the Appear recipe (opacity only; reduced motion keeps it).
    expect(board.className).toContain('motion-fade');
    expect(board.getAttribute('data-posture')).toBe('unknown');
    expect(['horizontal', 'vertical']).toContain(board.getAttribute('data-axis'));
    expect(board.style.getPropertyValue('--court-gap')).toBe('0px');
  });
});
