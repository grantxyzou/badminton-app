// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import RegisterSwitch from '../../components/primitives/RegisterSwitch';

/**
 * The register switch Stats and Stringing share (docs/plans/stringing-tabs.md).
 * One component so the two tab bars cannot drift: same track, same pill, same
 * way of saying which one you are on.
 */
describe('RegisterSwitch', () => {
  afterEach(() => cleanup());

  const VIEWS = ['racket', 'strings', 'bench'] as const;
  const labels = { racket: 'Racket', strings: 'Strings', bench: 'Bench' };

  it('marks the current register, and only that one', () => {
    render(<RegisterSwitch views={VIEWS} value="strings" onChange={() => {}} label={(v) => labels[v]} ariaLabel="Stringing" />);
    const current = screen.getByRole('button', { name: 'Strings' });
    expect(current.getAttribute('aria-current')).toBe('page');
    expect(current.className).toContain('segment-tab-active');
    for (const other of ['Racket', 'Bench']) {
      const b = screen.getByRole('button', { name: other });
      expect(b.getAttribute('aria-current')).toBeNull();
      expect(b.className).toContain('segment-tab-inactive');
    }
  });

  it('asks for the register that was tapped', () => {
    const onChange = vi.fn();
    render(<RegisterSwitch views={VIEWS} value="racket" onChange={onChange} label={(v) => labels[v]} ariaLabel="Stringing" />);
    fireEvent.click(screen.getByRole('button', { name: 'Bench' }));
    expect(onChange).toHaveBeenCalledWith('bench');
  });

  it('is the shared segment track, full width, with the group named', () => {
    render(<RegisterSwitch views={VIEWS} value="racket" onChange={() => {}} label={(v) => labels[v]} ariaLabel="Stringing" />);
    const group = screen.getByRole('group', { name: 'Stringing' });
    expect(group.className).toContain('segment-control');
    expect(group.className).toContain('w-full');
    expect(group.className).toContain('flex');
  });
});
