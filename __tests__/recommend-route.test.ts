// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest';
import { GET } from '@/app/api/recommend/route';
import { NextRequest } from 'next/server';
import { getContainer, ensureContainer } from '@/lib/cosmos';
import { _resetCalibrationCache } from '@/lib/levelStore';
import { resetMockStore } from './helpers';

// Unique IP per request — recommend is rate-limited 10/min; convention per helpers.ts.
function get(url: string): NextRequest {
  return new NextRequest(new URL(url, 'http://localhost/bpm'), {
    headers: { 'x-client-ip': `rec-${Math.random()}` },
  });
}

async function seedAssessment(memberId: string, name: string, overall: number) {
  await ensureContainer('assessments', '/memberId');
  await getContainer('assessments').items.upsert({
    id: `a-${memberId}`,
    memberId,
    name,
    takenAt: '2026-06-01T00:00:00Z',
    overall,
    ratings: [],
  });
}

describe('GET /api/recommend', () => {
  beforeEach(async () => {
    resetMockStore();
    _resetCalibrationCache();
    process.env.NEXT_PUBLIC_FLAG_VALUE_HUB_SLICE = 'true';
    delete process.env.NEXT_PUBLIC_FLAG_SKILL_CALIBRATION;
    delete process.env.NEXT_PUBLIC_FLAG_SKILL_SMOOTHING;
    const catalog = getContainer('equipmentCatalog');
    await catalog.items.upsert({ id: 'wide', category: 'racket', brand: 'Y', model: 'All-Round', skillRange: [1, 6], msrp: 120 });
    await catalog.items.upsert({ id: 'beg', category: 'racket', brand: 'Y', model: 'Starter', skillRange: [1, 2], msrp: 80 });
    await catalog.items.upsert({ id: 'adv', category: 'racket', brand: 'Y', model: 'Pro', skillRange: [5, 6], msrp: 220 });
  });

  it('returns an all-rounder for a member with no level signal at all', async () => {
    await getContainer('members').items.upsert({ id: 'm-anon', name: 'Anon', active: true });
    const res = await GET(get('/api/recommend?name=Anon'));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.item.id).toBe('wide');
    expect(typeof body.reason).toBe('string');
  });

  it('still honors a legacy Member.stage when there are no check-ins (back-compat)', async () => {
    await getContainer('members').items.upsert({ id: 'm-beg', name: 'Newbie', active: true, stage: 2 });
    const res = await GET(get('/api/recommend?name=Newbie'));
    const body = await res.json();
    expect(body.item.id).toBe('beg');
  });

  it('derives stage from self check-ins even when Member.stage is unset', async () => {
    // No stage on the member — only an assessment. Proves the rec no longer
    // depends on the legacy field: a 4.5 self-rating → stage ~5 → the Pro.
    await getContainer('members').items.upsert({ id: 'm-rated', name: 'Rated', active: true });
    await seedAssessment('m-rated', 'Rated', 4.5);
    const res = await GET(get('/api/recommend?name=Rated'));
    const body = await res.json();
    expect(body.item.id).toBe('adv');
  });

  it('lets game calibration lift the recommended stage when the flag is on', async () => {
    await getContainer('members').items.upsert({ id: 'm-climb', name: 'Climber', active: true });
    await seedAssessment('m-climb', 'Climber', 2.0); // self-only → stage 2 → the Starter
    await ensureContainer('gameResults', '/sessionId');
    const games = getContainer('gameResults');
    for (let i = 0; i < 12; i++) {
      await games.items.upsert({
        id: `g-${i}`, sessionId: 's', teamA: ['Climber'], teamB: ['Punching Bag'],
        scoreA: 21, scoreB: 5, loggedBy: 'Climber', loggedAt: `2026-06-${String(10 + i).padStart(2, '0')}T00:00:00Z`,
      });
    }

    // Flag OFF → self-only stage 2 → Starter.
    _resetCalibrationCache();
    const off = await (await GET(get('/api/recommend?name=Climber'))).json();
    expect(off.item.id).toBe('beg');

    // Flag ON → decisive wins lift the observed level → stage 3 → no longer the Starter.
    process.env.NEXT_PUBLIC_FLAG_SKILL_CALIBRATION = 'true';
    _resetCalibrationCache();
    const on = await (await GET(get('/api/recommend?name=Climber'))).json();
    expect(on.item.id).not.toBe('beg');
  });

  it('404s when the flag is off', async () => {
    process.env.NEXT_PUBLIC_FLAG_VALUE_HUB_SLICE = 'false';
    const res = await GET(get('/api/recommend?name=Anon'));
    expect(res.status).toBe(404);
  });
});
