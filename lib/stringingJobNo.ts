/**
 * The next printed job number for a club (`J-0001`), from a COUNTER that
 * only ever goes up (code review, 2026-11-16).
 *
 * It was "how many jobs the club has, plus one". Deleting an archived job
 * lowers that count, so the next job took the number of the newest one again,
 * and two creates in the same moment read the same count; the invoice number
 * (`INV-0010`) is the job's, so invoices repeated with the tags. Neither is
 * rare: the archive's Delete is how a bench is kept tidy.
 *
 * One `kind: 'stringingJobSeq'` doc per club in `clubSettings` (PK `/id`,
 * group-scoped, beside the shop sign), raised under its etag so two creates
 * cannot take one number. Its first use seeds it from the HIGHEST number the
 * club's jobs already carry (never below their count), so no existing tag is
 * repeated; a number a job deleted before this existed held stays unknowable.
 */
import { groupDocId, type GroupScope } from './groupScope';
import { ensureClubSettings } from './stringingShop';

export const JOB_SEQ_KIND = 'stringingJobSeq';
const JOB_SEQ_DOC_ID = 'stringing-job-seq';
const ATTEMPTS = 6;

interface JobSeqDoc {
  id: string;
  kind: typeof JOB_SEQ_KIND;
  last: number;
  updatedAt: string;
  _etag?: string;
}

export function jobSeqDocId(groupId: string): string {
  return groupDocId(groupId, JOB_SEQ_DOC_ID);
}

/** `J-0042` → 42; anything else → 0. */
export function jobNoNumber(jobNo: unknown): number {
  const m = typeof jobNo === 'string' ? /^J-(\d+)$/.exec(jobNo.trim()) : null;
  return m ? Number(m[1]) : 0;
}

async function highestJobNo(scope: GroupScope): Promise<number> {
  const rows = await scope.query<{ jobNo?: string }>('stringingJobs', { select: 'c.jobNo' });
  return rows.reduce((max, r) => Math.max(max, jobNoNumber(r.jobNo)), rows.length);
}

function isConflict(err: unknown): boolean {
  return (err as { code?: unknown })?.code === 409;
}

/** The sequence number for the club's next job. Throws only when the store does. */
export async function nextJobSequence(scope: GroupScope): Promise<number> {
  await ensureClubSettings();
  const id = jobSeqDocId(scope.groupId);
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const now = new Date().toISOString();
    const doc = await scope.read<JobSeqDoc>('clubSettings', id);
    if (doc && doc.kind !== JOB_SEQ_KIND) throw new Error(`clubSettings ${id} is not a job counter`);
    if (!doc) {
      const first = (await highestJobNo(scope)) + 1;
      try {
        await scope.create<JobSeqDoc>('clubSettings', { id, kind: JOB_SEQ_KIND, last: first, updatedAt: now });
        return first;
      } catch (err) {
        // Another create seeded it first: take a number from theirs.
        if (isConflict(err)) continue;
        throw err;
      }
    }
    const last = Number.isInteger(doc.last) && doc.last > 0 ? doc.last : 0;
    const written = await scope.replace<JobSeqDoc>('clubSettings', { ...doc, last: last + 1, updatedAt: now });
    // `undefined`: another create raised it under us. Read again and retry.
    if (written) return last + 1;
  }
  throw new Error('nextJobSequence: the counter kept moving');
}
