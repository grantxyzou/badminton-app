import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { getContainer, ensureContainer } from '@/lib/cosmos';
import { isAdminAuthed, unauthorized } from '@/lib/auth';
import { getEnv, type EnvName } from '@/lib/flags';

export const dynamic = 'force-dynamic';

// Lazy container bootstrap — real Cosmos doesn't auto-create containers.
let releasesReady: Promise<void> | null = null;
function ensureReleasesContainer(): Promise<void> {
  if (!releasesReady) {
    releasesReady = ensureContainer('releases', '/id').catch((err) => {
      releasesReady = null;
      throw err;
    });
  }
  return releasesReady;
}

interface ReleaseBody {
  version: string;
  title: { en: string; 'zh-CN': string };
  body: { en: string; 'zh-CN': string };
}

function validateReleaseBody(raw: unknown): ReleaseBody | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.version !== 'string' || !r.version.trim()) return null;
  const title = r.title as Record<string, unknown> | undefined;
  const body = r.body as Record<string, unknown> | undefined;
  if (!title || typeof title.en !== 'string' || typeof title['zh-CN'] !== 'string') return null;
  if (!body || typeof body.en !== 'string' || typeof body['zh-CN'] !== 'string') return null;
  return {
    version: r.version.trim(),
    title: { en: title.en, 'zh-CN': title['zh-CN'] },
    body: { en: body.en, 'zh-CN': body['zh-CN'] },
  };
}

export async function GET(_req: NextRequest) {
  try {
    await ensureReleasesContainer();
    const container = getContainer('releases');
    const { resources } = await container.items
      .query({ query: 'SELECT * FROM c ORDER BY c.publishedAt DESC' })
      .fetchAll();
    // Defensive sort — real Cosmos honors ORDER BY, but the in-memory mock
    // store does not. Sorting here guarantees newest-first in both.
    const sorted = [...resources].sort((a, b) =>
      (b as { publishedAt: string }).publishedAt.localeCompare((a as { publishedAt: string }).publishedAt),
    );

    // Environment filter — only return releases stamped with the current env
    // (or legacy pre-env records with no `env` field, which stay visible on
    // both deployments for backcompat). Stops releases posted on bpm-next
    // from leaking onto bpm-stable through the shared Cosmos DB.
    const env = getEnv();
    const filtered = sorted.filter((r) => {
      const recEnv = (r as { env?: EnvName }).env;
      if (!recEnv) return true;   // legacy, always visible
      if (env === 'dev') return true; // dev sees everything
      return recEnv === env;
    });

    return NextResponse.json(filtered);
  } catch (error) {
    console.error('GET releases error:', error);
    return NextResponse.json([]);
  }
}

export async function POST(req: NextRequest) {
  if (!isAdminAuthed(req)) return unauthorized();
  try {
    await ensureReleasesContainer();
    const raw = await req.json();
    const validated = validateReleaseBody(raw);
    if (!validated) {
      return NextResponse.json({ error: 'Missing or invalid required fields' }, { status: 400 });
    }
    const publishedAt = new Date().toISOString();
    const id = `release-${publishedAt.slice(0, 10)}-${validated.version}-${randomBytes(4).toString('hex')}`;
    const env = getEnv();
    const record = {
      id,
      version: validated.version,
      title: validated.title,
      body: validated.body,
      publishedAt,
      publishedBy: 'admin' as const,
      // Stamp the deployment this was posted from so GET can filter
      // (bpm-next releases don't leak onto bpm-stable via the shared DB).
      env,
    };
    const container = getContainer('releases');
    await container.items.create(record);
    return NextResponse.json(record);
  } catch (error) {
    console.error('POST releases error:', error);
    return NextResponse.json({ error: 'Failed to create release' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  if (!isAdminAuthed(req)) return unauthorized();
  try {
    await ensureReleasesContainer();
    const { id } = await req.json();
    if (!id || typeof id !== 'string') {
      return NextResponse.json({ error: 'ID required' }, { status: 400 });
    }
    const container = getContainer('releases');
    await container.item(id, id).delete();
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('DELETE releases error:', error);
    return NextResponse.json({ error: 'Failed to delete release' }, { status: 500 });
  }
}
