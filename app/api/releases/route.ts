import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit, getClientIp } from '@/lib/rateLimit';
import { randomBytes } from 'crypto';
import { getContainer, ensureContainer } from '@/lib/cosmos';
import { unauthorized } from '@/lib/auth';
import { isOperator } from '@/lib/operator';
import { getEnv } from '@/lib/flags';
import { RELEASE_KIND } from '@/lib/feedback';

// The container also holds the problem reports (`kind: 'feedback'`,
// lib/feedback.ts) since 2026-10-14 (docs/plans/container-fold.md). A release
// is a row with `kind: 'release'` — or, until the copy route has stamped the
// rows that predate the field, no kind at all. Never a feedback row.
const isRelease = (r: { kind?: unknown }) => r.kind === undefined || r.kind === RELEASE_KIND;

export const dynamic = 'force-dynamic';

// Lazy container bootstrap — real Cosmos doesn't auto-create containers.
function ensureReleasesContainer(): Promise<void> {
  return ensureContainer('releases', '/id');
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

/** What Home and Profile show: the newest notes, not every note ever written.
 *  The operator's editor asks for `?all=1`. */
const RELEASES_SHOWN = 30;

export async function GET(req: NextRequest) {
  // Public, and read on every Home and Profile open: a per-IP ceiling well
  // above any one phone's use, so a script cannot spend the database on it
  // (audit, 2026-11-05). Generous because one gym's wifi is one IP.
  if (!checkRateLimit(`releases:${getClientIp(req)}`, 120, 60 * 1000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  }
  const all = req.nextUrl.searchParams.get('all') === '1';
  try {
    await ensureReleasesContainer();
    const container = getContainer('releases');
    const { resources } = await container.items
      .query<{ kind?: unknown; publishedAt: string }>({
        query: `SELECT * FROM c WHERE c.kind = '${RELEASE_KIND}' OR NOT IS_DEFINED(c.kind) ORDER BY c.publishedAt DESC${all ? '' : ` OFFSET 0 LIMIT ${RELEASES_SHOWN}`}`,
      })
      .fetchAll();
    // Defensive sort — real Cosmos honors ORDER BY, but the in-memory mock
    // store does not (nor the WHERE, hence the filter). Sorting here
    // guarantees newest-first in both.
    const sorted = resources.filter(isRelease).sort((a, b) =>
      (b as { publishedAt: string }).publishedAt.localeCompare((a as { publishedAt: string }).publishedAt),
    );

    // No environment filter. There used to be one — show only releases stamped
    // with this build's `env` — to keep bpm-next's notes off bpm-stable, which
    // shared the database. That second deployment was deleted on 2026-08-25, and
    // on 2026-08-19 the surviving one was rebuilt as `stable` instead of `next`,
    // so the filter's only remaining effect was to hide every note ever
    // published from it. `env` is still stamped on write, as history.
    const filtered = all ? sorted : sorted.slice(0, RELEASES_SHOWN);

    return NextResponse.json(filtered);
  } catch (error) {
    // Surface the failure (503) instead of a lying 200 + empty list — a user
    // (or the admin ReleasesView) must not see "no releases" when the read
    // actually failed (CLAUDE.md: "Lying empty state is forbidden"). Consumers
    // already guard on res.ok, so they degrade to no-release-notes.
    console.error('GET releases error:', error);
    return NextResponse.json({ error: 'Failed to load releases' }, { status: 503 });
  }
}

/**
 * Release notes are the DEPLOYMENT's, read by every club, so writing them is
 * the operator's job, not any club's admin's: with groups on, anyone can
 * create a club and hold an admin cookie for it (audit, 2026-11-05).
 */
async function refuseNonOperator(req: NextRequest): Promise<NextResponse | null> {
  const op = await isOperator(req);
  if (op.ok) return null;
  return op.reason === 'unauthorized' ? unauthorized() : NextResponse.json({ error: 'operator_only' }, { status: 403 });
}

export async function POST(req: NextRequest) {
  const refused = await refuseNonOperator(req);
  if (refused) return refused;
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
      kind: RELEASE_KIND,
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

export async function PATCH(req: NextRequest) {
  const refused = await refuseNonOperator(req);
  if (refused) return refused;
  try {
    await ensureReleasesContainer();
    const raw = await req.json();
    if (!raw || typeof raw !== 'object') {
      return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
    }
    const r = raw as Record<string, unknown>;
    if (typeof r.id !== 'string' || !r.id) {
      return NextResponse.json({ error: 'ID required' }, { status: 400 });
    }
    const validated = validateReleaseBody(r);
    if (!validated) {
      return NextResponse.json({ error: 'Missing or invalid required fields' }, { status: 400 });
    }
    const container = getContainer('releases');
    const { resources } = await container.items
      .query({
        query: 'SELECT * FROM c WHERE c.id = @id',
        parameters: [{ name: '@id', value: r.id }],
      })
      .fetchAll();
    if (resources.length === 0 || !isRelease(resources[0] as { kind?: unknown })) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    const existing = resources[0] as Record<string, unknown>;
    const updated = {
      ...existing,
      kind: RELEASE_KIND,
      version: validated.version,
      title: validated.title,
      body: validated.body,
      editedAt: new Date().toISOString(),
    };
    const { resource } = await container.items.upsert(updated);
    return NextResponse.json(resource);
  } catch (error) {
    console.error('PATCH releases error:', error);
    return NextResponse.json({ error: 'Failed to update release' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const refused = await refuseNonOperator(req);
  if (refused) return refused;
  try {
    await ensureReleasesContainer();
    const { id } = await req.json();
    if (!id || typeof id !== 'string') {
      return NextResponse.json({ error: 'ID required' }, { status: 400 });
    }
    const container = getContainer('releases');
    // A report shares the container; this route deletes releases only.
    const existing = await container.item(id, id).read<{ kind?: unknown }>().then((r) => r.resource ?? null).catch(() => null);
    if (!existing || !isRelease(existing)) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    await container.item(id, id).delete();
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('DELETE releases error:', error);
    return NextResponse.json({ error: 'Failed to delete release' }, { status: 500 });
  }
}
