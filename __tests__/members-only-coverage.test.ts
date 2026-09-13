import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative, sep } from 'path';
import type { NextRequest } from 'next/server';
import {
  resetMockStore,
  setupAdminPin,
  seedMember,
  seedTestAdminMember,
  makeRequest,
  memberCookieValue,
  adminCookieValue,
} from './helpers';

import { GET as playersGET } from '@/app/api/players/route';
import { GET as sessionGET } from '@/app/api/session/route';
import { GET as membersGET } from '@/app/api/members/route';
import { GET as membersMeGET } from '@/app/api/members/me/route';
import { GET as announcementsGET } from '@/app/api/announcements/route';
import { GET as gamesGET } from '@/app/api/games/route';
import { GET as gearGET } from '@/app/api/equipment/gear/route';
import { GET as shopGET } from '@/app/api/stringing/shop/route';
import { GET as stringsGET } from '@/app/api/stringing/strings/route';
import { GET as pricingGET } from '@/app/api/stringing/pricing/route';
import { GET as clubGearGET } from '@/app/api/stats/club/gear/route';
import { GET as recommendGET } from '@/app/api/recommend/route';

/**
 * MEMBERS ONLY (docs/plans/members-only.md): with `NEXT_PUBLIC_FLAG_MEMBERS_ONLY`
 * on, a signed-out visitor must get NO club data from any route.
 *
 * Hiding the UI was never the boundary. On 2026-09-13 a stranger could read the
 * roster — with who had paid and who owed — the session's date and location,
 * the announcement, and whether any given name had an account and a PIN, all
 * without a cookie, while the signed-out screens showed none of it.
 *
 * So this canary classifies EVERY `GET` route under `app/api`, not only the
 * ones gated today. A route in none of the three lists fails the build: adding
 * a new public read is a decision somebody has to write down, not a default.
 *
 * - `GATED` routes call `requireMember(req)` before they read anything.
 * - `AUTHED` routes already refuse a signed-out caller through another helper.
 *   The source check below is a TRIPWIRE for that helper being removed — it is
 *   not proof every branch is covered. `games` is the reason to be modest about
 *   that: its `?all=true` branch called `ownsNameOrAdmin` while its default
 *   branch was public, and a presence check would have called it guarded.
 * - `PUBLIC` routes return nothing about the club, each with the reason.
 */

type Entry = { kind: 'gated' } | { kind: 'authed'; helper: string } | { kind: 'public'; reason: string };

const GATED: Entry = { kind: 'gated' };
const admin = (helper = 'isAdminAuthed'): Entry => ({ kind: 'authed', helper });
const owner: Entry = { kind: 'authed', helper: 'ownsNameOrAdmin' };

