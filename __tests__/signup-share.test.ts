// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { buildSignupShare } from '../lib/signupShare';

/**
 * The "sign-ups are open, here's the link" message.
 *
 * It lived in two components that each built it their own way, and the two
 * copies had already drifted into two real defects: the club's name was the
 * literal string 'BPM Badminton' in four places, and one of them called
 * `navigator.share` by hand without marking the external excursion — so iOS
 * evicting the PWA mid-share returned the admin to Home. Both are the shape
 * CLAUDE.md warns about: a rule added to a shared function is worthless if a
 * caller reimplemented it.
 */
describe('buildSignupShare', () => {
  it('names the club, not the deployment', () => {
    const { text, title } = buildSignupShare({ groupName: 'Tuesday Smash', inviteUrl: 'https://x/bpm/?join=t' });
    expect(title).toBe('Tuesday Smash');
    expect(text).toContain('Tuesday Smash');
    expect(text).not.toContain('BPM Badminton');
  });

  it('falls back to the deployment name when there is no club', () => {
    // Flag off, or a read that has not resolved. Not an error state.
    expect(buildSignupShare({ inviteUrl: null }).title).toBe('BPM Badminton');
    expect(buildSignupShare({ groupName: '   ', inviteUrl: null }).title).toBe('BPM Badminton');
  });

  it('SHARES THE INVITE LINK when the club has one', () => {
    // The whole point: the club chat forwards this to someone who has never
    // opened the app, and they land on the join step for THAT club rather than
    // a generic front door.
    const { url, text } = buildSignupShare({ inviteUrl: 'https://bpm.example/bpm/?join=abc123' });
    expect(url).toBe('https://bpm.example/bpm/?join=abc123');
    expect(text).toContain('?join=abc123');
  });

  it('falls back to the plain app URL with no invite', () => {
    const { url } = buildSignupShare({ inviteUrl: null });
    // A non-admin, or the flag off. Still a usable link for someone already in.
    expect(url).toContain(window.location.origin);
    expect(url).not.toContain('?join=');
  });

  it('adds the date, and survives one it cannot parse', () => {
    expect(buildSignupShare({ datetime: '2026-09-18T19:00:00-07:00' }).text).toMatch(/\(.+\)/);
    // An unparseable date loses the aside rather than throwing mid-share.
    expect(() => buildSignupShare({ datetime: 'not a date' })).not.toThrow();
    expect(buildSignupShare({ datetime: 'not a date' }).text).not.toContain('(');
  });
});

/**
 * Comments are stripped before these scan. The first cut did not, and failed on
 * the sentences EXPLAINING the fix — a canary that reads its own documentation
 * as a violation is one nobody will trust the third time it fires.
 */
function code(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((l) => l.replace(/\/\/.*$/, ''))
    .join('\n');
}

describe('both share sites go through the one path', () => {
  const advance = code('components/admin/AdvanceSessionForm.tsx');
  const nextCard = code('components/admin/CommandCenter/NextSessionCard.tsx');

  it('neither hand-rolls navigator.share', () => {
    // `shareTextOrCopy` marks the external excursion on BOTH its branches. A
    // hand-rolled `navigator.share` cannot, and that is exactly the bug this
    // consolidation fixed in NextSessionCard.
    expect(advance).not.toMatch(/navigator\s*(as[^)]*)?\)?\s*\.share|navAny\.share/);
    expect(nextCard).not.toMatch(/navigator\s*(as[^)]*)?\)?\s*\.share|navAny\.share/);
  });

  it('neither says the deployment name out loud', () => {
    // Four hardcoded occurrences is what made this a multi-tenant bug rather
    // than a cosmetic one.
    expect(advance).not.toContain("'BPM Badminton'");
    expect(nextCard).not.toContain("'BPM Badminton'");
  });

  it('both call the shared builder', () => {
    expect(advance).toContain('shareSignup(');
    expect(nextCard).toContain('shareSignup(');
  });
});
