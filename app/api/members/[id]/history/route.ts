import { NextRequest, NextResponse } from 'next/server';
import { getContainer } from '@/lib/cosmos';
import { groupScope } from '@/lib/groupScope';
import { resolveGroupId } from '@/lib/groupContext';
import { isAdminAuthed, unauthorized } from '@/lib/auth';
import { sessionCostTotals } from '@/lib/sessionCost';
import { expandAliasNames } from '@/lib/playerIdentity';
import type { Alias, Member, Player, Session } from '@/lib/types';

export const dynamic = 'force-dynamic';

interface SessionEntry {
  sessionId: string;
  date: string;
  attended: boolean;
  paid: boolean;
  costPerPerson: number;
}

interface LifetimeStats {
  attended: number;
  totalPaid: number;
}

export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  if (!isAdminAuthed(req)) return unauthorized();

  const { id: memberId } = await context.params;

  try {
    const scope = groupScope(resolveGroupId(req));
    const membersContainer = getContainer('members');
    // aliases stays raw until Phase 1b sweeps it.
    const aliasesContainer = getContainer('aliases');

    const { resource: member } = await membersContainer.item(memberId, memberId).read<Member>();
    if (!member) {
      return NextResponse.json({ error: 'Member not found' }, { status: 404 });
    }

    // Primary lookup: by memberId (cross-partition), within this group.
    let players = await scope.query<Player>('players', {
      where: 'c.memberId = @memberId',
      params: [{ name: '@memberId', value: memberId }],
    });

    // Fallback: name + aliases (covers legacy records the migration missed).
    if (players.length === 0) {
      const { resources: aliasRows } = await aliasesContainer.items
        .query({ query: 'SELECT * FROM c' })
        .fetchAll();
      const candidateNames = expandAliasNames(member.name, aliasRows as Alias[]);

      const allPlayers = await scope.query<Player>('players');
      players = allPlayers.filter(
        (p) => typeof p.name === 'string' && candidateNames.has(p.name.toLowerCase()),
      );
    }

    // Look up the matching sessions + per-session attendance counts.
    const sessionIds = Array.from(new Set(players.map((p) => p.sessionId).filter(Boolean)));
    const sessionMap = new Map<string, Session>();
    const attendanceBySession = new Map<string, number>();
    if (sessionIds.length > 0) {
      const allSessions = await scope.query<Session>('sessions');
      for (const s of allSessions) {
        if (sessionIds.includes(s.id)) sessionMap.set(s.id, s);
      }
      // Count active players per session so cost-per-person uses the right
      // denominator. Previously this read session.prevCostPerPerson, which
      // is the PREVIOUS session's frozen cost — every history row showed
      // last week's number.
      const allPlayers = await scope.query<{ sessionId?: string; removed?: boolean; waitlisted?: boolean }>('players', {
        select: 'c.sessionId, c.removed, c.waitlisted',
      });
      for (const p of allPlayers) {
        if (typeof p.sessionId !== 'string') continue;
        if (!sessionIds.includes(p.sessionId)) continue;
        if (p.removed === true || p.waitlisted === true) continue;
        attendanceBySession.set(p.sessionId, (attendanceBySession.get(p.sessionId) ?? 0) + 1);
      }
    }

    const entries: SessionEntry[] = players.map((player) => {
      const session = sessionMap.get(player.sessionId);
      const attended = !player.removed && !player.waitlisted;

      let costPerPerson = 0;
      if (session) {
        const { totalCost } = sessionCostTotals(session);
        const playerCount = attendanceBySession.get(player.sessionId) ?? 0;
        if (totalCost > 0 && playerCount > 0) {
          costPerPerson = Math.round((totalCost / playerCount) * 100) / 100;
        }
      }

      return {
        sessionId: player.sessionId,
        date: session?.datetime ?? '',
        attended,
        paid: player.paid === true,
        costPerPerson,
      };
    });

    entries.sort((a, b) => (a.sessionId < b.sessionId ? 1 : a.sessionId > b.sessionId ? -1 : 0));

    const lifetime: LifetimeStats = {
      attended: entries.filter((e) => e.attended).length,
      totalPaid: entries.filter((e) => e.paid).length,
    };

    return NextResponse.json({
      member: { id: member.id, name: member.name },
      sessions: entries,
      lifetime,
    });
  } catch (error) {
    console.error('GET /api/members/[id]/history error:', error);
    return NextResponse.json({ error: 'Failed to fetch history' }, { status: 500 });
  }
}
