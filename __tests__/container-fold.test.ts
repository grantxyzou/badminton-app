import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { foldStatus, runFold } from '@/lib/containerFold';
import { readAliases, readAlias, createAlias, updateAlias, removeAlias, ALIAS_KIND } from '@/lib/aliases';
import { groupScope } from '@/lib/groupScope';
import { beginHandoff, createHandoffId, handoffRef } from '@/lib/authHandoff';
import { mintMigration, claimMigration } from '@/lib/authMigration';
import { GET as foldGET, POST as foldPOST } from '@/app/api/admin/migrate-containers/route';
import { GET as releasesGET, DELETE as releasesDELETE } from '@/app/api/releases/route';
import { resetMockStore, getStore, seedDoc, makeRequest, adminCookieValue, setupAdminPin, seedTestAdminMember } from './helpers';

/**
 * THE CONTAINER FOLD (docs/plans/container-fold.md): `aliases` into
 * `clubSettings`, `feedback` into `releases`, `authmigration` into
 * `authhandoff`. What has to hold:
 *
 *   - the copy is idempotent and bounded, and the status reads zero only
 *     when every old row has a copy;
 *   - during the window a reader sees both homes as one list, and an edit
 *     of a legacy row MOVES it;
 *   - a kind is checked on every point read, so the alias route cannot touch
 *     a gift card and a handoff ref cannot redeem a migration doc;
 *   - the route is admin + key, like `migrate-groups`.
 */

const KEY = 'fold-test-key-long-enough-to-pass';
const before = process.env.MIGRATION_KEY;
const rows = (c: string) => (getStore()[c] ?? []) as Array<Record<string, unknown>>;
const url = 'http://localhost:3000/api/admin/migrate-containers';
const asAdmin = (headers: Record<string, string> = {}) => ({ Cookie: `admin_session=${adminCookieValue()}`, ...headers });
// The POST is rate-limited per IP and the limiter outlives a `beforeEach`.
let ipSeq = 0;
const adminReq = (method: string, u: string, body?: Record<string, unknown>, headers: Record<string, string> = {}) =>
  makeRequest(method, u, body, { ...asAdmin(headers), 'X-Client-IP': `10.0.2.${++ipSeq}` });

beforeEach(() => {
  resetMockStore();
  process.env.MIGRATION_KEY = KEY;
});
afterAll(() => {
  if (before === undefined) delete process.env.MIGRATION_KEY;
  else process.env.MIGRATION_KEY = before;
});

describe('foldStatus / runFold', () => {
  it('copies every legacy row under its own id, stamps the kind, and reads zero after', async () => {
    seedDoc('aliases', { id: 'a1', groupId: 'bpm', appName: 'Lin', etransferName: 'MEI LING CHAN', _etag: 'e1', _rid: 'x' });
    seedDoc('aliases', { id: 'a2', appName: 'Viktor', etransferName: 'V AXELSEN' }); // pre-backfill: no group
    seedDoc('feedback', { id: 'r1', message: 'broken', createdAt: '2026-10-01T00:00:00Z', ip: '203.0.113.9' });
    seedDoc('releases', { id: 'rel-1', version: '1.0', publishedAt: '2026-09-01T00:00:00Z' });
    seedDoc('releases', { id: 'rel-2', kind: 'release', version: '1.1', publishedAt: '2026-09-02T00:00:00Z' });

    const first = await foldStatus();
    expect(first.aliases).toEqual({ legacy: 2, copied: 0, remaining: 2, truncated: false });
    expect(first.feedback).toEqual({ legacy: 1, copied: 0, remaining: 1, truncated: false });
    expect(first.releases.unstamped).toBe(1);

    const dry = await runFold({ dryRun: true });
    expect(dry).toEqual({
      dryRun: true,
      aliases: { copied: 0, existing: 0, remaining: 2 },
      feedback: { copied: 0, existing: 0, remaining: 1 },
      releases: { stamped: 1, conflicts: 0 },
    });
    expect(rows('clubSettings')).toHaveLength(0);

    const run = await runFold({ dryRun: false });
    expect(run.aliases).toEqual({ copied: 2, existing: 0, remaining: 0 });
    expect(run.feedback).toEqual({ copied: 1, existing: 0, remaining: 0 });
    expect(run.releases).toEqual({ stamped: 1, conflicts: 0 });

    const a1 = rows('clubSettings').find((r) => r.id === 'a1')!;
    expect(a1.kind).toBe(ALIAS_KIND);
    expect(a1.groupId).toBe('bpm');
    expect(a1._rid).toBeUndefined();
    expect(rows('clubSettings').find((r) => r.id === 'a2')!.groupId).toBe('bpm');
    expect(rows('releases').find((r) => r.id === 'r1')!.kind).toBe('feedback');
    expect(rows('releases').find((r) => r.id === 'rel-1')!.kind).toBe('release');
    // The old rows are untouched: the portal delete is the operator's, after PR 2.
    expect(rows('aliases')).toHaveLength(2);

    const after = await foldStatus();
    expect(after.aliases.remaining).toBe(0);
    expect(after.feedback.remaining).toBe(0);
    expect(after.releases.unstamped).toBe(0);

    const again = await runFold({ dryRun: false });
    expect(again.aliases).toEqual({ copied: 0, existing: 2, remaining: 0 });
    expect(again.feedback).toEqual({ copied: 0, existing: 1, remaining: 0 });
  });

  it('is bounded by the scan cap and says so', async () => {
    for (let i = 0; i < 5; i++) seedDoc('aliases', { id: `a${i}`, groupId: 'bpm', appName: `P${i}`, etransferName: 'X' });
    const status = await foldStatus({ scanCap: 3 });
    expect(status.aliases).toEqual({ legacy: 3, copied: 0, remaining: 3, truncated: true });
    const run = await runFold({ dryRun: false, scanCap: 3 });
    expect(run.aliases.copied).toBe(3);
    expect((await foldStatus()).aliases.remaining).toBe(2);
  });
});

