import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { getContainer } from '@/lib/cosmos';
import { isAdminAuthed, unauthorized } from '@/lib/auth';

export const dynamic = 'force-dynamic';

interface MigrationSummary {
  linked: number;
  created: number;
  skipped: number;
  wouldLink: number;
  wouldCreate: number;
  collisions: Array<{ name: string; memberCount: number }>;
}

export async function POST(req: NextRequest) {
  if (!isAdminAuthed(req)) return unauthorized();

  let dryRun = false;
  try {
    const body = await req.json();
    dryRun = body?.dryRun === true;
  } catch {
    // empty body — proceed with defaults
  }

  try {
    const playersContainer = getContainer('players');
    const membersContainer = getContainer('members');

    const [{ resources: allPlayers }, { resources: allMembers }] = await Promise.all([
      playersContainer.items.query({ query: 'SELECT * FROM c' }).fetchAll(),
      membersContainer.items.query({ query: 'SELECT * FROM c' }).fetchAll(),
    ]);

    // Group members by lowercased name for collision detection.
    const membersByName = new Map<string, Array<Record<string, unknown>>>();
    for (const m of allMembers as Array<Record<string, unknown>>) {
      if (typeof m?.name !== 'string') continue;
      const key = (m.name as string).toLowerCase();
      const list = membersByName.get(key) ?? [];
      list.push(m);
      membersByName.set(key, list);
    }

    const summary: MigrationSummary = {
      linked: 0, created: 0, skipped: 0, wouldLink: 0, wouldCreate: 0, collisions: [],
    };

    for (const player of allPlayers as Array<Record<string, unknown>>) {
      if (typeof player?.name !== 'string') continue;
      if (typeof player.memberId === 'string' && (player.memberId as string).length > 0) {
        summary.skipped++;
        continue;
      }

      const key = (player.name as string).toLowerCase();
      const candidates = membersByName.get(key) ?? [];

      if (candidates.length > 1) {
        if (!summary.collisions.find((c) => c.name === player.name)) {
          summary.collisions.push({ name: player.name as string, memberCount: candidates.length });
        }
        continue;
      }

      let target = candidates[0];
      if (!target) {
        const newMember = {
          id: randomBytes(12).toString('hex'),
          name: player.name,
          role: 'member' as const,
          sessionCount: 0,
          active: true,
          createdAt: new Date().toISOString(),
        };
        if (dryRun) {
          summary.wouldCreate++;
        } else {
          const { resource } = await membersContainer.items.create(newMember);
          target = resource as Record<string, unknown>;
          membersByName.set(key, [target]);
          summary.created++;
        }
      }

      if (dryRun) {
        summary.wouldLink++;
      } else if (target) {
        await playersContainer.items.upsert({ ...player, memberId: target.id });
        summary.linked++;
      }
    }

    return NextResponse.json(summary);
  } catch (error) {
    console.error('migrate-memberId error:', error);
    return NextResponse.json({ error: 'Migration failed' }, { status: 500 });
  }
}
