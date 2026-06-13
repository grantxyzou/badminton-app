/**
 * Server-only I/O for the canonical level. EVERY consumer (API route, insight
 * narrator, future gear rec) goes through `getCanonicalLevel` so the number is
 * computed one way. Pure math lives in `lib/level.ts`; this file only fetches.
 *
 * Reads mirror the established patterns:
 *  - assessments by `memberId` with a JS-side filter (the mock store ignores
 *    `@memberId`), same as `fetchAssessmentTrend` in the insight route and the
 *    assessments GET.
 *  - `Member.stage` by id (real members only; `name:`-derived ids have none).
 *
 * Failures are non-fatal: a read error degrades a source to absent rather than
 * throwing, so the level still derives from whatever survived.
 */

import { getContainer, ensureContainer } from './cosmos';
import { deriveLevel, type CanonicalLevel } from './level';

/** Subject identity, as resolved by the route (`resolveSubject` shape). */
export interface LevelSubject {
  /** Real `members` id, or a `name:<lower>` fallback for non-members. */
  memberId: string;
  name: string;
}

async function fetchSelfSnapshots(memberId: string): Promise<{ takenAt: string; overall: number | null }[]> {
  try {
    await ensureContainer('assessments', '/memberId');
    const { resources } = await getContainer('assessments').items
      .query({
        query: 'SELECT c.memberId, c.takenAt, c.overall FROM c WHERE c.memberId = @memberId',
        parameters: [{ name: '@memberId', value: memberId }],
      })
      .fetchAll();
    return (resources as { memberId?: string; takenAt?: string; overall?: number | null }[])
      .filter((d) => d && d.memberId === memberId && typeof d.takenAt === 'string')
      .map((d) => ({ takenAt: d.takenAt as string, overall: typeof d.overall === 'number' ? d.overall : null }));
  } catch (err) {
    console.error('level: assessment read failed:', err);
    return [];
  }
}

/** `Member.stage` for a real member id, else null (name-derived ids, misses,
 *  and errors all degrade to "no legacy stage"). */
async function fetchLegacyStage(memberId: string): Promise<number | null> {
  if (memberId.startsWith('name:')) return null;
  try {
    const { resource } = await getContainer('members').item(memberId, memberId).read<{ stage?: number }>();
    return typeof resource?.stage === 'number' ? resource.stage : null;
  } catch {
    return null;
  }
}

/** The single entry point. Folds the member's self-assessments + legacy stage
 *  into a canonical level. Phase 2+ will add game/peer reads here. */
export async function getCanonicalLevel(subject: LevelSubject): Promise<CanonicalLevel> {
  const [selfSnapshots, legacyStage] = await Promise.all([
    fetchSelfSnapshots(subject.memberId),
    fetchLegacyStage(subject.memberId),
  ]);
  return deriveLevel({ selfSnapshots, legacyStage, now: new Date().toISOString() });
}
