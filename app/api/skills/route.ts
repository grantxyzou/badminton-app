import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { getContainer, getActiveSessionId, ensureContainer } from '@/lib/cosmos';
import { isAdminAuthed, unauthorized } from '@/lib/auth';
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

async function resolveSessionId(req: NextRequest): Promise<string> {
  const url = new URL(req.url);
  const override = url.searchParams.get('sessionId');
  if (override && isAdminAuthed(req)) return override;
  return getActiveSessionId();
}

export async function GET(req: NextRequest) {
  if (!isAdminAuthed(req)) return unauthorized();

  try {
    await ensureSkillsContainer();
    const sessionId = await resolveSessionId(req);
    const container = getContainer('skills');
    const { resources } = await container.items
      .query({
        query: 'SELECT * FROM c WHERE c.sessionId = @sessionId',
        parameters: [{ name: '@sessionId', value: sessionId }],
      })
      .fetchAll();
    return NextResponse.json({ skills: resources });
  } catch (error) {
    console.error('GET skills error:', error);
    return NextResponse.json({ skills: [] });
  }
}

export async function POST(req: NextRequest) {
  if (!isAdminAuthed(req)) return unauthorized();

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

    const sessionId = await getActiveSessionId();
    const container = getContainer('skills');

    // Upsert semantics: find existing record for (sessionId, name) case-insensitive.
    const { resources: existing } = await container.items
      .query({
        query: 'SELECT * FROM c WHERE c.sessionId = @sessionId AND LOWER(c.name) = @name',
        parameters: [
          { name: '@sessionId', value: sessionId },
          { name: '@name', value: name.toLowerCase() },
        ],
      })
      .fetchAll();

    if (existing.length > 0) {
      const prior = existing[0] as PlayerSkills;
      const updated: PlayerSkills = {
        ...prior,
        name, // take the new casing
        scores,
        updatedAt: new Date().toISOString(),
      };
      const { resource } = await container.items.upsert(updated);
      return NextResponse.json(resource);
    }

    const record: PlayerSkills = {
      id: randomBytes(16).toString('hex'),
      sessionId,
      name,
      scores,
      updatedAt: new Date().toISOString(),
    };
    const { resource } = await container.items.create(record);
    return NextResponse.json(resource, { status: 201 });
  } catch (error) {
    console.error('POST skills error:', error);
    return NextResponse.json({ error: 'Failed to save skills' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  if (!isAdminAuthed(req)) return unauthorized();

  try {
    await ensureSkillsContainer();
    const body = await req.json();
    const id = typeof body.id === 'string' ? body.id : '';
    if (!id) return NextResponse.json({ error: 'ID required' }, { status: 400 });

    const scores = validateScores(body.scores);
    if (!scores) {
      return NextResponse.json({ error: 'Scores must be integers between 0 and 6' }, { status: 400 });
    }

    const container = getContainer('skills');
    const { resource: existing } = await container.item(id, id).read();
    if (!existing) {
      return NextResponse.json({ error: 'Record not found' }, { status: 404 });
    }

    const updated: PlayerSkills = {
      ...(existing as PlayerSkills),
      scores: { ...(existing as PlayerSkills).scores, ...scores },
      updatedAt: new Date().toISOString(),
    };
    const { resource } = await container.items.upsert(updated);
    return NextResponse.json(resource);
  } catch (error) {
    console.error('PATCH skills error:', error);
    return NextResponse.json({ error: 'Failed to update skills' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  if (!isAdminAuthed(req)) return unauthorized();

  try {
    await ensureSkillsContainer();
    const body = await req.json();
    const id = typeof body.id === 'string' ? body.id : '';
    if (!id) return NextResponse.json({ error: 'ID required' }, { status: 400 });

    const container = getContainer('skills');
    await container.item(id, id).delete();
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('DELETE skills error:', error);
    return NextResponse.json({ error: 'Failed to delete' }, { status: 500 });
  }
}
