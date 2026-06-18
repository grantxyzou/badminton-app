// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import ListRow from '../../components/primitives/ListRow';

describe('ListRow', () => {
  afterEach(() => cleanup());

  it('renders title, subtitle, leading and trailing slots', () => {
    render(
      <ListRow
        leading={<span>L</span>}
        title="Row title"
        subtitle="Row subtitle"
        trailing={<span>T</span>}
      />,
    );
    expect(screen.getByText('Row title')).toBeTruthy();
    expect(screen.getByText('Row subtitle')).toBeTruthy();
    expect(screen.getByText('L')).toBeTruthy();
    expect(screen.getByText('T')).toBeTruthy();
  });

  it('is a plain div (no button) when no onClick', () => {
    render(<ListRow title="static" />);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('renders as a tappable cc-mini-card button when onClick is given', () => {
    const onClick = vi.fn();
    render(<ListRow title="tap me" onClick={onClick} ariaLabel="tap me" />);
    const btn = screen.getByRole('button', { name: 'tap me' });
    expect(btn.className).toContain('cc-mini-card');
    fireEvent.click(btn);
    expect(onClick).toHaveBeenCalledOnce();
  });
});
