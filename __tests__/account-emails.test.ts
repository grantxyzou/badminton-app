import { describe, it, expect } from 'vitest';
import {
  composeVerificationEmail,
  composeSignInCodeEmail,
  composeJoinedEmail,
  composePasswordResetEmail,
} from '@/lib/authEmail';
import { composeReportEmail } from '@/lib/reportEmail';

/**
 * The account emails and the problem report on the branded frame
 * (docs/plans/branded-emails.md). The plain text is what a mail app with no
 * HTML shows, and it must not have moved; the HTML is read as text, which is
 * all a test can know about an email.
 */

const ORIGIN = 'https://bpm.example.test';
const URL = 'https://bpm.example.test/bpm/verify?token=abc';

/** How many times `needle` is DRAWN: the hidden inbox preview line is not. */
function shown(html: string, needle: string): number {
  return html.replace(/<div style="display:none[^"]*">[^<]*<\/div>/, '').split(needle).length - 1;
}

describe('confirm your email', () => {
  it('keeps the plain text word for word', () => {
    expect(composeVerificationEmail('Lin', URL).text).toBe(
      `Hi Lin,\n\nTap this link to confirm your email address for BPM:\n${URL}\n\nIt works for the next 24 hours. If you didn't sign up, you can ignore this.\n\n— BPM`,
    );
  });

  it('has one button to the link, and the link written out under it', () => {
    const { html, subject } = composeVerificationEmail('Lin', URL, ORIGIN);
    expect(subject).toBe('Confirm your email — BPM');
    expect(html).toContain('>Confirm email<');
    expect(html).toContain(`href="${URL}"`);
    expect(shown(html, URL)).toBe(2);
    expect(html).toContain(`${ORIGIN}/brand/email/bpm-mark.png`);
  });

  it('escapes the name a person chose', () => {
    const { html } = composeVerificationEmail('<img src=x onerror=alert(1)>', URL);
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });
});

describe('the sign-in code', () => {
  it('puts the code in the subject and draws it once, big', () => {
    const { html, subject, text } = composeSignInCodeEmail('Lin', '482913');
    expect(subject).toBe('482913 is your BPM code');
    expect(shown(html, '482913')).toBe(1);
    expect(html).toContain('font-size:36px');
    // The inbox preview line leaves the code out: the subject already shows it.
    expect(html.match(/<div style="display:none[^"]*">([^<]*)<\/div>/)![1]).not.toContain('482913');
    expect(text).toContain('    482913');
  });
});

describe('"You\'re in"', () => {
  it('names the club and opens the app', () => {
    const { html, subject, text } = composeJoinedEmail('Lin', 'BPM Core', `${ORIGIN}/bpm`);
    expect(subject).toBe("You're in BPM Core");
    expect(html).toContain('BPM Core');
    expect(html).toContain('>Open BPM<');
    expect(text).toBe(`Hi Lin,\n\nYou're in BPM Core. Open BPM to sign up for the next session:\n${ORIGIN}/bpm\n\n— BPM`);
  });

  it('has no button when there is no link to give', () => {
    const { html, text } = composeJoinedEmail('Lin', 'BPM Core', null);
    expect(html).not.toContain('>Open BPM<');
    expect(text).toBe("Hi Lin,\n\nYou're in BPM Core. Open BPM to sign up for the next session.\n\n— BPM");
  });
});

describe('password reset', () => {
  it('keeps the plain text and has one button to the link', () => {
    const { html, text, subject } = composePasswordResetEmail('Lin', URL);
    expect(subject).toBe('Reset your password — BPM');
    expect(text).toBe(
      `Hi Lin,\n\nSomeone asked to reset your BPM password. Tap here to pick a new one:\n${URL}\n\nThis link works for one hour and can only be used once. If it wasn't you, ignore this — your password hasn't changed.\n\n— BPM`,
    );
    expect(html).toContain('>Reset password<');
    expect(html).toContain(`href="${URL}"`);
  });
});

describe('the problem report', () => {
  const report = {
    message: 'Stats won\'t load.\n<b>It just spins</b>',
    name: 'Lin',
    category: 'Stats',
    tab: 'stats',
    url: '/bpm/?tab=stats',
    createdAt: '2026-11-18T19:42:00.000Z',
  };

  it('keeps the plain text word for word', () => {
    expect(composeReportEmail(report).text).toBe(
      "Stats won't load.\n<b>It just spins</b>\n\n— context —\nfrom: Lin\nabout: Stats\ntab: stats\nurl: /bpm/?tab=stats\nat: 2026-11-18T19:42:00.000Z",
    );
  });

  it('quotes the message as written, escaped, with its line breaks kept', () => {
    const { html, subject } = composeReportEmail(report);
    expect(subject).toBe('[BPM] Problem report from Lin');
    expect(html).not.toContain('<b>It just spins</b>');
    expect(html).toContain('&lt;b&gt;It just spins&lt;/b&gt;');
    expect(html).toContain('white-space:pre-wrap');
    expect(html).toContain('/bpm/?tab=stats');
  });

  it('an anonymous report says so', () => {
    const { html, subject } = composeReportEmail({ message: 'hi', createdAt: '2026-11-18T00:00:00.000Z' });
    expect(subject).toBe('[BPM] Problem report');
    expect(html).toContain('(anonymous)');
  });
});
