import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { getActiveSessionId, ensureContainer } from '@/lib/cosmos';
import { groupScope } from '@/lib/groupScope';
import { resolveGroupId, noActiveSession } from '@/lib/groupContext';
import { isAdminAuthed, isAdminAuthedWithMember, unauthorized } from '@/lib/auth';
import type { PlayerSkills } from '@/lib/types';

export const dynamic = 'force-dynamic';

const SCORE_MIN = 0;
const SCORE_MAX = 6;

// Lazy container bootstrap — real Cosmos doesn't auto-create containers,
// and 'skills' was added after the initial portal setup. Cache the
// promise so the createIfNotExists fires at most once per server instance.
let skillsReady: Promise<void> | null = null;
function ensureSkillsContainer(): Promise<void> {
  if (!skillsReady) {
    skillsReady = ensureContainer('skills', '/sessionId').catch((err) => {
      // If it fails, reset so the next request retries
      skillsReady = null;
      throw err;
    });
  }
  return skillsReady;
}

function validateScores(raw: unknown): Record<string, number> | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const out: Record<string, number> = {};
  for (const [dim, val] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof dim !== 'string' || !dim) return null;
    if (typeof val !== 'number' || !Number.isFinite(val)) return null;
    if (!Number.isInteger(val)) return null;
    if (val < SCORE_MIN || val > SCORE_MAX) return null;
    out[dim] = val;
  }
  return out;
}

async function resolveSessionId(req: NextRequest): Promise<string | null> {
  const url = new URL(req.url);
  const override = url.searchParams.get('sessionId');
  if (override && isAdminAuthed(req)) return override;
  return getActiveSessionId(resolveGroupId(req));
}

export async function GET(req: NextRequest) {
  if (!isAdminAuthed(req)) return unauthorized();

  try {
    await ensureSkillsContainer();
    const sessionId = await resolveSessionId(req);
    if (!sessionId) return noActiveSession();
    const resources = await groupScope(resolveGroupId(req)).query('skills', {
      where: 'c.sessionId = @sessionId',
      params: [{ name: '@sessionId', value: sessionId }],
    });
    return NextResponse.json({ skills: resources });
  } catch (error) {
    // Surface the failure (500) instead of a lying 200 + empty skills list —
    // an admin must not see "no skills recorded" when the read actually failed
    // (CLAUDE.md: "Lying empty state is forbidden").
    console.error('GET skills error:', error);
    return NextResponse.json({ error: 'Failed to load skills' }, { status: 503 });
  }
}

export async function POST(req: NextRequest) {
  if (!(await isAdminAuthedWithMember(req)).authed) return unauthorized();

  try {
    await ensureSkillsContainer();
    const body = await req.json();
    const name = typeof body.name === 'string' ? body.name.trim().slice(0, 50) : '';
    if (!name) {
      return NextResponse.json({ error: 'Player name required' }, { status: 400 });
    }
    const scores = validateScores(body.scores);
    if (!scores) {
      return NextResponse.json({ error: 'Scores must be integers between 0 and 6' }, { status: 400 });
    }

    const scope = groupScope(resolveGroupId(req));
    const sessionId = await getActiveSessionId(scope.groupId);
    if (!sessionId) return noActiveSession();

    // Upsert semantics: find existing record for (sessionId, name) case-insensitive.
    const existing = await scope.query<PlayerSkills>('skills', {
      where: 'c.sessionId = @sessionId AND LOWER(c.name) = @name',
      params: [
        { name: '@sessionId', value: sessionId },
        { name: '@name', value: name.toLowerCase() },
      ],
    });

    if (existing.length > 0) {
      const prior = existing[0];
      const updated: PlayerSkills = {
        ...prior,
        name, // take the new casing
        scores,
        updatedAt: new Date().toISOString(),
      };
      const resource = await scope.upsert('skills', updated);
      return NextResponse.json(resource);
    }

    const record: PlayerSkills = {
      id: randomBytes(16).toString('hex'),
      sessionId,
      name,
      scores,
      updatedAt: new Date().toISOString(),
    };
    const resource = await scope.create('skills', record);
    return NextResponse.json(resource, { status: 201 });
  } catch (error) {
    console.error('POST skills error:', error);
    return NextResponse.json({ error: 'Failed to save skills' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  if (!(await isAdminAuthedWithMember(req)).authed) return unauthorized();

  try {
    await ensureSkillsContainer();
    const body = await req.json();
    const id = typeof body.id === 'string' ? body.id : '';
    if (!id) return NextResponse.json({ error: 'ID required' }, { status: 400 });

    const scores = validateScores(body.scores);
    if (!scores) {
      return NextResponse.json({ error: 'Scores must be integers between 0 and 6' }, { status: 400 });
    }

    const scope = groupScope(resolveGroupId(req));
    const sessionId = await getActiveSessionId(scope.groupId);
    if (!sessionId) return noActiveSession();
    const existing = await scope.read<PlayerSkills>('skills', id, sessionId);
    if (!existing) {
      return NextResponse.json({ error: 'Record not found' }, { status: 404 });
    }

    const updated: PlayerSkills = {
      ...existing,
      scores: { ...existing.scores, ...scores },
      updatedAt: new Date().toISOString(),
    };
    const resource = await scope.upsert('skills', updated);
    return NextResponse.json(resource);
  } catch (error) {
    console.error('PATCH skills error:', error);
    return NextResponse.json({ error: 'Failed to update skills' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  if (!(await isAdminAuthedWithMember(req)).authed) return unauthorized();

  try {
    await ensureSkillsContainer();
    const body = await req.json();
    const id = typeof body.id === 'string' ? body.id : '';
    if (!id) return NextResponse.json({ error: 'ID required' }, { status: 400 });

    const scope = groupScope(resolveGroupId(req));
    const sessionId = await getActiveSessionId(scope.groupId);
    if (!sessionId) return noActiveSession();
    await scope.remove('skills', id, sessionId);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('DELETE skills error:', error);
    return NextResponse.json({ error: 'Failed to delete' }, { status: 500 });
  }
}
