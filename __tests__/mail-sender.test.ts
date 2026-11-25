import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { senderName, mailFrom } from '@/lib/mailTransport';

/**
 * Who an email is from, by what it is about (Grant, 2026-11-25): the app for
 * the account emails, the club for "You're in" and a card receipt, the
 * stringer for every stringing email. Only the NAME varies; the address is
 * always the app's one account, because Gmail will not send as anyone else.
 */

const sendMail = vi.fn(async (_msg: { from: unknown; to: string; subject: string }) => ({}));
vi.mock('@/lib/mailTransport', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/mailTransport')>()),
  gmailTransport: async () => ({ sendMail }),
}));

describe('senderName', () => {
  it('the app is "BPM admin"', () => {
    expect(senderName({ kind: 'app' })).toBe('BPM admin');
  });

  it('a club is "BPM <club>", never "BPM BPM Core"', () => {
    expect(senderName({ kind: 'club', club: 'Six Feathers' })).toBe('BPM Six Feathers');
    expect(senderName({ kind: 'club', club: 'BPM Core' })).toBe('BPM Core');
    expect(senderName({ kind: 'club', club: 'bpm juniors' })).toBe('bpm juniors');
  });

  it('a stringer is "<stringer> · <club>"', () => {
    expect(senderName({ kind: 'stringer', stringer: 'Lin', club: 'BPM Core' })).toBe('Lin · BPM Core');
    expect(senderName({ kind: 'stringer', stringer: 'Lin', club: 'Six Feathers' })).toBe('Lin · Six Feathers');
  });

  it('a name it cannot read falls back one step: stringer → club → app', () => {
    expect(senderName({ kind: 'stringer', stringer: null, club: 'Six Feathers' })).toBe('BPM Six Feathers');
    expect(senderName({ kind: 'stringer', stringer: '  ', club: undefined })).toBe('BPM admin');
    expect(senderName({ kind: 'stringer', stringer: 'Lin', club: '' })).toBe('Lin · BPM');
    expect(senderName({ kind: 'club', club: null })).toBe('BPM admin');
  });

  it('a name typed by a person stays one short line', () => {
    expect(senderName({ kind: 'stringer', stringer: 'Lin\r\nBcc: x@evil.test', club: 'BPM Core' })).toBe('Lin Bcc: x@evil.test · BPM Core');
    expect(senderName({ kind: 'club', club: 'x'.repeat(200) }).length).toBeLessThanOrEqual(64);
  });

  it('the address is always the one the app signs in as', () => {
    expect(mailFrom({ kind: 'stringer', stringer: 'Lin', club: 'BPM Core' }, 'admin@example.test')).toEqual({
      name: 'Lin · BPM Core',
      address: 'admin@example.test',
    });
  });
});

describe('each sender picks its kind', () => {
  beforeEach(() => {
    sendMail.mockClear();
    process.env.GMAIL_USER = 'admin@example.test';
    process.env.GMAIL_APP_PASSWORD = 'app-password';
  });
  afterEach(() => {
    delete process.env.GMAIL_USER;
    delete process.env.GMAIL_APP_PASSWORD;
  });

  it('account emails come from the app, "You\'re in" from the club', async () => {
    const auth = await import('@/lib/authEmail');
    await auth.sendSignInCodeEmail('lin@example.test', 'Lin', '482913');
    await auth.sendPasswordResetEmail('lin@example.test', 'Lin', 'https://x.test/reset');
    await auth.sendJoinedEmail('lin@example.test', 'Lin', 'Six Feathers', null);
    const froms = sendMail.mock.calls.map(([m]) => m.from);
    expect(froms).toEqual([
      { name: 'BPM admin', address: 'admin@example.test' },
      { name: 'BPM admin', address: 'admin@example.test' },
      { name: 'BPM Six Feathers', address: 'admin@example.test' },
    ]);
  });

  it('a stringing notice comes from the job\'s stringer', async () => {
    const { sendStringingNotice } = await import('@/lib/stringingNotifyEmail');
    const notice = {
      key: 'ready_for_you' as const,
      jobNo: 'J-0042',
      racketLabel: 'Yonex Astrox 88D Pro',
      quote: '$28',
      readyBy: null,
      spec: { stringLabel: 'BG80', stringColor: 'White', tensionMains: 26, tensionCrosses: 28, ownString: false },
      channels: ['email' as const],
    };
    await sendStringingNotice(notice, 'lin@example.test', 'Lin', 'BPM Core', 'Viktor');
    expect(sendMail.mock.calls[0][0].from).toEqual({ name: 'Viktor · BPM Core', address: 'admin@example.test' });
  });
});