const ROUTES: Record<string, Entry> = {
  // ── Club data, members only ──────────────────────────────────────────────
  players: GATED,
  session: GATED,
  members: GATED,
  'members/me': GATED,
  announcements: GATED,
  games: GATED,
  'equipment/gear': GATED,
  'stringing/shop': GATED,
  'stringing/strings': GATED,
  'stringing/pricing': GATED,
  'stats/club/gear': GATED,
  recommend: GATED,

  // ── Already refused to a signed-out caller ───────────────────────────────
  'admin/access-requests': admin(),
  'admin/anomalies': admin('isAdminAuthedWithMember'),
  'admin/fit-preview': admin(),
  'admin/ledger': admin(),
  'admin/migrate-groups': admin('isAdminAuthedWithMember'),
  'admin/owed-audit': admin(),
  'admin/settings': admin('isAdminAuthedWithMember'),
  'admin/slice0': admin(),
  aliases: admin(),
  birds: admin(),
  'members/[id]/history': admin(),
  sessions: admin(),
  'sessions/costs': admin(),
  'sessions/history': admin('isAdminAuthedWithMember'),
  'sessions/locations': admin(),
  'sessions/recent': admin(),
  skills: admin(),
  'stringing/stringers': admin(),
  'groups/invite': admin('isAdminAuthedWithMember'),
  assessments: owner,
  kudos: owner,
  'players/unpaid': owner,
  'stats/attendance': owner,
  'stats/club/bands': owner,
  'stats/drills': owner,
  'stats/insight': owner,
  'stats/level': owner,
  'stats/partners': owner,
  'kudos/eligible': { kind: 'authed', helper: 'verifyMemberAuth' },
  'groups/mine': { kind: 'authed', helper: 'verifyMemberAuth' },
  'groups/current': { kind: 'authed', helper: 'requireGroupMember' },
  'stringing/jobs': { kind: 'authed', helper: 'verifyMemberAuth' },

  // ── Public by design: nothing about the club ─────────────────────────────
  admin: { kind: 'public', reason: 'the admin-status probe: answers only `authed`' },
  'auth/me': { kind: 'public', reason: 'answers only whether THIS device is signed in' },
  'auth/methods': { kind: 'public', reason: 'signed out, it lists only which providers the deployment offers' },
  'auth/apple/start': { kind: 'public', reason: 'redirects into Apple sign-in' },
  'auth/google/start': { kind: 'public', reason: 'redirects into Google sign-in' },
  'auth/google/callback': { kind: 'public', reason: 'the OAuth return; it is how a visitor BECOMES signed in' },
  'auth/verify-email': { kind: 'public', reason: 'consumes an emailed token' },
  'auth/complete-signup': { kind: 'public', reason: 'reads only the signed pending-signup cookie' },
  'groups/preview': { kind: 'public', reason: 'an invite preview: the club NAME for a valid invite, one 404 otherwise' },
  releases: { kind: 'public', reason: 'app release notes, not club data (global container)' },
  'equipment/catalog': { kind: 'public', reason: 'the global racket/string catalog, not club data' },
};

const API_ROOT = join(process.cwd(), 'app', 'api');

function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return routeFiles(full);
    return name === 'route.ts' ? [full] : [];
  });
}

