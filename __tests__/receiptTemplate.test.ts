import { describe, it, expect } from 'vitest';
import { breakdownRows, payToItems, renderGroupText, renderIndividualText, type ReceiptInput } from '@/lib/receiptTemplate';

const baseInput: ReceiptInput = {
  datetime: '2026-05-13T20:00:00-04:00',
  costPerPerson: 9,
  courts: 3,
  totalCost: 108,
  playerNames: ['Daisy', 'Mei', 'Ken'],
  recipient: { name: 'Grant Zou', email: 'grant@example.com' },
};

describe('breakdownRows (the image, design F4)', () => {
  const night: ReceiptInput = {
    ...baseInput,
    courts: 2,
    totalCost: 111,
    costPerPerson: 18.5,
    breakdown: { courtTotal: 96, costPerCourt: 48, birdTotal: 15, tubes: 1, splitCount: 6 },
  };

  it('shows where the total came from, then the share', () => {
    expect(breakdownRows(night).map((r) => [r.label, r.amount])).toEqual([
      ['2 courts × $48', '$96'],
      ['1 tube of shuttles', '$15'],
      ['Total', '$111'],
      ['Split 6 ways', '$18.50 each'],
    ]);
  });

  it('leaves out a line with nothing on it, and pluralises', () => {
    const rows = breakdownRows({ ...night, courts: 1, breakdown: { courtTotal: 48, costPerCourt: 48, birdTotal: 0, splitCount: 4 } });
    expect(rows.map((r) => r.label)).toEqual(['1 court × $48', 'Total', 'Split 4 ways']);
    const halves = breakdownRows({ ...night, breakdown: { ...night.breakdown!, tubes: 1.5 } });
    expect(halves[1].label).toBe('1.5 tubes of shuttles');
  });

  it('with no breakdown, shows the total and the share alone', () => {
    expect(breakdownRows(baseInput).map((r) => [r.label, r.amount])).toEqual([['Total', '$108'], ['Per person', '$9']]);
  });
});

describe('payToItems', () => {
  it('lists the e-transfer address and the memo, and Wealthsimple between them when set', () => {
    expect(payToItems({ ...baseInput, clubName: 'BPM Core' }).map((i) => i.label)).toEqual(['E-transfer to:', 'Please include a memo:']);
    const both = payToItems({ ...baseInput, clubName: 'BPM Core', recipient: { ...baseInput.recipient, wealthsimple: '$grantxyzou' } });
    expect(both).toEqual([
      { label: 'E-transfer to:', value: 'grant@example.com' },
      { label: 'WS transfer:', value: '$grantxyzou' },
      { label: 'Please include a memo:', value: expect.stringMatching(/^BPM Core \w+ \d+ - your name$/) },
    ]);
  });
});

describe('Wealthsimple in the copied text', () => {
  it('adds an "Or Wealthsimple" line only when the club has a handle', () => {
    expect(renderGroupText(baseInput)).not.toContain('Wealthsimple');
    const ws = { ...baseInput, recipient: { ...baseInput.recipient, wealthsimple: '$grantxyzou' } };
    expect(renderGroupText(ws)).toContain('Or Wealthsimple: $grantxyzou');
    expect(renderIndividualText({ ...ws, playerName: 'Mei' })).toContain('Or Wealthsimple: $grantxyzou');
  });
});

describe('renderGroupText', () => {
  it('leads with the amount in friend-group voice and includes recipient + memo', () => {
    const text = renderGroupText(baseInput);
    expect(text).toMatch(/^Badminton on .* was \$9 each\./);
    expect(text).toContain('E-transfer me at grant@example.com');
    // No club supplied, so `{club}` collapses and the memo is date-and-name.
    // A memo naming some OTHER club would be worse than a terse one: it goes in
    // a bank transfer, next to money, read by someone deciding whether they
    // recognise the payment.
    expect(text).toMatch(/Memo: \w+ \d+ - \{your name\}/);
    expect(text).not.toContain('{club}');
    expect(text).toContain('3 courts · 3 of us · $108 total');
  });

  it('writes cents as two places, never "$18.5"', () => {
    const text = renderGroupText({ ...baseInput, costPerPerson: 18.5, totalCost: 110.5 });
    expect(text).toMatch(/was \$18\.50 each\./);
    expect(text).toContain('· $110.50 total');
    const one = renderIndividualText({ ...baseInput, costPerPerson: 18.5, playerName: 'Mei' });
    expect(one).toMatch(/was \$18\.50\./);
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
    expect(text).toMatch(/Memo: \w+ \d+ - Daisy/);
  });

  it('puts the CLUB in the memo when one is known', () => {
    // The club, never the product: the payer is being told what they are
    // paying for, not which software the organiser happens to use.
    const text = renderIndividualText({
      ...baseInput,
      playerName: 'Daisy',
      clubName: 'Thursday Badminton',
    });
    expect(text).toMatch(/Memo: Thursday Badminton \w+ \d+ - Daisy/);
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