describe('lib/aliases during the fold window', () => {
  const scope = groupScope('bpm');

  it('reads both homes as one list, deduplicated by id, and never a non-alias', async () => {
    seedDoc('clubSettings', { id: 'n1', kind: 'alias', groupId: 'bpm', appName: 'Zed', etransferName: 'Z' });
    seedDoc('clubSettings', { id: 'both', kind: 'alias', groupId: 'bpm', appName: 'Both', etransferName: 'new copy' });
    seedDoc('clubSettings', { id: 'gift:1', kind: 'giftCard', groupId: 'bpm', appName: 'Not', etransferName: 'an alias' });
    seedDoc('aliases', { id: 'both', groupId: 'bpm', appName: 'Both', etransferName: 'old copy' });
    seedDoc('aliases', { id: 'l1', groupId: 'bpm', appName: 'Amy', etransferName: 'A' });
    const all = await readAliases(scope);
    expect(all.map((a) => a.id)).toEqual(['l1', 'both', 'n1']);
    expect(all.find((a) => a.id === 'both')!.etransferName).toBe('new copy');
    expect(all.every((a) => a.kind === ALIAS_KIND)).toBe(true);
  });

  it('creates in the new home only', async () => {
    const made = await createAlias(scope, { appName: 'Lin', etransferName: 'MEI LING CHAN', memberId: 'm-lin' });
    expect(made.id).toMatch(/^alias-[0-9a-f]{24}$/);
    expect(rows('clubSettings').map((r) => r.id)).toEqual([made.id]);
    expect(rows('aliases')).toHaveLength(0);
  });

  it('an edit of a legacy row moves it; a delete finds either home; a gift card is not an alias', async () => {
    seedDoc('aliases', { id: 'l1', groupId: 'bpm', appName: 'Amy', etransferName: 'A' });
    seedDoc('clubSettings', { id: 'gift:1', kind: 'giftCard', groupId: 'bpm' });
    const found = await readAlias(scope, 'l1');
    expect(found?.etransferName).toBe('A');
    const moved = await updateAlias(scope, { ...found!, etransferName: 'AMY LEE' });
    expect(moved?.etransferName).toBe('AMY LEE');
    expect(rows('aliases')).toHaveLength(0);
    expect(rows('clubSettings').find((r) => r.id === 'l1')?.kind).toBe(ALIAS_KIND);

    expect(await readAlias(scope, 'gift:1')).toBeUndefined();
    expect(await updateAlias(scope, { id: 'gift:1', appName: 'x', etransferName: 'y' })).toBeUndefined();
    expect(await removeAlias(scope, 'gift:1')).toBe(false);
    expect(rows('clubSettings').find((r) => r.id === 'gift:1')).toBeDefined();

    expect(await removeAlias(scope, 'l1')).toBe(true);
    seedDoc('aliases', { id: 'l2', groupId: 'bpm', appName: 'Bo', etransferName: 'B' });
    expect(await removeAlias(scope, 'l2')).toBe(true);
    expect(rows('aliases')).toHaveLength(0);
  });
});

