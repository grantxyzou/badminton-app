import { describe, it, expect } from 'vitest';
import { parseInteracEmail, isInteracAuthenticated, parseAmountCents, type RawInteracEmail } from '@/lib/etransferParse';

/**
 * SYNTHETIC fixtures, written from Interac's published wording. Replace or add
 * real (redacted) notifications as they arrive — the shapes a bank actually
 * sends are the only ones that matter, and an unrecognised one surfaces in the
 * admin's "Needs a look" queue rather than being dropped.
 */

const GOOD_AUTH =
  'mx.google.com; dkim=pass header.i=@payments.interac.ca header.s=s1 header.b=AbCd; spf=pass (google.com: domain of notify@payments.interac.ca designates 1.2.3.4 as permitted sender) smtp.mailfrom=notify@payments.interac.ca; dmarc=pass (p=REJECT sp=REJECT dis=NONE) header.from=payments.interac.ca';
const FROM = '"Interac e-Transfer" <notify@payments.interac.ca>';

function email(over: Partial<RawInteracEmail>): RawInteracEmail {
  return { messageId: 'm1', from: FROM, subject: '', body: '', date: '2026-10-03T12:00:00Z', authResults: GOOD_AUTH, ...over };
}

describe('parseInteracEmail — the two formats', () => {
  it('reads a manual-deposit notification (EN)', () => {
    const r = parseInteracEmail(
      email({
        subject: 'INTERAC e-Transfer: BRUCE WAYNE sent you money.',
        body: 'Hi GRANT ZOU,\nBRUCE WAYNE has sent you $12.00 (CAD).\nMessage: badminton Oct 2\nTo deposit your money, click here',
      }),
    );
    expect(r).toEqual({ kind: 'received', senderName: 'BRUCE WAYNE', amountCents: 1200, memo: 'badminton Oct 2', referenceNumber: null, authenticated: true });
  });

  it('reads an Autodeposit notification (EN)', () => {
    const r = parseInteracEmail(
      email({
        subject: "INTERAC e-Transfer: You've received $42.00 from Lin Dan and it has been automatically deposited.",
        body: "Hi Grant,\nLin Dan has sent you $42.00 (CAD) and the money has been automatically deposited into your bank account at Big Bank.",
      }),
    );
    expect(r.kind).toBe('received');
    expect(r.senderName).toBe('Lin Dan');
    expect(r.amountCents).toBe(4200);
    expect(r.memo).toBeNull();
  });

  it('reads a French notification', () => {
    const r = parseInteracEmail(
      email({
        subject: "Virement INTERAC : CAROLINA MARIN vous a envoyé de l'argent.",
        body: 'Bonjour GRANT,\nCAROLINA MARIN vous a envoyé 1 234,50 $ (CAD).\nMessage : merci',
      }),
    );
    expect(r).toMatchObject({ kind: 'received', senderName: 'CAROLINA MARIN', amountCents: 123450, memo: 'merci' });
  });

  it('falls back to the body when the subject carries no name', () => {
    const r = parseInteracEmail(
      email({
        subject: 'Interac e-Transfer: Your funds have been automatically deposited',
        body: 'Hi Grant, Kento Momota sent you $15.50 (CAD) and the money has been automatically deposited.',
      }),
    );
    expect(r).toMatchObject({ kind: 'received', senderName: 'Kento Momota', amountCents: 1550 });
  });
});

/**
 * STRUCTURE COPIED FROM A REAL NOTIFICATION (Autodeposit, Wealthsimple,
 * 2026-10-01), with every name, the reference and the account replaced — this
 * repo is public. Line breaks follow the HTML's blocks; the Transfer Details
 * table is two columns, so the plain-text order is the uncertain part, and
 * the second fixture puts the neighbouring cell between label and value.
 */
const REAL_SUBJECT = "Interac e-Transfer: You've received $15.75 from MEI LING CHAN and it has been automatically deposited.";
const REAL_FROM = 'MEI LING CHAN <notify@payments.interac.ca>';
const REAL_BODY = [
  'Interac',
  'View in browser | FR',
  'Hi Grant Example,',
  'Funds Deposited!',
  '$15.75',
  'Your funds have been automatically deposited into your account at Some Bank.',
  'Some Bank',
  'Account ending in 0000',
  'Transfer Details',
  'Message:',
  'BPM Oct 1 - Gary',
  'Date:',
  'Oct 2, 2026',
  'Reference Number:',
  'C1AB2cDEFGhJ',
  'Sent From:',
  'MEI LING CHAN',
  'Amount:',
  '$15.75 (CAD)',
  'FAQ | This is a secure transaction.',
].join('\n');

