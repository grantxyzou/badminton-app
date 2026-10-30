// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import RosterImportSheet from '@/components/admin/CommandCenter/RosterImportSheet';

/**
 * "Import a list" (docs/plans/roster-import.md): paste → check → import. The
 * route is stubbed; what is pinned here is what the sheet SENDS and what it
 * shows between the steps.
 */
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const PREVIEW = {
  marksStored: true,
  rows: [
    { name: 'Lin', regular: true, kind: 'new' },
    { name: 'Viktor', regular: true, kind: 'unchanged', current: true },
    { name: 'chris l', regular: true, kind: 'similar', similarTo: 'Chris L.' },
    { name: 'Kento', regular: false, kind: 'new' },
  ],
};

function stubRoute(results = [{ name: 'Lin', outcome: 'added' }, { name: 'Kento', outcome: 'added' }]) {
  const calls: Array<Record<string, unknown>> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation((_url: string, init: { body: string }) => {
      const body = JSON.parse(init.body) as Record<string, unknown>;
      calls.push(body);
      const data = body.dryRun ? PREVIEW : { results };
      return Promise.resolve({ ok: true, status: 200, json: async () => data } as unknown as Response);
    }),
  );
  return calls;
}

async function toPreview(onImported = () => {}) {
  const onClose = vi.fn();
  render(<RosterImportSheet open onClose={onClose} onImported={onImported} />);
  fireEvent.change(screen.getByLabelText('Your list'), { target: { value: '1. Lin\n2. Viktor\n3. chris l\nWaiting list\n1. Kento' } });
  fireEvent.click(screen.getByRole('button', { name: 'Check the list' }));
  await screen.findByText('Looks like Chris L.');
  return onClose;
}

describe('RosterImportSheet', () => {
  it('sends the parsed names, members above the waiting list and drop-ins below', async () => {
    const calls = stubRoute();
    await toPreview();
    expect(calls[0]).toEqual({
      dryRun: true,
      rows: [
        { name: 'Lin', regular: true },
        { name: 'Viktor', regular: true },
        { name: 'chris l', regular: true },
        { name: 'Kento', regular: false },
      ],
    });
  });

  it('ticks new rows, leaves "already here" and "looks like" unticked, and counts them', async () => {
    stubRoute();
    await toPreview();
    expect(screen.getByText('2 to add · 1 already here · 1 skipped')).toBeDefined();
    expect((screen.getByLabelText('Import Lin') as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText('Import chris l') as HTMLInputElement).checked).toBe(false);
    expect((screen.getByLabelText('Import Viktor') as HTMLInputElement).disabled).toBe(true);
  });

  it('re-marking someone already here turns them into a re-mark', async () => {
    stubRoute();
    await toPreview();
    const viktor = screen.getByRole('radiogroup', { name: 'Viktor: member or drop-in' });
    fireEvent.click(viktor.querySelectorAll('button')[1]);
    expect(await screen.findByText('Already here · mark as drop-in')).toBeDefined();
    expect(screen.getByText('2 to add · 1 to re-mark · 1 skipped')).toBeDefined();
  });

  it('imports only the ticked rows, forcing a ticked "looks like" one, then closes', async () => {
    const calls = stubRoute();
    const onImported = vi.fn();
    const onClose = await toPreview(onImported);
    fireEvent.click(screen.getByLabelText('Import chris l'));
    fireEvent.click(screen.getByRole('button', { name: 'Import 3 people' }));
    await vi.waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(calls[1]).toEqual({
      rows: [
        { name: 'Lin', regular: true, force: false },
        { name: 'chris l', regular: true, force: true },
        { name: 'Kento', regular: false, force: false },
      ],
    });
    expect(onImported).toHaveBeenCalled();
  });

  it('stays open on the rows that did not save', async () => {
    stubRoute([{ name: 'Lin', outcome: 'added' }, { name: 'Kento', outcome: 'taken' }]);
    const onClose = await toPreview();
    fireEvent.click(screen.getByRole('button', { name: 'Import 2 people' }));
    expect(await screen.findByText('Someone else took this name just now')).toBeDefined();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('refuses a spreadsheet file with the save-as-CSV line', async () => {
    stubRoute();
    render(<RosterImportSheet open onClose={() => {}} onImported={() => {}} />);
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(['x'], 'Roster.xlsx')] } });
    expect(await screen.findByRole('alert')).toBeDefined();
    expect(screen.getByRole('alert').textContent).toMatch(/Save it as CSV/);
  });
});