describe('one container for both auth stashes', () => {
  it('a migration doc lives in authhandoff, and neither kind can read the other', async () => {
    const minted = await mintMigration({ id: 'm-lin', name: 'Lin' }, undefined);
    const docs = rows('authhandoff');
    expect(docs.map((d) => d.kind).sort()).toEqual(['link', 'short']);
    expect(getStore()['authmigration']).toBeUndefined();

    // A handoff cannot begin at (and so overwrite) a migration doc's ref.
    const linkDoc = docs.find((d) => d.kind === 'link')!;
    expect(await beginHandoff(String(linkDoc.id), { state: 's', codeVerifier: 'v' })).toBe(false);
    expect(rows('authhandoff').find((d) => d.id === linkDoc.id)!.kind).toBe('link');

    // And a handoff doc, whatever its ref, is never a migration.
    const ref = handoffRef(createHandoffId());
    expect(await beginHandoff(ref, { state: 's', codeVerifier: 'v' })).toBe(true);
    expect(rows('authhandoff').find((d) => d.id === ref)!.kind).toBe('handoff');
    const asLink = rows('authhandoff').find((d) => d.id === ref)!;
    // Forge the id shape a link claim would compute, pointing at the handoff doc.
    getStore()['authhandoff'] = rows('authhandoff').map((d) => (d.id === ref ? { ...asLink, kind: 'handoff', sibling: 'x', memberId: 'm-x', name: 'X' } : d));
    expect(await claimMigration({ link: minted.linkCode })).toEqual(expect.objectContaining({ status: 'ready', memberId: 'm-lin' }));
    expect(rows('authhandoff').find((d) => d.id === ref)).toBeDefined(); // the handoff survived the claim's deletes
  });
});

describe('the releases route beside the reports', () => {
  it('lists releases only, and will not delete a report', async () => {
    seedDoc('releases', { id: 'rel-1', version: '1.0', publishedAt: '2026-09-01T00:00:00Z' });
    seedDoc('releases', { id: 'rel-2', kind: 'release', version: '1.1', publishedAt: '2026-09-02T00:00:00Z' });
    seedDoc('releases', { id: 'r1', kind: 'feedback', message: 'secret report', createdAt: '2026-09-03T00:00:00Z', publishedAt: '2026-09-03T00:00:00Z' });
    const body = await (await releasesGET(makeRequest('GET', 'http://localhost:3000/api/releases'))).json();
    expect(body.map((r: { id: string }) => r.id)).toEqual(['rel-2', 'rel-1']);
    expect(JSON.stringify(body)).not.toContain('secret report');

    setupAdminPin();
    await seedTestAdminMember();
    const res = await releasesDELETE(adminReq('DELETE', 'http://localhost:3000/api/releases', { id: 'r1' }));
    expect(res.status).toBe(404);
    expect(rows('releases').find((r) => r.id === 'r1')).toBeDefined();
  });
});

describe('GET/POST /api/admin/migrate-containers', () => {
  beforeEach(async () => {
    setupAdminPin();
    await seedTestAdminMember();
  });

  it('GET is admin-only; POST needs the key and defaults to a dry run', async () => {
    expect((await foldGET(makeRequest('GET', url))).status).toBe(401);
    expect((await foldGET(adminReq('GET', url))).status).toBe(200);

    seedDoc('aliases', { id: 'a1', groupId: 'bpm', appName: 'Lin', etransferName: 'X' });
    expect((await foldPOST(makeRequest('POST', url, { dryRun: false }, { 'x-migration-key': KEY }))).status).toBe(401);
    expect((await foldPOST(adminReq('POST', url, { dryRun: false }, { 'x-migration-key': 'wrong-key-wrong-key-wrong' }))).status).toBe(401);
    delete process.env.MIGRATION_KEY;
    expect((await foldPOST(adminReq('POST', url, { dryRun: false }, { 'x-migration-key': KEY }))).status).toBe(503);
    process.env.MIGRATION_KEY = KEY;

    const dry = await (await foldPOST(adminReq('POST', url, undefined, { 'x-migration-key': KEY }))).json();
    expect(dry.dryRun).toBe(true);
    expect(rows('clubSettings')).toHaveLength(0);

    const run = await (await foldPOST(adminReq('POST', url, { dryRun: false }, { 'x-migration-key': KEY }))).json();
    expect(run.aliases.copied).toBe(1);
    expect(rows('clubSettings')).toHaveLength(1);
    const status = await (await foldGET(adminReq('GET', url))).json();
    expect(status.aliases.remaining).toBe(0);
  });
});