/** The text of the `GET` handler: from its declaration to the next exported function. */
function getBody(source: string): string | null {
  const start = source.search(/export (async )?function GET\s*\(/);
  if (start === -1) return null;
  const rest = source.slice(start + 1);
  const next = rest.search(/\nexport (async )?function [A-Z]+\s*\(/);
  return next === -1 ? rest : rest.slice(0, next);
}

const routesWithGet = routeFiles(API_ROOT)
  .map((file) => ({
    key: relative(API_ROOT, file).split(sep).slice(0, -1).join('/'),
    body: getBody(readFileSync(file, 'utf8')),
  }))
  .filter((r): r is { key: string; body: string } => r.body !== null);

describe('every GET route is classified', () => {
  it('has no GET route in none of the lists', () => {
    const unclassified = routesWithGet.map((r) => r.key).filter((k) => !(k in ROUTES));
    expect(
      unclassified,
      'Classify these in __tests__/members-only-coverage.test.ts: GATED (call requireMember), AUTHED (name the helper), or PUBLIC (say why it holds no club data).',
    ).toEqual([]);
  });

  it('names no route that does not exist', () => {
    const present = new Set(routesWithGet.map((r) => r.key));
    expect(Object.keys(ROUTES).filter((k) => !present.has(k))).toEqual([]);
  });
});

describe('the source matches the classification', () => {
  // Anything that reads club data. The gate has to come BEFORE the first one —
  // a check after the read has already paid for the leak in a log line or an
  // error path.
  const READS = [
    'groupScope(', 'getContainer(', 'getActiveSessionId(', 'ensureContainer(', 'ensureGames(',
    'ensureGear(', 'readActiveAnnouncements(', 'rosterMembers(', 'rosterMemberIds(', 'readShopOpen(',
    'readOfferedStrings(', 'readPricing(', 'resolveActiveMemberId(', '.query(',
  ];

  for (const { key, body } of routesWithGet) {
    const entry = ROUTES[key];
    if (!entry || entry.kind === 'public') continue;

    if (entry.kind === 'gated') {
      it(`${key}: calls requireMember before its first read`, () => {
        const gate = body.indexOf('requireMember(req)');
        expect(gate, `${key} GET never calls requireMember(req)`).toBeGreaterThan(-1);
        const firstRead = Math.min(...READS.map((r) => body.indexOf(r)).filter((i) => i > -1));
        if (Number.isFinite(firstRead)) {
          expect(gate, `${key} reads club data before its gate`).toBeLessThan(firstRead);
        }
      });
    } else {
      it(`${key}: still calls ${entry.helper}`, () => {
        expect(body).toContain(`${entry.helper}(`);
      });
    }
  }
});

describe('server-rendered pages do not bypass the gate', () => {
  // A route gate is worthless if a page reads the same data and hands it to a
  // client component as a prop: the prop is serialized into the HTML for every
  // visitor. `app/page.tsx` did exactly this with the announcement, caught by
  // the review bot on #395 after the route itself was gated.
  it('app/page.tsx reads the announcement only when members-only is off', () => {
    const source = readFileSync(join(process.cwd(), 'app', 'page.tsx'), 'utf8');
    const read = source.indexOf('readActiveAnnouncements(');
    expect(read, 'app/page.tsx no longer reads announcements — update this test').toBeGreaterThan(-1);
    const guard = source.lastIndexOf('membersOnlyOn()', read);
    expect(guard, 'app/page.tsx reads announcements without a membersOnlyOn() guard').toBeGreaterThan(-1);
    // The guard must be the ternary that owns this read, not a mention elsewhere.
    expect(source.slice(guard, read)).toMatch(/membersOnlyOn\(\)\s*\?\s*null\s*:/);
  });
});

describe('behaviour of the gated routes', () => {
  const FLAGS = ['NEXT_PUBLIC_FLAG_MEMBERS_ONLY', 'NEXT_PUBLIC_FLAG_VALUE_HUB_SLICE', 'NEXT_PUBLIC_FLAG_STRINGING'] as const;
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    resetMockStore();
    // Sets SESSION_SECRET, without which no test cookie verifies and every
    // "not refused" case would fail for a reason that has nothing to do with the gate.
    setupAdminPin();
    for (const f of FLAGS) saved[f] = process.env[f];
    // The gated routes behind a feature flag 404 before the gate when their
    // feature is off, which would pass "not 200" for the wrong reason.
    process.env.NEXT_PUBLIC_FLAG_VALUE_HUB_SLICE = 'true';
    process.env.NEXT_PUBLIC_FLAG_STRINGING = 'true';
    seedMember('Lin', { id: 'member-lin' });
  });

  afterEach(() => {
    for (const f of FLAGS) {
      if (saved[f] === undefined) delete process.env[f];
      else process.env[f] = saved[f];
    }
  });

  type Handler = (req: NextRequest) => Promise<Response>;
  const CASES: Array<[string, Handler, string]> = [
    ['players', playersGET as Handler, 'http://localhost/api/players'],
    ['session', sessionGET as Handler, 'http://localhost/api/session'],
    ['members', membersGET as Handler, 'http://localhost/api/members'],
    ['members/me', membersMeGET as Handler, 'http://localhost/api/members/me?name=Lin'],
    ['announcements', announcementsGET as Handler, 'http://localhost/api/announcements'],
    ['games', gamesGET as Handler, 'http://localhost/api/games'],
    ['equipment/gear', gearGET as Handler, 'http://localhost/api/equipment/gear?name=Lin'],
    ['stringing/shop', shopGET as Handler, 'http://localhost/api/stringing/shop'],
    ['stringing/strings', stringsGET as Handler, 'http://localhost/api/stringing/strings'],
    ['stringing/pricing', pricingGET as Handler, 'http://localhost/api/stringing/pricing'],
    ['stats/club/gear', clubGearGET as Handler, 'http://localhost/api/stats/club/gear'],
    ['recommend', recommendGET as Handler, 'http://localhost/api/recommend?name=Lin'],
  ];

  it('covers every GATED route', () => {
    const gated = Object.entries(ROUTES).filter(([, e]) => e.kind === 'gated').map(([k]) => k).sort();
    expect(CASES.map(([k]) => k).sort()).toEqual(gated);
  });

  for (const [key, handler, url] of CASES) {
    describe(key, () => {
      it('flag on, no cookie: 401', async () => {
        process.env.NEXT_PUBLIC_FLAG_MEMBERS_ONLY = 'true';
        const res = await handler(makeRequest('GET', url));
        expect(res.status).toBe(401);
      });

      it('flag on, a lapsed member cookie: 401', async () => {
        process.env.NEXT_PUBLIC_FLAG_MEMBERS_ONLY = 'true';
        const cookie = `member_session=${memberCookieValue('Lin', 'member-lin', -60)}`;
        const res = await handler(makeRequest('GET', url, undefined, { Cookie: cookie }));
        expect(res.status).toBe(401);
      });

      it('flag on, a REMOVED member with a live cookie: 401', async () => {
        // The case the cheap signature check would have let through for a month.
        process.env.NEXT_PUBLIC_FLAG_MEMBERS_ONLY = 'true';
        resetMockStore();
        seedMember('Lin', { id: 'member-lin', active: false });
        const cookie = `member_session=${memberCookieValue('Lin', 'member-lin')}`;
        const res = await handler(makeRequest('GET', url, undefined, { Cookie: cookie }));
        expect(res.status).toBe(401);
      });

      it('flag on, an active member cookie: not refused by the gate', async () => {
        process.env.NEXT_PUBLIC_FLAG_MEMBERS_ONLY = 'true';
        const cookie = `member_session=${memberCookieValue('Lin', 'member-lin')}`;
        const res = await handler(makeRequest('GET', url, undefined, { Cookie: cookie }));
        expect(res.status).not.toBe(401);
      });

      it('flag on, an admin-only cookie: not refused by the gate', async () => {
        // `POST /api/admin` mints only an admin_session.
        process.env.NEXT_PUBLIC_FLAG_MEMBERS_ONLY = 'true';
        await seedTestAdminMember();
        const cookie = `admin_session=${adminCookieValue()}`;
        const res = await handler(makeRequest('GET', url, undefined, { Cookie: cookie }));
        expect(res.status).not.toBe(401);
      });

      it('flag off, no cookie: unchanged — not 401', async () => {
        delete process.env.NEXT_PUBLIC_FLAG_MEMBERS_ONLY;
        const res = await handler(makeRequest('GET', url));
        expect(res.status).not.toBe(401);
      });
    });
  }
});

