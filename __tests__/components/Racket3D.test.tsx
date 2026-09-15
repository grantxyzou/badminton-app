// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import Racket3D from '../../components/stats/Racket3D';

afterEach(cleanup);

describe('Racket3D', () => {
  it('without WebGL the racket is still shown — the pre-rendered image stays', async () => {
    const { container } = render(
      <Racket3D look={{ frame: '#23282c', accent: '#16a34a', grip: '#16191c' }} tweaks={{}} fallbackSrc="/bpm/rackets/_default.webp" label="A racket in 3D" />,
    );
    expect(screen.getByRole('img', { name: 'A racket in 3D' })).toBeTruthy();
    // jsdom has no WebGL context: the component gives up on the canvas.
    await waitFor(() => expect(container.querySelector('canvas')).toBeNull());
    expect(container.querySelector('img')?.getAttribute('src')).toBe('/bpm/rackets/_default.webp');
  });
});
