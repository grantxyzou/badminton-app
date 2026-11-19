import { describe, it, expect } from 'vitest';
import { racketCard, racketPictureUrl, stringTags, emailHtml, escapeHtml } from '@/lib/emailLayout';
import { composeInvoiceEmail } from '@/lib/stringingInvoice';
import { composeWalkUpEmail } from '@/lib/stringingWalkUpEmail';
import { composeEmail } from '@/lib/stringingNotifyEmail';
import { buildPlayerNotice } from '@/lib/stringingNotify';
import type { StringingJob } from '@/lib/types';

/**
 * The branded email frame (docs/plans/branded-emails.md). jsdom is not a mail
 * client, so these read the HTML as text: what the frame must say and how
 * many times, which is all a test can know about an email.
 */

const ORIGIN = 'https://bpm.example.test';

function job(over: Partial<StringingJob> = {}): StringingJob {
  return {
    id: 'j1',
    memberId: 'm1',
    jobNo: 'J-0042',
    memberName: 'Lin',
    stringerId: null,
    stringerName: null,
    status: 'ready',
    racketLabel: 'Yonex Astrox 88D Pro',
    stringLabel: 'BG80',
    stringColor: 'White',
    tensionMains: 26,
    tensionCrosses: 28,
    priceCents: 3000,
    readyBy: null,
    method: '',
    acceptedAt: null,
    paidAt: null,
    sessionId: null,
    history: [],
    createdAt: '2026-11-18T00:00:00.000Z',
    ...over,
  } as StringingJob;
}

/** How many times `needle` is DRAWN: the hidden inbox preview line is not. */
function shown(html: string, needle: string): number {
  const visible = html.replace(/<div style="display:none[^"]*">[^<]*<\/div>/, '');
  return visible.split(needle).length - 1;
}

describe('the racket picture', () => {
  it('a catalog racket shows its own render', () => {
    expect(racketPictureUrl(ORIGIN, 'racket-yonex-astrox-88d-pro')).toBe(`${ORIGIN}/rackets/racket-yonex-astrox-88d-pro.webp`);
  });

  it('anything else shows the matte black one, never the BPM-coloured default', () => {
    expect(racketPictureUrl(ORIGIN, null)).toBe(`${ORIGIN}/rackets/_unknown.webp`);
    expect(racketPictureUrl(ORIGIN, 'racket-nobody-makes')).toBe(`${ORIGIN}/rackets/_unknown.webp`);
  });

  it('no origin, no picture (a test, or a deployment with no APP_ORIGIN)', () => {
    expect(racketPictureUrl(null, 'racket-yonex-astrox-88d-pro')).toBeNull();
  });
});

describe('the strings, as the bench reads them', () => {
  it('draws M and C with their tensions', () => {
    const html = racketCard({ job: job(), pictureUrl: null, refs: {}, facts: [], cost: null });
    expect(html).toContain('>M<');
    expect(html).toContain('>C<');
    expect(html).toContain('26 lb');
    expect(html).toContain('28 lb');
  });

  it('tags a custom tension, a two-colour set and the player’s own string; two strings need no tag', () => {
    expect(stringTags(job({ tensionMains: 28, tensionCrosses: 26 })).map((t) => t.text)).toEqual(['Custom tension']);
    // The M and C lines already name both strings.
    expect(stringTags(job({ stringLabel: 'Exbolt 63 / BG80 Power' }))).toEqual([]);
    expect(stringTags(job({ stringColor: 'Red/White' })).map((t) => t.text)).toEqual(['Two-colour set']);
    expect(stringTags(job({ ownString: true })).map((t) => t.text)).toEqual(['Your own string']);
    expect(stringTags(job())).toEqual([]);
  });

  it('a colour it cannot read is a hollow dot, never a guess', () => {
    const html = racketCard({ job: job({ stringColor: 'Sunset haze' }), pictureUrl: null, refs: {}, facts: [], cost: null });
    expect(html).not.toContain('background:var(');
    expect(html).toContain('border:1px solid');
  });

  it('escapes everything a person typed', () => {
    const html = racketCard({ job: job({ racketLabel: '<img src=x onerror=alert(1)>' }), pictureUrl: null, refs: {}, facts: [], cost: null });
    expect(html).not.toContain('<img src=x');
    expect(html).toContain(escapeHtml('<img src=x onerror=alert(1)>'));
  });
});

describe('the cost is drawn once', () => {
  it('invoice: the amount in the card, and the button says Pay now', () => {
    const { html } = composeInvoiceEmail(job(), { clubName: 'BPM Core', appUrl: `${ORIGIN}/bpm/?tab=home` });
    expect(shown(html, '$30')).toBe(1);
    // The invoice and job numbers sit across the top of the card, invoice first.
    expect(html.indexOf('INV-0042')).toBeLessThan(html.indexOf('J-0042', html.indexOf('INV-0042')));
    expect(html.indexOf('INV-0042')).toBeLessThan(html.indexOf('>Racket<'));
    expect(html).toContain('>Pay now<');
  });

  it('walk-up ready: the amount in the card, not again in the sentence', () => {
    const { html, text } = composeWalkUpEmail('ready', job({ walkUp: true }), 'BPM Core');
    expect(shown(html, '$30')).toBe(1);
    expect(html).toContain('Pay at pickup');
    // The plain text is unchanged.
    expect(text).toContain('Bring $30 or pay your stringer at pickup.');
  });

  it('an unpriced job says Ask, not $0', () => {
    const { html } = composeWalkUpEmail('spec', job({ walkUp: true, priceCents: null }), 'BPM Core');
    expect(html).toContain('>Ask<');
    expect(html).not.toContain('$0');
  });
});

describe('the member’s stringing email', () => {
  it('has no stage tracker (Grant, 2026-11-19: "useless")', () => {
    const copy = composeEmail(buildPlayerNotice(job({ status: 'strung' })), 'Lin', 'BPM Core')!;
    expect(copy.html).not.toContain('Waiting for your racket');
    expect(copy.subject).toBe('Your racket is on the bench — J-0042');
  });

  it('keeps the plain text word for word', () => {
    const copy = composeEmail(buildPlayerNotice(job()), 'Lin', 'BPM Core')!;
    expect(copy.text).toBe('Hi Lin,\n\nYonex Astrox 88D Pro (J-0042) is strung and ready to pick up.\nQuote: $30\n\nSee you on the court.\n— BPM Core');
  });
});

describe('the frame', () => {
  it('loads the logo from the origin and shows the brand line', () => {
    const html = emailHtml({ origin: ORIGIN, tag: 'Test', preheader: 'p', body: '', footer: 'f' });
    expect(html).toContain(`${ORIGIN}/brand/email/bpm-mark.png`);
    expect(html).toContain('MOTIONCRAFT STUDIO');
  });

  it('draws no picture at all without an origin', () => {
    expect(emailHtml({ origin: null, tag: 'Test', preheader: 'p', body: '', footer: 'f' })).not.toContain('<img');
  });

});
