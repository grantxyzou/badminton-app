// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest';
import {
  resetMockStore,
  setupAdminPin,
  seedAdminMember,
  seedSession,
  seedPlayer,
  seedDoc,
  makeRequest,
  makeAdminRequest,
} from './helpers';
import { GET as keyGET, POST as keyPOST } from '@/app/api/admin/reports/key/route';
import { GET as metricsGET } from '@/app/api/reports/metrics/route';
import { GET as feedbackGET } from '@/app/api/reports/feedback/route';
import { GET as adminMetricsGET } from '@/app/api/admin/metrics/route';
import { mintReportsKey, pathOnly } from '@/lib/reportsAccess';
import { mintPaymentsKey } from '@/lib/paymentsInbox';

/**
 * The weekly-report key and the two reads it opens
 * (docs/plans/usage-metrics.md). A scheduled helper holds this key in its
 * environment, so these tests are about what the key can NOT do: read with no
 * key or a rotated one, stand in for the payments key, or read another club's
 * feedback — and that what it reads carries no person.
 */

const BASE = 'http://localhost/bpm/api';
const DAY = 86_400_000;
const ago = (d: number) => new Date(Date.now() - d * DAY).toISOString();
const withKey = (url: string, key: string | null) =>
  makeRequest('GET', url, undefined, key ? { 'x-reports-key': key } : {});

beforeEach(() => {
  resetMockStore();
  setupAdminPin();
  seedAdminMember();
});

describe('the reports key', () => {
  it('is minted by an admin only, shown once, and its status never carries it', async () => {
    expect((await keyPOST(makeRequest('POST', `${BASE}/admin/reports/key`))).status).toBe(401);
    const res = await keyPOST(makeAdminRequest('POST', `${BASE}/admin/reports/key`));
    expect(res.status).toBe(200);
    const { key } = await res.json();
    expect(key).toMatch(/^bpm\.[0-9a-f]{48}$/);

    const status = await (await keyGET(makeAdminRequest('GET', `${BASE}/admin/reports/key`))).json();
    expect(status.configured).toBe(true);
    expect(JSON.stringify(status)).not.toContain(key.split('.')[1]);
    expect((await keyGET(makeRequest('GET', `${BASE}/admin/reports/key`))).status).toBe(401);
  });
});

describe('GET /api/reports/metrics', () => {
  it('refuses a missing, wrong, payments or rotated key with one 401', async () => {
    const old = await mintReportsKey('bpm');
    const fresh = await mintReportsKey('bpm');
    const payments = await mintPaymentsKey('bpm');
    for (const k of [null, 'bpm.nope', 'garbage', payments, old]) {
      expect((await metricsGET(withKey(`${BASE}/reports/metrics`, k))).status).toBe(401);
    }
    expect((await metricsGET(withKey(`${BASE}/reports/metrics`, fresh))).status).toBe(200);
  });

  it('answers exactly what the admin Metrics page answers', async () => {
    seedSession('session-2026-10-01', { datetime: ago(6), maxPlayers: 4 });
    seedPlayer('session-2026-10-01', 'Lin');
    seedPlayer('session-2026-10-01', 'Viktor');
    const key = await mintReportsKey('bpm');
    const report = await (await metricsGET(withKey(`${BASE}/reports/metrics`, key))).json();
    const page = await (await adminMetricsGET(makeAdminRequest('GET', `${BASE}/admin/metrics`))).json();
    const { generatedAt: _a, ...r } = report;
    const { generatedAt: _b, ...p } = page;
    expect(r).toEqual(p);
    expect(JSON.stringify(report)).not.toMatch(/\bLin\b|Viktor/);
  });
});

describe('GET /api/reports/feedback', () => {
  it('returns recent reports with the person taken out, newest first', async () => {
    seedDoc('feedback', { id: 'r1', message: 'Sign-up button did nothing', name: 'Lin', ip: '203.0.113.9', tab: 'home', url: 'https://bpm.grantzou.com/bpm?join=abcdef0123456789#code=999', createdAt: ago(2) });
    seedDoc('feedback', { id: 'r2', message: 'Stats would not load', tab: 'skills', url: '/bpm', createdAt: ago(1) });
    seedDoc('feedback', { id: 'r3', message: 'old one', createdAt: ago(60) });
    const key = await mintReportsKey('bpm');
    const res = await feedbackGET(withKey(`${BASE}/reports/feedback`, key));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.rows.map((r: { message: string }) => r.message)).toEqual(['Stats would not load', 'Sign-up button did nothing']);
    expect(body.rows[1]).toEqual({ createdAt: expect.any(String), message: 'Sign-up button did nothing', tab: 'home', path: '/bpm' });
    const text = JSON.stringify(body);
    expect(text).not.toContain('203.0.113.9');
    expect(text).not.toContain('Lin');
    expect(text).not.toContain('abcdef0123456789');
  });

  it('is the operator club’s alone', async () => {
    const key = await mintReportsKey('otherclub');
    expect((await feedbackGET(withKey(`${BASE}/reports/feedback`, key))).status).toBe(403);
  });

  it('widens to ?days= up to 90', async () => {
    seedDoc('feedback', { id: 'r3', message: 'old one', createdAt: ago(60) });
    const key = await mintReportsKey('bpm');
    const body = await (await feedbackGET(withKey(`${BASE}/reports/feedback?days=500`, key))).json();
    expect(body.days).toBe(90);
    expect(body.rows).toHaveLength(1);
  });
});

describe('pathOnly', () => {
  it('keeps the path and nothing after it', () => {
    expect(pathOnly('https://bpm.grantzou.com/bpm/migrate?c=secret#x')).toBe('/bpm/migrate');
    expect(pathOnly('/bpm?join=1')).toBe('/bpm');
    expect(pathOnly(undefined)).toBeNull();
  });
});