describe('parseInteracEmail — the real Autodeposit shape', () => {
  it('reads sender, amount, memo and reference', () => {
    const r = parseInteracEmail(email({ subject: REAL_SUBJECT, from: REAL_FROM, body: REAL_BODY }));
    expect(r).toEqual({
      kind: 'received',
      senderName: 'MEI LING CHAN',
      amountCents: 1575,
      memo: 'BPM Oct 1 - Gary',
      referenceNumber: 'C1AB2cDEFGhJ',
      authenticated: true,
    });
  });

  it('finds the reference when the table cells interleave', () => {
    const body = REAL_BODY.replace('Date:\nOct 2, 2026\nReference Number:\nC1AB2cDEFGhJ', 'Date:\nReference Number:\nOct 2, 2026\nC1AB2cDEFGhJ');
    expect(parseInteracEmail(email({ subject: REAL_SUBJECT, from: REAL_FROM, body })).referenceNumber).toBe('C1AB2cDEFGhJ');
  });

  it('a transfer with no message has no memo (not the next label)', () => {
    const body = REAL_BODY.replace('Message:\nBPM Oct 1 - Gary\n', 'Message:\n');
    expect(parseInteracEmail(email({ subject: REAL_SUBJECT, from: REAL_FROM, body })).memo).toBeNull();
  });

  it('falls back to the From display name when the subject and body carry none', () => {
    const r = parseInteracEmail(email({ subject: 'Interac e-Transfer: Funds deposited', from: REAL_FROM, body: "You've received $15.75 (CAD)." }));
    expect(r.senderName).toBe('MEI LING CHAN');
  });
});

describe('parseInteracEmail — what is NOT a payment', () => {
  it('a reminder for an unaccepted transfer is the same money again', () => {
    const r = parseInteracEmail(email({ subject: 'Reminder: INTERAC e-Transfer: BRUCE WAYNE sent you money.', body: 'BRUCE WAYNE has sent you $12.00 (CAD).' }));
    expect(r.kind).toBe('unrecognized');
  });

  it('a cancelled or expired transfer', () => {
    expect(parseInteracEmail(email({ subject: 'INTERAC e-Transfer: transfer from BRUCE WAYNE cancelled', body: 'BRUCE WAYNE sent you $12.00' })).kind).toBe('unrecognized');
    expect(parseInteracEmail(email({ subject: 'INTERAC e-Transfer: your transfer expired', body: 'sent you $12.00' })).kind).toBe('unrecognized');
  });

  it('an outgoing confirmation (money the admin sent)', () => {
    const r = parseInteracEmail(email({ subject: 'INTERAC e-Transfer: Your money transfer to BRUCE WAYNE was deposited.', body: 'Your transfer of $12.00 was deposited.' }));
    expect(r.kind).toBe('unrecognized');
  });

  it('wording it cannot read is reported, not dropped', () => {
    const r = parseInteracEmail(email({ subject: 'INTERAC e-Transfer: something new', body: 'Someone sent you a thing' }));
    expect(r.kind).toBe('unrecognized');
    expect(r.authenticated).toBe(true);
  });
});

describe('anti-spoof', () => {
  const body = 'BRUCE WAYNE has sent you $12.00 (CAD).';
  const subject = 'INTERAC e-Transfer: BRUCE WAYNE sent you money.';

  it('a perfect body with no authentication is unauthenticated', () => {
    const r = parseInteracEmail(email({ subject, body, authResults: undefined }));
    expect(r.kind).toBe('received');
    expect(r.authenticated).toBe(false);
  });

  it('a forged From with DKIM from the attacker domain fails', () => {
    const auth = 'mx.google.com; dkim=pass header.i=@evil.example header.s=x; spf=pass smtp.mailfrom=a@evil.example; dmarc=fail header.from=payments.interac.ca';
    expect(parseInteracEmail(email({ subject, body, authResults: auth })).authenticated).toBe(false);
  });

  it('a header not stamped by Google fails even if it says pass', () => {
    const auth = 'evil.example; dkim=pass header.i=@payments.interac.ca';
    expect(isInteracAuthenticated(auth, FROM)).toBe(false);
  });

  it('DKIM pass for Interac but a From on another domain fails (no alignment)', () => {
    expect(isInteracAuthenticated(GOOD_AUTH, 'Bruce <bruce@gmail.com>')).toBe(false);
  });

  it('a lookalike domain fails', () => {
    const auth = 'mx.google.com; dkim=pass header.d=notinterac.ca';
    expect(isInteracAuthenticated(auth, 'x <notify@notinterac.ca>')).toBe(false);
    const auth2 = 'mx.google.com; dkim=pass header.d=interac.ca.evil.example';
    expect(isInteracAuthenticated(auth2, 'x <notify@interac.ca.evil.example>')).toBe(false);
  });

  it('dkim=fail is not dkim=pass', () => {
    expect(isInteracAuthenticated('mx.google.com; dkim=fail header.i=@payments.interac.ca', FROM)).toBe(false);
  });
});

describe('parseAmountCents', () => {
  it.each([
    ['$12.00', 1200],
    ['$ 7.50 (CAD)', 750],
    ['$1,234.56', 123456],
    ['$1234.56', 123456],
    ['12,00 $', 1200],
    ['1 234,50 $', 123450],
    ['no money here', null],
  ])('%s → %s', (text, cents) => {
    expect(parseAmountCents(text)).toBe(cents);
  });
});
