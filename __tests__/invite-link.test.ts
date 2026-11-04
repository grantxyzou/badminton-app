import { describe, it, expect } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from '@/app/j/[token]/route';
import { invitePath, isInviteToken, tokenFromInvitePath, INVITE_LINK_SEGMENT } from '@/lib/inviteLink';
import { inviteUrl } from '@/lib/useInvites';

/**
 * The one link (docs/superpowers/plans/2026-11-04-app-clip.md, Task 1.1).
 * `/bpm/j/<token>` opens the app, the clip or the website. On the website it
 * must land on the `?join=` page that has always taken invites, unchanged.
 */
const TOKEN = 'a1'.repeat(16);

async function follow(token: string) {
  const req = new NextRequest(`https://bpm.grantzou.com/bpm/j/${token}`);
  return GET(req, { params: Promise.resolve({ token }) });
}

describe('the link format', () => {
  it('builds and reads back the same path', () => {
    expect(invitePath(TOKEN, '/bpm')).toBe(`/bpm/j/${TOKEN}`);
    expect(tokenFromInvitePath(invitePath(TOKEN, '/bpm'), '/bpm')).toBe(TOKEN);
  });

  it('accepts a trailing slash and an upper-cased copy, and lower-cases it', () => {
    expect(tokenFromInvitePath(`/bpm/j/${TOKEN}/`, '/bpm')).toBe(TOKEN);
    expect(tokenFromInvitePath(`/bpm/j/${TOKEN.toUpperCase()}`, '/bpm')).toBe(TOKEN);
  });

  it('refuses anything that is not exactly an invite', () => {
    expect(tokenFromInvitePath(`/bpm/j/${TOKEN}/extra`, '/bpm')).toBeNull();
    expect(tokenFromInvitePath('/bpm/j/short', '/bpm')).toBeNull();
    expect(tokenFromInvitePath(`/j/${TOKEN}`, '/bpm')).toBeNull();
    expect(tokenFromInvitePath(`/bpm/migrate`, '/bpm')).toBeNull();
    expect(tokenFromInvitePath(`/bpm/api/auth/google/callback`, '/bpm')).toBeNull();
    expect(isInviteToken('g'.repeat(32))).toBe(false);
  });

  it('is what the Invite card shares', () => {
    expect(inviteUrl(TOKEN)).toMatch(new RegExp(`${INVITE_LINK_SEGMENT}${TOKEN}$`));
    expect(inviteUrl(TOKEN)).not.toContain('?join=');
  });
});

describe('GET /bpm/j/<token> on the website', () => {
  it('sends the browser to the ?join= page with the token intact', async () => {
    const res = await follow(TOKEN);
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe(`/bpm?join=${TOKEN}`);
  });

  it('is relative, so no request header is baked into the link', async () => {
    const res = await follow(TOKEN);
    expect(res.headers.get('location')!.startsWith('/')).toBe(true);
  });

  it('is never cached', async () => {
    const res = await follow(TOKEN);
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('lower-cases an upper-cased token, since the server looks it up by hash', async () => {
    const res = await follow(TOKEN.toUpperCase());
    expect(res.headers.get('location')).toBe(`/bpm?join=${TOKEN}`);
  });

  it('sends a malformed token to the one "used or expired" page, never echoing it', async () => {
    for (const bad of ['short', '<script>', `${TOKEN}zz`]) {
      const res = await follow(bad);
      const location = res.headers.get('location')!;
      expect(location).toBe(`/bpm?join=${'0'.repeat(32)}`);
      expect(location).not.toContain(bad);
    }
  });
});
