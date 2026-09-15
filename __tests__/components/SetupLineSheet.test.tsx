// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import SetupLineSheet from '../../components/stats/SetupLineSheet';
import type { UseGear } from '../../components/stats/useGear';
import { resetCatalogCache } from '../../components/stats/useCatalog';
import { activeRacket, rackets as racketsOf } from '../../lib/activeRacket';
import type { GearItem, PlayerGear } from '../../lib/types';
import enMessages from '../../messages/en.json';

const RACKET: GearItem = { id: 'r1', catalogId: 'rk-af79', category: 'racket', label: 'Li-Ning Air Force 79' };
const STRING: GearItem = { id: 's1', catalogId: null, category: 'string', label: 'Yonex BG65', tensionLbs: 25 };

function fakeGear(items: GearItem[], overrides: Partial<UseGear> = {}): UseGear {
  const d = { id: 'g', memberId: 'm', items, activeRacketId: 'r1', updatedAt: '' } as PlayerGear;
  return {
    gear: d, rackets: racketsOf(d), active: activeRacket(d),
    loaded: true, loadError: false, forbidden: false, busy: false, online: true,
    reload: vi.fn(), add: vi.fn(), addCustom: vi.fn(),
    activate: vi.fn(async () => ({ ok: true as const })),
    remove: vi.fn(async () => ({ ok: true as const })),
    setPrefs: vi.fn(), setTension: vi.fn(async () => ({ ok: true as const })),
    setCrosses: vi.fn(async () => ({ ok: true as const })),
    ...overrides,
  } as UseGear;
}

function renderSheet(category: 'racket' | 'string', gear: UseGear, handlers: { onChange?: () => void; onAddSpare?: () => void; onClose?: () => void; onCrosses?: () => void } = {}) {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <SetupLineSheet open category={category} gear={gear} onClose={handlers.onClose ?? vi.fn()} onChange={handlers.onChange ?? vi.fn()} onAddSpare={handlers.onAddSpare ?? vi.fn()} onCrosses={handlers.onCrosses} />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  resetCatalogCache();
  global.fetch = vi.fn().mockImplementation(() => Promise.resolve({
    ok: true,
    json: () => Promise.resolve({ items: [{ id: 'rk-af79', category: 'racket', brand: 'Li-Ning', model: 'Air Force 79', skillRange: [1, 3], attributes: { weight: '4U', balance: 'Even', flex: 'Medium' } }] }),
  })) as unknown as typeof fetch;
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('SetupLineSheet — one sheet about one line', () => {
  it('the racket line: in play, change, spare — and full specs from the catalog', async () => {
    const onChange = vi.fn();
    const onAddSpare = vi.fn();
    renderSheet('racket', fakeGear([RACKET]), { onChange, onAddSpare });
    expect(await screen.findByText('Li-Ning · 4U · even · medium')).toBeTruthy();
    expect(screen.getByText('The one you play')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Change the model/ }));
    fireEvent.click(screen.getByRole('button', { name: /Add another racket as a spare/ }));
    expect(onChange).toHaveBeenCalled();
    expect(onAddSpare).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /Full specs/ }));
    expect(screen.getByText('Medium')).toBeTruthy();
  });

  it('Remove asks once before it acts', async () => {
    const gear = fakeGear([RACKET]);
    const onClose = vi.fn();
    renderSheet('racket', gear, { onClose });
    fireEvent.click(await screen.findByRole('button', { name: /Remove from my equipment/ }));
    expect(gear.remove).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(gear.remove).toHaveBeenCalledWith('r1'));
    expect(onClose).toHaveBeenCalled();
  });

  it('a refused remove is rendered and the sheet stays', async () => {
    const gear = fakeGear([RACKET], { remove: vi.fn(async () => ({ ok: false as const, reason: 'rate_limited' as const })) });
    const onClose = vi.fn();
    renderSheet('racket', gear, { onClose });
    fireEvent.click(await screen.findByRole('button', { name: /Remove from my equipment/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('the string line edits its tension and saves only a change', async () => {
    const gear = fakeGear([RACKET, STRING]);
    renderSheet('string', gear);
    const save = await screen.findByRole('button', { name: 'Save' });
    expect((save as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Raise tension' }));
    expect((save as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(save);
    await waitFor(() => expect(gear.setTension).toHaveBeenCalledWith(STRING, 26));
  });

  it('a saved tension can be retyped: clearing the field does not snap the saved figure back', async () => {
    const gear = fakeGear([RACKET, { ...STRING, tensionLbs: 32 }]);
    renderSheet('string', gear);
    const input = await screen.findByRole('textbox', { name: 'Tension' }) as HTMLInputElement;
    expect(input.value).toBe('32');
    fireEvent.change(input, { target: { value: '' } });
    expect(input.value).toBe('');
    fireEvent.change(input, { target: { value: '2' } });
    expect(input.value).toBe('2');
    fireEvent.change(input, { target: { value: '28' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(gear.setTension).toHaveBeenCalledWith(expect.objectContaining({ id: 's1' }), 28));
  });

  it('a single string offers a different string for the crosses', async () => {
    const onCrosses = vi.fn();
    renderSheet('string', fakeGear([RACKET, STRING]), { onCrosses });
    fireEvent.click(await screen.findByRole('button', { name: /Use a different string for the crosses/ }));
    expect(onCrosses).toHaveBeenCalled();
    expect(screen.queryByRole('textbox', { name: 'Crosses tension' })).toBeNull();
  });

  it('a hybrid sets its crosses tension on its own, and taking the crosses off asks once', async () => {
    const hybrid: GearItem = { ...STRING, crosses: { catalogId: null, label: 'Yonex BG80', tensionLbs: 27 } };
    const gear = fakeGear([RACKET, hybrid]);
    renderSheet('string', gear, { onCrosses: vi.fn() });
    const crossesField = await screen.findByRole('textbox', { name: 'Crosses tension' }) as HTMLInputElement;
    expect(crossesField.value).toBe('27');
    expect((screen.getByRole('textbox', { name: 'Mains tension' }) as HTMLInputElement).value).toBe('25');
    fireEvent.change(crossesField, { target: { value: '28' } });
    const saves = screen.getAllByRole('button', { name: 'Save' });
    fireEvent.click(saves[1]);
    await waitFor(() => expect(gear.setCrosses).toHaveBeenCalledWith('s1', { catalogId: null, label: 'Yonex BG80', tensionLbs: 28 }));
    expect(gear.setTension).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /One string throughout/ }));
    expect(gear.setCrosses).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Take it off' }));
    await waitFor(() => expect(gear.setCrosses).toHaveBeenLastCalledWith('s1', null));
  });
});
