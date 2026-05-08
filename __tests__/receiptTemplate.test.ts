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
  it('leads with the amount in friend-group voice and includes recipient + memo', () => {
    const text = renderGroupText(baseInput);
    expect(text).toMatch(/^Badminton on .* was \$9 each\./);
    expect(text).toContain('E-transfer me at grant@example.com');
    expect(text).toMatch(/Memo: BPM .* - \{your name\}/);
    expect(text).toContain('3 courts · 3 of us · $108 total');
  });

  it('handles single court pluralization in the parenthetical', () => {
    const text = renderGroupText({ ...baseInput, courts: 1, playerNames: ['Daisy'] });
    expect(text).toContain('1 court ·');
    expect(text).toContain('1 of us ·');
  });

  it('appends optional admin note when present', () => {
    const text = renderGroupText({ ...baseInput, note: 'Bring water!' });
    expect(text).toContain('Bring water!');
  });

  it('does NOT list individual player names (friends already know who played)', () => {
    // Names previously appeared as "Players this week: Daisy, Mei, Ken" — that
    // line was dropped to keep the message short. Count stays in the
    // parenthetical. Adding it back is a regression to fight.
    const text = renderGroupText(baseInput);
    expect(text).not.toContain('Daisy');
    expect(text).not.toContain('Mei');
    expect(text).not.toContain('Ken');
  });

  it('respects custom memoTemplate with {date} interpolation', () => {
    const text = renderGroupText({ ...baseInput, memoTemplate: 'X {date} Y' });
    expect(text).toMatch(/Memo: X .* Y/);
    // {date} is replaced with a short date, not the literal placeholder.
    expect(text).not.toContain('{date}');
  });
});

describe('renderIndividualText', () => {
  it('greets the named player in friend voice and includes amount/recipient/memo', () => {
    const text = renderIndividualText({ ...baseInput, playerName: 'Daisy' });
    expect(text).toMatch(/^Hey Daisy — badminton on .* was \$9\./);
    expect(text).toContain('E-transfer me at grant@example.com');
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
