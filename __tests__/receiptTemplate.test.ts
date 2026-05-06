import { describe, it, expect } from 'vitest';
import { renderGroupText, renderIndividualText, type ReceiptInput } from '@/lib/receiptTemplate';

const baseInput: ReceiptInput = {
  datetime: '2026-05-13T20:00:00-04:00',
  costPerPerson: 9,
  courts: 3,
  totalCost: 108,
  playerNames: ['Daisy', 'Mei', 'Ken'],
  recipient: { name: 'Grant Zou', email: 'grant@example.com' },
};

describe('renderGroupText', () => {
  it('contains amount, recipient email, default memo, and player list', () => {
    const text = renderGroupText(baseInput);
    expect(text).toContain('$9 / person');
    expect(text).toContain('grant@example.com');
    expect(text).toMatch(/Memo: BPM .* - \{your name\}/);
    expect(text).toContain('Daisy, Mei, Ken');
    expect(text).toContain('3 courts · 3 players · $108 total');
  });

  it('handles single court / single player pluralization', () => {
    const text = renderGroupText({ ...baseInput, courts: 1, playerNames: ['Daisy'] });
    expect(text).toContain('1 court ·');
    expect(text).toContain('1 player ·');
  });

  it('omits the players block when playerNames is empty', () => {
    const text = renderGroupText({ ...baseInput, playerNames: [] });
    expect(text).not.toContain('Players this week');
  });

  it('appends optional admin note when present', () => {
    const text = renderGroupText({ ...baseInput, note: 'Bring water!' });
    expect(text).toContain('Bring water!');
  });

  it('respects custom memoTemplate with {date} interpolation', () => {
    const text = renderGroupText({ ...baseInput, memoTemplate: 'X {date} Y' });
    expect(text).toMatch(/Memo: X .* Y/);
    // {date} is replaced with a short date, not the literal placeholder.
    expect(text).not.toContain('{date}');
  });
});

describe('renderIndividualText', () => {
  it('greets the named player and includes amount/recipient/memo', () => {
    const text = renderIndividualText({ ...baseInput, playerName: 'Daisy' });
    expect(text).toContain('Hi Daisy');
    expect(text).toContain('$9');
    expect(text).toContain('grant@example.com');
    expect(text).toContain('Memo: BPM');
  });

  it('interpolates {name} into the memo template with the player name', () => {
    const text = renderIndividualText({
      ...baseInput,
      playerName: 'Daisy',
      memoTemplate: 'BPM {date} - {name}',
    });
    expect(text).toContain('Memo: BPM');
    expect(text).toContain('- Daisy');
  });

  it('appends Thanks at the end', () => {
    const text = renderIndividualText({ ...baseInput, playerName: 'Daisy' });
    expect(text.trim().endsWith('Thanks!')).toBe(true);
  });
});
