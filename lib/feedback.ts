/**
 * PROBLEM REPORTS ("Report a problem") — where they are written and read.
 *
 * A report is a `kind: 'feedback'` row in the `releases` container (GLOBAL,
 * PK `/id`), beside the changelog's `kind: 'release'` rows — NOT a container
 * of its own since 2026-10-14 (`docs/plans/container-fold.md`). Both are
 * app-level, written by or for whoever runs the deployment, never a club's:
 * a report goes to the OPERATOR (`lib/containers.ts`), which is why it is
 * not in `clubSettings` — that container is GROUP scoped and would stamp and
 * filter a report by club. The copy ran on 2026-10-15 and the old `feedback`
 * container is deleted.
 *
 * The kind filter is a LITERAL and re-checked in JS: the mock store filters
 * by parameter NAME, applies no WHERE, and knows no `@kind`.
 */
import { ensureContainer, getContainer } from './cosmos';

export const FEEDBACK_KIND = 'feedback';
export const RELEASE_KIND = 'release';
/** The container reports live in. Named for its first tenant; Cosmos has no rename. */
export const FEEDBACK_HOME = 'releases' as const;

export interface FeedbackDoc {
  id: string;
  kind: typeof FEEDBACK_KIND;
  message: string;
  name?: string;
  tab?: string;
  url?: string;
  createdAt: string;
  /** Rate-limiting data; stripped from every read and from an anonymised row. */
  ip: string;
}

type Row = Record<string, unknown>;

const isFeedback = (r: Row) => r.kind === FEEDBACK_KIND;

export async function createFeedback(doc: Omit<FeedbackDoc, 'kind'>): Promise<void> {
  await ensureContainer(FEEDBACK_HOME, '/id');
  await getContainer(FEEDBACK_HOME).items.create({ ...doc, kind: FEEDBACK_KIND } satisfies FeedbackDoc);
}

/**
 * Reports since `since` (ISO), newest first. The projection carries no `name`
 * and no `ip`: the one reader is the operator's monthly report, and a report
 * is about the app, not the person.
 */
export async function readFeedbackSince(since: string): Promise<Row[]> {
  await ensureContainer(FEEDBACK_HOME, '/id');
  const { resources } = await getContainer(FEEDBACK_HOME).items
    .query<Row>({
      query: `SELECT c.id, c.kind, c.createdAt, c.message, c.tab, c.url FROM c WHERE c.kind = '${FEEDBACK_KIND}' AND c.createdAt >= @since`,
      parameters: [{ name: '@since', value: since }],
    })
    .fetchAll();
  // Re-checked: the mock store does not apply the WHERE.
  return (resources ?? [])
    .filter((r) => isFeedback(r) && typeof r.createdAt === 'string' && r.createdAt >= since && typeof r.message === 'string')
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

/**
 * Account deletion: a report carries an optional reporter name AND the
 * submitting IP, both personal data; the text is operational and stays.
 * Returns the count rewritten.
 */
export async function anonymizeFeedbackRows(name: string, tombstone: string): Promise<number> {
  const lower = name.trim().toLowerCase();
  await ensureContainer(FEEDBACK_HOME, '/id');
  const home = getContainer(FEEDBACK_HOME);
  const { resources } = await home.items
    .query<Row>({
      query: `SELECT * FROM c WHERE c.kind = '${FEEDBACK_KIND}' AND LOWER(c.name) = @name`,
      parameters: [{ name: '@name', value: lower }],
    })
    .fetchAll();
  let count = 0;
  for (const row of (resources ?? []).filter((r) => isFeedback(r) && typeof r.name === 'string' && r.name.trim().toLowerCase() === lower)) {
    const { ip: _ip, ...rest } = row;
    await home.items.upsert({ ...rest, name: tombstone });
    count += 1;
  }
  return count;
}
