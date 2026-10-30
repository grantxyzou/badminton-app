import { describe, it, expect } from 'vitest';
import { parseRosterText, isSpreadsheetFile } from '@/lib/rosterImport';

// Shaped like the Six Feathers post (docs/plans/six-feathers-onboarding.md),
// with famous players' names — never the club's.
const CHAT_POST = `Saturday Nov 2, 7–10pm · 4 courts 🏸
1. Lin Dan
2. Viktor
3. *Carolina*
4.
5. Akane 🏸
6.

Waiting list
1. Kento
2. Sindhu (Akane)
3.`;

describe('parseRosterText — a numbered chat list', () => {
  const parsed = parseRosterText(CHAT_POST);

  it('reads it as a list, numbering stripped, open spots skipped', () => {
    expect(parsed.format).toBe('list');
    expect(parsed.rows.map((r) => r.name)).toEqual(['Lin Dan', 'Viktor', 'Carolina', 'Akane', 'Kento']);
  });

  it('marks everyone above "Waiting list" a member and everyone below a drop-in', () => {
    const kinds = Object.fromEntries(parsed.rows.map((r) => [r.name, r.regular]));
    expect(kinds).toEqual({ 'Lin Dan': true, Viktor: true, Carolina: true, Akane: true, Kento: false });
  });

  it('lists a guest instead of importing them', () => {
    expect(parsed.guests).toEqual([{ name: 'Sindhu', host: 'Akane' }]);
  });

  it('skips the date header and says so', () => {
    expect(parsed.skippedLines).toEqual(['Saturday Nov 2, 7–10pm · 4 courts 🏸']);
  });

  it('keeps each name’s source line for the preview', () => {
    expect(parsed.rows.find((r) => r.name === 'Kento')?.line).toBe(10);
  });
});

describe('parseRosterText — a plain list', () => {
  it('keeps names that are also month or weekday words', () => {
    const parsed = parseRosterText('May\nJun\nSun\nMark L.');
    expect(parsed.rows.map((r) => r.name)).toEqual(['May', 'Jun', 'Sun', 'Mark L.']);
    expect(parsed.skippedLines).toEqual([]);
  });

  it('skips a sentence, but not a long numbered name', () => {
    const parsed = parseRosterText('please copy and paste when you add or remove\n1. Maria Del Carmen Lopez');
    expect(parsed.rows.map((r) => r.name)).toEqual(['Maria Del Carmen Lopez']);
    expect(parsed.skippedLines).toHaveLength(1);
  });

  it('does not flip to drop-ins on a sentence that starts with "waiting"', () => {
    const parsed = parseRosterText('1. Lin\nwaiting for Ian to confirm the courts\n2. Viktor');
    expect(parsed.rows.every((r) => r.regular)).toBe(true);
  });

  it('reads a Chinese waiting-list heading', () => {
    const parsed = parseRosterText('1. Lin\n候补：\n1. Kento');
    expect(parsed.rows.find((r) => r.name === 'Kento')?.regular).toBe(false);
  });

  it('drops a trailing +1', () => {
    expect(parseRosterText('1. Lin +1').rows[0].name).toBe('Lin');
  });

  it('answers an empty paste with nothing', () => {
    expect(parseRosterText('  \n\n').rows).toEqual([]);
  });
});

describe('parseRosterText — cells pasted from a spreadsheet', () => {
  it('finds the name column by its header and reports the rest as ignored', () => {
    const parsed = parseRosterText('Phone\tName\tMember\n604-555-0101\tLin\tyes\n604-555-0102\tKento\tdrop-in');
    expect(parsed.format).toBe('table');
    expect(parsed.rows.map((r) => [r.name, r.regular])).toEqual([['Lin', true], ['Kento', false]]);
    expect(parsed.ignoredColumns).toEqual(['Phone']);
  });

  it('with no header, reads column 1 and spots a member/drop-in column', () => {
    const parsed = parseRosterText('Lin\tmember\tlin@example.com\nKento\tdrop-in\tkento@example.com');
    expect(parsed.rows.map((r) => [r.name, r.regular])).toEqual([['Lin', true], ['Kento', false]]);
    expect(parsed.ignoredColumns).toEqual(['column 3']);
  });

  it('joins First and Last columns', () => {
    const parsed = parseRosterText('First name\tLast name\nLin\tDan\nViktor\tAxelsen');
    expect(parsed.rows.map((r) => r.name)).toEqual(['Lin Dan', 'Viktor Axelsen']);
    expect(parsed.ignoredColumns).toEqual([]);
  });

  it('defaults a blank or unreadable member cell to member', () => {
    const parsed = parseRosterText('Name\tMember\nLin\t\nKento\t?');
    expect(parsed.rows.map((r) => r.regular)).toEqual([true, true]);
  });
});

describe('parseRosterText — CSV', () => {
  it('keeps a quoted comma inside one name', () => {
    const parsed = parseRosterText('Name,Email\n"Lee, Chong Wei",a@example.com\nTaufik,b@example.com', { source: 'csv' });
    expect(parsed.format).toBe('csv');
    expect(parsed.rows.map((r) => r.name)).toEqual(['Lee, Chong Wei', 'Taufik']);
    expect(parsed.ignoredColumns).toEqual(['Email']);
  });

  it('reads doubled quotes and a byte-order mark', () => {
    const parsed = parseRosterText('﻿Name\n"Lin ""Super Dan"""', { source: 'csv' });
    expect(parsed.rows[0].name).toBe('Lin "Super Dan"');
  });

  it('reads a pasted CSV export as CSV', () => {
    const parsed = parseRosterText('Name,Type\nLin,member\nKento,drop-in');
    expect(parsed.format).toBe('csv');
    expect(parsed.rows.map((r) => r.regular)).toEqual([true, false]);
  });

  it('treats a numbered list with commas as a list, not CSV', () => {
    const parsed = parseRosterText('1. Lee, Chong Wei\n2. Taufik');
    expect(parsed.format).toBe('list');
    expect(parsed.rows.map((r) => r.name)).toEqual(['Lee, Chong Wei', 'Taufik']);
  });
});

describe('isSpreadsheetFile', () => {
  it('refuses the formats it cannot read', () => {
    expect(isSpreadsheetFile('Roster.xlsx')).toBe(true);
    expect(isSpreadsheetFile('roster.numbers')).toBe(true);
    expect(isSpreadsheetFile('roster.csv')).toBe(false);
  });
});
