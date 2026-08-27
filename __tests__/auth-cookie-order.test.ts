import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { NextResponse } from 'next/server';
import { setupAdminPin } from './helpers';
import { completeSignIn } from '../lib/authSession';
import { clearOAuthCookies } from '../lib/oauthState';

/**
 * The cookie-ordering hazard, and why it needs BOTH a behavioural and a
 * structural test.
 *
 * `clearAdminCookie` APPENDS its two `Set-Cookie` headers by hand, because
 * Next's ResponseCookies map is keyed by cookie NAME and so cannot represent
 * the same cookie at two paths. But every `res.cookies.set()` re-serializes
 * that whole map — silently discarding anything appended earlier.
 *
 * So a `.set()` AFTER `completeSignIn` deletes its admin clears. The concrete
 * failure: an admin's device still holds `admin_session`; a non-admin signs in
 * with Google; the callback mints their `member_session` but the stale admin
 * cookie survives, and `isAdminAuthed` (the sync, no-role-recheck path used by
 * read-only admin routes) keeps accepting it.
 *
 * lib/auth.ts and lib/authSession.ts both warn about this in prose. It was
 * violated at three call sites anyway, which is the case for a test: a comment
 * cannot fail a build.
 */
beforeEach(() => setupAdminPin());

describe('cookie ordering — behaviour', () => {
  it('a cookies.set after completeSignIn DOES drop the admin clears', () => {
    // Pinning the hazard itself, so the reason for the rule stays visible.
    const res = NextResponse.json({ ok: true });
    completeSignIn(res, { id: 'm1', name: 'Lin', role: 'member' });
    expect(res.headers.getSetCookie().filter((h) => h.startsWith('admin_session=;'))).toHaveLength(2);

    clearOAuthCookies(res); // the mistake
    expect(res.headers.getSetCookie().filter((h) => h.startsWith('admin_session=;'))).toHaveLength(0);
  });

  it('clearing BEFORE completeSignIn keeps them', () => {
    const res = NextResponse.json({ ok: true });
    clearOAuthCookies(res);
    completeSignIn(res, { id: 'm1', name: 'Lin', role: 'member' });

    const headers = res.headers.getSetCookie();
    expect(headers.filter((h) => h.startsWith('admin_session=;'))).toHaveLength(2);
    expect(headers.some((h) => h.startsWith('member_session='))).toBe(true);
  });
});

/**
 * Structural half: catches a NEW call site getting the order wrong, which the
 * behavioural test above cannot see.
 */
function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

describe('cookie ordering — structure', () => {
  const files = ['app', 'lib']
    .flatMap((r) => sourceFiles(join(process.cwd(), r)))
    .map((f) => f.replace(process.cwd() + '/', ''))
    .filter((f) => readFileSync(f, 'utf8').includes('completeSignIn(res'));

  it('finds the sign-in terminus call sites', () => {
    expect(files.length).toBeGreaterThanOrEqual(3);
  });

  it.each(files)('%s sets no cookies after completeSignIn', (file) => {
    const lines = readFileSync(file, 'utf8').split('\n');
    const lastSignIn = lines.reduce((acc, l, i) => (l.includes('completeSignIn(res') ? i : acc), -1);
    const offenders = lines
      .map((l, i) => ({ l, i }))
      .filter(
        ({ l, i }) =>
          i > lastSignIn &&
          (l.includes('clearOAuthCookies(') ||
            l.includes('clearPendingSignup(') ||
            /res\.cookies\.set\(/.test(l)),
      )
      .map(({ i, l }) => `line ${i + 1}: ${l.trim()}`);

    expect(
      offenders,
      `${file}: these run after completeSignIn and will drop its appended ` +
        `admin_session clears — move them above it`,
    ).toEqual([]);
  });
});
