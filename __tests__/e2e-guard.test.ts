/**
 * The end-to-end tour's safety wall (docs/plans/e2e-test-club.md, Safety rules).
 *
 * The tour signs in to PRODUCTION as the E2E test club's personas. What keeps
 * it out of every other club is `clubGuard` in `e2e/session.ts`, and what
 * keeps its passwords out of logs is `parseAccounts` in `e2e/personas.ts`.
 * Neither runs in this suite otherwise (Playwright runs the tour, and only
 * when someone starts it), so a regression in either would be invisible
 * until it mattered.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Page } from '@playwright/test';
import { clubGuard, E2E_CLUB_NAME, joinerGuard } from '../e2e/session';
import { isJoiner, parseAccounts } from '../e2e/personas';
import { assertMockIsLocal, baseUrl, PROD_BASE, target } from '../e2e/target';

const ENV_KEYS = ['E2E_TARGET', 'E2E_BASE_URL', 'E2E_GROUP_ID'] as const;
let saved: Record<string, string | undefined>;
beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

/**
 * A page whose API answers are canned: `/api/groups/mine` and `/current`, and
 * `/api/groups/switch`, which moves the fake cookie and is recorded so a test
 * can assert the guard never switched.
 */
function fakePage(
  mine: { groups: Array<{ id: string; name: string }>; currentGroupId: string },
  currentFor: (groupId: string) => unknown,
): Page & { switches: string[] } {
  const answer = (body: unknown, status = 200) => ({ ok: () => status < 400, status: () => status, json: async () => body });
  let cookieGroup = mine.currentGroupId;
  const switches: string[] = [];
  return {
    switches,
    request: {
      get: async (url: string) =>
        url.endsWith('/api/groups/mine')
          ? answer({ ...mine, currentGroupId: cookieGroup })
          : cookieGroup === 'bpm' && !mine.groups.some((g) => g.id === 'bpm')
            ? answer({ error: 'unauthorized' }, 401)
            : answer(currentFor(cookieGroup)),
      post: async (url: string, opts: { data: { groupId: string } }) => {
        if (!url.endsWith('/api/groups/switch')) throw new Error(`unexpected POST ${url}`);
        switches.push(opts.data.groupId);
        cookieGroup = opts.data.groupId;
        return answer({ ok: true });
      },
    },
  } as unknown as Page & { switches: string[] };
}

const persona = { label: 'player1', kind: 'password' as const, email: 'x@example.com', password: 'p' };
const E2E = { id: 'g-e2e', name: E2E_CLUB_NAME };

describe('clubGuard on production', () => {
  beforeEach(() => {
    process.env.E2E_TARGET = 'prod';
  });

  it('passes a persona whose only club is the E2E test club', async () => {
    const page = fakePage({ groups: [E2E], currentGroupId: 'g-e2e' }, () => ({ ...E2E, role: 'member' }));
    await expect(clubGuard(page, persona)).resolves.toMatchObject({ groupId: 'g-e2e', privileged: false });
    expect(page.switches).toEqual([]);
  });

  it('taps into the one E2E club when a fresh sign-in landed in BPM', async () => {
    // What a password sign-in does: no club asked for, so the cookie names BPM.
    const page = fakePage({ groups: [E2E], currentGroupId: 'bpm' }, () => ({ ...E2E, role: 'owner' }));
    await expect(clubGuard(page, persona)).resolves.toMatchObject({ groupId: 'g-e2e', role: 'owner' });
    expect(page.switches).toEqual(['g-e2e']);
  });

  it('reads an organiser from the server, not from the label', async () => {
    const page = fakePage({ groups: [E2E], currentGroupId: 'g-e2e' }, () => ({ ...E2E, role: 'owner' }));
    await expect(clubGuard(page, persona)).resolves.toMatchObject({ role: 'owner', privileged: true });
  });

  it('refuses a persona that also belongs to another club', async () => {
    const page = fakePage(
      { groups: [E2E, { id: 'bpm', name: 'BPM Core' }], currentGroupId: 'bpm' },
      () => ({ ...E2E, role: 'member' }),
    );
    await expect(clubGuard(page, persona)).rejects.toThrow(/belongs to 2 clubs/);
    // Refused BEFORE any switch: the cookie never moved.
    expect(page.switches).toEqual([]);
  });

  it('refuses a session pointed at any other club', async () => {
    const page = fakePage({ groups: [{ id: 'bpm', name: 'BPM Core' }], currentGroupId: 'bpm' }, () => ({ id: 'bpm', name: 'BPM Core', role: 'owner' }));
    await expect(clubGuard(page, persona)).rejects.toThrow(/club guard refused/);
    expect(page.switches).toEqual([]);
  });

  it('refuses a club with the right name and the wrong pinned id', async () => {
    process.env.E2E_GROUP_ID = 'g-other';
    const page = fakePage({ groups: [E2E], currentGroupId: 'bpm' }, () => ({ ...E2E, role: 'member' }));
    await expect(clubGuard(page, persona)).rejects.toThrow(/E2E_GROUP_ID/);
    expect(page.switches).toEqual([]);
  });

  it('refuses when the club list cannot be read', async () => {
    const page = {
      request: {
        get: async () => ({ ok: () => false, status: () => 401, json: async () => ({}) }),
        post: async () => {
          throw new Error('must not switch');
        },
      },
    } as unknown as Page;
    await expect(clubGuard(page, persona)).rejects.toThrow(/answered 401/);
  });
});

