import { describe, it, expect } from 'vitest';
import { parseInviteInput } from '@/lib/parseInviteInput';

/**
 * One parser for the two screens that take "a link or a code" in one box.
 * Each used to carry its own copy; this pins the shared one.
 */
const TOKEN = 'a1'.repeat(16);
const ORIGIN = 'https://bpm.grantzou.com';

describe('parseInviteInput', () => {
  it('reads a full invite link as its token', () => {
    expect(parseInviteInput(`https://bpm.grantzou.com/bpm?join=${TOKEN}`, ORIGIN)).toEqual({ token: TOKEN });
    expect(parseInviteInput(`https://bpm.grantzou.com/bpm/?join=${TOKEN}&tab=home`, ORIGIN)).toEqual({ token: TOKEN });
  });

  it('reads a bare `?join=` fragment against the given origin', () => {
    expect(parseInviteInput(`/bpm?join=${TOKEN}`, ORIGIN)).toEqual({ token: TOKEN });
    expect(parseInviteInput(`?join=${TOKEN}`, ORIGIN)).toEqual({ token: TOKEN });
  });

  it('reads a 32-hex string as a token, in either case', () => {
    expect(parseInviteInput(TOKEN)).toEqual({ token: TOKEN });
    expect(parseInviteInput(TOKEN.toUpperCase())).toEqual({ token: TOKEN.toUpperCase() });
  });

  it('treats anything else as a code, trimmed', () => {
    expect(parseInviteInput('ABCD2345')).toEqual({ code: 'ABCD2345' });
    expect(parseInviteInput('  ABCD-2345  ')).toEqual({ code: 'ABCD-2345' });
  });

  it('answers nothing for an empty box', () => {
    expect(parseInviteInput('')).toEqual({});
    expect(parseInviteInput('   ')).toEqual({});
  });

  it('a URL with no `join` falls through to a code rather than vanishing', () => {
    // A pasted link that is not an invite is still SOMETHING typed; the preview
    // will say it does not work, which is more honest than a silent no-op.
    expect(parseInviteInput('https://bpm.grantzou.com/bpm', ORIGIN)).toEqual({ code: 'https://bpm.grantzou.com/bpm' });
  });
});
