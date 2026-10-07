import { groupDocId, groupScope } from './groupScope';
import { ensureClubSettings } from './stringingShop';
import { groupNamedByKey, keyMatchesHash, newClubKey } from './clubKey';

/**
 * The weekly-report key (docs/plans/usage-metrics.md): a READ-ONLY per-club
 * secret a scheduled helper sends as `x-reports-key` to read the club's
 * metrics totals — and, for the operator's club only, name-stripped problem
 * reports. Same machinery as the payments key (lib/clubKey.ts), separate
 * secret: neither can do the other's job.
 *
 * Stored as a sha256 in the club's `clubSettings` doc; the plaintext exists
 * once, in the mint response.
 */

export const REPORTS_SETTINGS_ID = 'reports-access';
export function reportsSettingsId(groupId: string): string {
  return groupDocId(groupId, REPORTS_SETTINGS_ID);
}

export interface ReportsAccessDoc {
  id: string;
  keyHash?: string;
  keyCreatedAt?: string;
  /** The last time a report read with this key — shown on the admin card. */
  lastUsedAt?: string;
}

export async function readReportsAccess(groupId: string): Promise<ReportsAccessDoc | undefined> {
  await ensureClubSettings();
  return groupScope(groupId).read<ReportsAccessDoc>('clubSettings', reportsSettingsId(groupId));
}

/** Mint (or rotate) the club's reports key. The ONLY time the plaintext exists. */
export async function mintReportsKey(groupId: string): Promise<string> {
  const { key, keyHash } = newClubKey(groupId);
  const existing = await readReportsAccess(groupId);
  await groupScope(groupId).upsert<ReportsAccessDoc>('clubSettings', {
    ...(existing ?? { id: reportsSettingsId(groupId) }),
    keyHash,
    keyCreatedAt: new Date().toISOString(),
  });
  return key;
}

/** The club a presented key belongs to, or null — malformed and wrong are the same null. */
export async function groupForReportsKey(provided: string | null): Promise<string | null> {
  const groupId = groupNamedByKey(provided);
  if (!groupId || !provided) return null;
  const doc = await readReportsAccess(groupId);
  if (!doc || !keyMatchesHash(provided, doc.keyHash)) return null;
  // Best-effort "last used": a failed stamp never fails the read.
  groupScope(groupId)
    .replace<ReportsAccessDoc>('clubSettings', { ...doc, lastUsedAt: new Date().toISOString() })
    .catch(() => {});
  return groupId;
}

/** One "Report a problem" message as a report reads it — no IP, no name. */
export interface FeedbackReportRow {
  createdAt: string;
  message: string;
  tab: string | null;
  path: string | null;
}

/** The path a report was sent from, with no query or fragment (an invite token can ride in either). */
export function pathOnly(url: unknown): string | null {
  if (typeof url !== 'string' || !url) return null;
  try {
    return new URL(url, 'https://x.invalid').pathname.slice(0, 200);
  } catch {
    return null;
  }
}