describe('joinerGuard', () => {
  it('passes a joiner in no club', async () => {
    const page = fakePage({ groups: [], currentGroupId: 'bpm' }, () => ({}));
    await expect(joinerGuard(page, persona)).resolves.toBeUndefined();
  });

  it('refuses a joiner who is in any club, the E2E club included', async () => {
    for (const groups of [[E2E], [{ id: 'bpm', name: 'BPM Core' }]]) {
      const page = fakePage({ groups, currentGroupId: groups[0].id }, () => ({}));
      await expect(joinerGuard(page, persona)).rejects.toThrow(/must be in none/);
      expect(page.switches).toEqual([]);
    }
  });
});

describe('E2E_ACCOUNTS parsing', () => {
  it('reads label → email and password', () => {
    const list = parseAccounts(JSON.stringify({ organiser: { email: 'a@x.com', password: 'pw1' }, joiner: { email: 'b@x.com', password: 'pw2' } }));
    expect(list.map((p) => p.label)).toEqual(['organiser', 'joiner']);
    expect(list.filter(isJoiner).map((p) => p.label)).toEqual(['joiner']);
  });

  it('never repeats the secret in an error', () => {
    const secret = '{"organiser":{"email":"a@x.com","password":"hunter2"';
    expect(() => parseAccounts(secret)).toThrow();
    try {
      parseAccounts(secret);
    } catch (e) {
      expect(String(e)).not.toContain('hunter2');
    }
    try {
      parseAccounts(JSON.stringify({ p: { email: 'a@x.com', password: 7 } }));
    } catch (e) {
      expect(String(e)).toContain('"p"');
      expect(String(e)).not.toContain('a@x.com');
    }
  });

  it('refuses an empty or missing secret', () => {
    expect(() => parseAccounts(undefined)).toThrow(/not set/);
    expect(() => parseAccounts('{}')).toThrow(/no accounts/);
  });
});

describe('the target', () => {
  it('defaults to the mock, and production must be named', () => {
    expect(target()).toBe('mock');
    process.env.E2E_TARGET = 'production';
    expect(() => target()).toThrow();
    process.env.E2E_TARGET = 'prod';
    expect(baseUrl()).toBe(PROD_BASE);
  });

  it('refuses to send the seeded PINs to a host that is not this machine', () => {
    process.env.E2E_BASE_URL = 'https://bpm.grantzou.com/bpm';
    expect(() => assertMockIsLocal()).toThrow(/non-local/);
    process.env.E2E_BASE_URL = 'http://localhost:3100/bpm';
    expect(() => assertMockIsLocal()).not.toThrow();
  });
});

describe('every sign-in in the tour passes the guard', () => {
  const dir = join(process.cwd(), 'e2e');
  // session.ts DEFINES signIn; every other file that calls it is checked.
  const files = readdirSync(dir).filter((f) => f.endsWith('.ts') && f !== 'session.ts');

  it('finds the sign-ins to check', () => {
    const callers = files.filter((f) => /\bawait signIn\(/.test(readFileSync(join(dir, f), 'utf8')));
    expect(callers.length).toBeGreaterThan(0);
  });

  it.each(files)('%s calls a guard right after every signIn', (file) => {
    const src = readFileSync(join(dir, file), 'utf8');
    const calls = src.match(/await signIn\([^)]*\);[^\n]*\n[^\n]*/g) ?? [];
    for (const call of calls) {
      // The joiner's own guard (no club at all) counts: it is stricter.
      expect(call, `${file} signs in without the club guard`).toMatch(/\n\s*(?:(?:const|let)\s+)?(?:\w+\s*=\s*)?await (?:clubGuard|joinerGuard)\(/);
    }
  });

  it('the cached-cookie path runs the guard too, and retries only a 401', () => {
    const src = readFileSync(join(dir, 'journey.ts'), 'utf8');
    expect(src).toMatch(/if \(cached\) \{\s*who = await clubGuard\(/);
    expect(src).toMatch(/answered 401/);
  });

  it('the signed-in cookies are kept out of the uploaded results', () => {
    const setup = readFileSync(join(dir, 'global-setup.ts'), 'utf8');
    // The folder is made in the system's temp space, never under e2e-results/.
    expect(setup).toMatch(/mkdtempSync\(join\(process\.env\.RUNNER_TEMP \|\| tmpdir\(\),/);
  });
});
