// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import RacketLookSheet from '../../components/stats/RacketLookSheet';
import enMessages from '../../messages/en.json';
import type { UseGear } from '../../components/stats/useGear';

afterEach(cleanup);

/**
 * A way out of a sheet must never depend on a network write succeeding. The
 * review of #432 found the X and Escape both tried to save first and stayed
 * open on a refusal — offline, the member had no way out but a reload.
 */
describe('RacketLookSheet', () => {
  it('closing discards: the X leaves at once and writes nothing, even offline', () => {
    const setLook = vi.fn(async () => ({ ok: false as const, reason: 'error' as const }));
    const onClose = vi.fn();
    const gear = { setLook, busy: false, online: false } as unknown as UseGear;
    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <RacketLookSheet open onClose={onClose} gear={gear} item={{ id: 'r1', catalogId: null, category: 'racket', label: 'Old frame' }} title="Old frame" />
      </NextIntlClientProvider>,
    );
    // Change a swatch, so there is something a save-on-close would try to write.
    fireEvent.click(screen.getAllByRole('radio')[1]);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(setLook).not.toHaveBeenCalled();
  });
});
