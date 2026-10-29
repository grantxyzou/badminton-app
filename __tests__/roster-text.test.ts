import { describe, it, expect } from 'vitest';
import { formatRosterText, MAX_BLANK_SLOTS, type RosterTextPlayer } from '../lib/rosterText';

/**
 * The list a club pastes into its group chat (docs/plans/six-feathers-onboarding.md).
 * The chat's own format is the spec: a numbered list whose open spots are empty
 * numbers, then a numbered waiting list.
 */
const at = (minute: number) => new Date(Date.UTC(2026, 9, 25, 16, minute)).toISOString();

function row(id: string, name: string, minute: number, extra: Partial<RosterTextPlayer> = {}): RosterTextPlayer {
  return { id, name, timestamp: at(minute), ...extra };
}

describe('formatRosterText', () => {
  it('leads with the club, the date and the courts', () => {
    const text = formatRosterText({
      groupName: 'Six Feathers',
      datetime: '2026-10-31T17:00:00Z',
      courts: 4,
      maxPlayers: 32,
      players: [],
      timeZone: 'UTC',
    });
    expect(text.split('\n')[0]).toBe('🏸 Six Feathers · Saturday, October 31, 5:00 PM · 4 courts');
  });

  it('numbers sign-ups in sign-up order and leaves open spots as empty numbers', () => {
    const text = formatRosterText({
      groupName: 'Six Feathers',
      maxPlayers: 4,
      players: [row('b', 'Taufik', 5), row('a', 'Chong Wei', 1), row('c', 'Hendra', 9)],
    });
    const lines = text.split('\n');
    expect(lines.slice(2, 6)).toEqual(['1. Chong Wei', '2. Taufik', '3. Hendra', '4.']);
  });

  it('lists the waiting list on its own, in order, and leaves out cancelled rows', () => {
    const text = formatRosterText({
      maxPlayers: 2,
      players: [
        row('a', 'Chong Wei', 1),
        row('b', 'Taufik', 2),
        row('c', 'Gideon', 3, { removed: true }),
        row('e', 'Ratchanok', 8, { waitlisted: true }),
        row('d', 'Saina', 4, { waitlisted: true }),
        row('f', 'Kirsty', 9, { waitlisted: true, removed: true }),
      ],
    });
    expect(text).not.toContain('Gideon');
    expect(text).not.toContain('Kirsty');
    expect(text.split('\n').slice(-3)).toEqual(['Waiting list', '1. Saina', '2. Ratchanok']);
  });

  it('keeps an empty waiting list visible, as the chat does', () => {
    const text = formatRosterText({ maxPlayers: 1, players: [row('a', 'Chong Wei', 1)] });
    expect(text.split('\n').slice(-2)).toEqual(['Waiting list', '1.']);
  });

  it('never drops a confirmed player when the cap is below the head count', () => {
    // An admin can add past the cap; the text reports who is in, not the cap.
    const text = formatRosterText({
      maxPlayers: 1,
      players: [row('a', 'Chong Wei', 1), row('b', 'Taufik', 2)],
    });
    expect(text).toContain('1. Chong Wei');
    expect(text).toContain('2. Taufik');
  });

  it('says how many spots are left instead of printing a wall of empty numbers', () => {
    const text = formatRosterText({ maxPlayers: MAX_BLANK_SLOTS + 1, players: [row('a', 'Chong Wei', 1)] });
    expect(text).toContain(`(${MAX_BLANK_SLOTS} spots left)`);
    expect(text).not.toContain('2.\n');
  });

  it('closes with the app link when given one, so nobody edits the copy', () => {
    const text = formatRosterText({ maxPlayers: 1, players: [], link: 'https://example.test/bpm' });
    expect(text.split('\n').at(-1)).toBe('Join or drop out in the app: https://example.test/bpm');
    expect(formatRosterText({ maxPlayers: 1, players: [] })).not.toContain('in the app');
  });

  it('survives a date it cannot parse and a club with no name', () => {
    const text = formatRosterText({ datetime: 'nonsense', courts: 1, players: [] });
    expect(text.split('\n')[0]).toBe('🏸 Badminton · 1 court');
    expect(text).not.toContain('Invalid Date');
  });
});