describe('members/me answers a member only about themselves', () => {
  const saved = process.env.NEXT_PUBLIC_FLAG_MEMBERS_ONLY;
  beforeEach(() => {
    resetMockStore();
    setupAdminPin();
    seedMember('Lin', { id: 'member-lin', pinHash: 'x' });
    seedMember('Viktor', { id: 'member-viktor', pinHash: 'y' });
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.NEXT_PUBLIC_FLAG_MEMBERS_ONLY;
    else process.env.NEXT_PUBLIC_FLAG_MEMBERS_ONLY = saved;
  });

  const asLin = { Cookie: `member_session=${memberCookieValue('Lin', 'member-lin')}` };

  it('flag on: refuses another name (403) rather than confirming the account exists', async () => {
    process.env.NEXT_PUBLIC_FLAG_MEMBERS_ONLY = 'true';
    const res = await membersMeGET(makeRequest('GET', 'http://localhost/api/members/me?name=Viktor', undefined, asLin));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body).not.toHaveProperty('hasPin');
    expect(body).not.toHaveProperty('createdAt');
  });

  it('flag on: answers for the caller, case-insensitively', async () => {
    process.env.NEXT_PUBLIC_FLAG_MEMBERS_ONLY = 'true';
    const res = await membersMeGET(makeRequest('GET', 'http://localhost/api/members/me?name=lin', undefined, asLin));
    expect(res.status).toBe(200);
    expect((await res.json()).hasPin).toBe(true);
  });

  it('flag on: an admin may still ask about anyone', async () => {
    process.env.NEXT_PUBLIC_FLAG_MEMBERS_ONLY = 'true';
    await seedTestAdminMember();
    const res = await membersMeGET(
      makeRequest('GET', 'http://localhost/api/members/me?name=Viktor', undefined, { Cookie: `admin_session=${adminCookieValue()}` }),
    );
    expect(res.status).toBe(200);
  });

  it('flag off: another name is answered, exactly as before', async () => {
    delete process.env.NEXT_PUBLIC_FLAG_MEMBERS_ONLY;
    const res = await membersMeGET(makeRequest('GET', 'http://localhost/api/members/me?name=Viktor', undefined, asLin));
    expect(res.status).toBe(200);
    expect((await res.json()).hasPin).toBe(true);
  });
});
