import { describe, it, expect, beforeEach } from 'vitest';
import { readAliases, readAlias, createAlias, updateAlias, removeAlias, ALIAS_KIND } from '@/lib/aliases';
import { groupScope } from '@/lib/groupScope';
import { beginHandoff, createHandoffId, handoffRef } from '@/lib/authHandoff';
import { mintMigration, claimMigration } from '@/lib/authMigration';
import { GET as releasesGET, DELETE as releasesDELETE } from '@/app/api/releases/route';
import { resetMockStore, getStore, seedDoc, makeRequest, adminCookieValue, setupAdminPin, seedTestAdminMember } from './helpers';

/**
 * THE CONTAINER FOLD (docs/plans/container-fold.md): `aliases` into
 * `clubSettings`, `feedback` into `releases`, `authmigration` into
 * `authhandoff`. The copy ran on 2026-10-15; what has to keep holding is
 * that a shared cabinet's readers check `kind` on every point read:
 *
 *   - the alias route cannot read, edit or delete a gift card by id;
 *   - a handoff ref cannot redeem a migration doc, nor overwrite one;
 *   - the releases route lists releases only and will not delete a report.
 */

const rows = (c: string) => (getStore()[c] ?? []) as Array<Record<string, unknown>>;
const asAdmin = () => ({ Cookie: `admin_session=${adminCookieValue()}` });

beforeEach(() => resetMockStore());

describe('lib/aliases', () => {
  const scope = groupScope('bpm');

  it('reads only alias rows, by app name, and never a gift card', async () => {
    seedDoc('clubSettings', { id: 'n1', kind: 'alias', groupId: 'bpm', appName: 'Zed', etransferName: 'Z' });
    seedDoc('clubSettings', { id: 'n2', kind: 'alias', groupId: 'bpm', appName: 'Amy', etransferName: 'A' });
    seedDoc('clubSettings', { id: 'gift:1', kind: 'giftCard', groupId: 'bpm', appName: 'Not', etransferName: 'an alias' });
    const all = await readAliases(scope);
    expect(all.map((a) => a.id)).toEqual(['n2', 'n1']);
    expect(all.every((a) => a.kind === ALIAS_KIND)).toBe(true);
  });

  it('creates with the kind and a legible id', async () => {
    const made = await createAlias(scope, { appName: 'Lin', etransferName: 'MEI LING CHAN', memberId: 'm-lin' });
    expect(made.id).toMatch(/^alias-[0-9a-f]{24}$/);
    expect(made.kind).toBe(ALIAS_KIND);
    expect(rows('clubSettings').map((r) => r.id)).toEqual([made.id]);
  });

  it('a gift card is not an alias to read, edit or delete; an alias is', async () => {
    seedDoc('clubSettings', { id: 'a1', kind: 'alias', groupId: 'bpm', appName: 'Amy', etransferName: 'A' });
    seedDoc('clubSettings', { id: 'gift:1', kind: 'giftCard', groupId: 'bpm' });

    expect(await readAlias(scope, 'gift:1')).toBeUndefined();
    expect(await updateAlias(scope, { id: 'gift:1', appName: 'x', etransferName: 'y' })).toBeUndefined();
    expect(await removeAlias(scope, 'gift:1')).toBe(false);
    expect(rows('clubSettings').find((r) => r.id === 'gift:1')).toBeDefined();

    const found = await readAlias(scope, 'a1');
    expect(found?.etransferName).toBe('A');
    const updated = await updateAlias(scope, { ...found!, etransferName: 'AMY LEE' });
    expect(updated?.etransferName).toBe('AMY LEE');
    expect(rows('clubSettings').find((r) => r.id === 'a1')?.kind).toBe(ALIAS_KIND);
    expect(await removeAlias(scope, 'a1')).toBe(true);
    expect(rows('clubSettings').map((r) => r.id)).toEqual(['gift:1']);
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
    const res = await releasesDELETE(makeRequest('DELETE', 'http://localhost:3000/api/releases', { id: 'r1' }, asAdmin()));
    expect(res.status).toBe(404);
    expect(rows('releases').find((r) => r.id === 'r1')).toBeDefined();
  });
});
