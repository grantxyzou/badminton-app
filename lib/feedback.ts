/**
 * PROBLEM REPORTS ("Report a problem") — where they are written and read.
 *
 * A report is a `kind: 'feedback'` row in the `releases` container (GLOBAL,
 * PK `/id`), beside the changelog's `kind: 'release'` rows — NOT a container
 * of its own since 2026-10-14 (`docs/plans/container-fold.md`). Both are
 * app-level, written by or for whoever runs the deployment, never a club's:
 * a report goes to the OPERATOR (`lib/containers.ts`), which is why it is
 * not in `clubSettings` — that container is GROUP scoped and would stamp and
 * filter a report by club.
 *
 * FOLD WINDOW. Until the copy route (`lib/containerFold.ts`) has run and PR 2
 * of the plan has deleted it, the report read and the anonymiser look at the
 * new home UNION the old `feedback` container, deduplicated by id. New
 * reports are written to the new home only.
 *
 * The kind filter is a LITERAL and re-checked in JS: the mock store filters
 * by parameter NAME, applies no WHERE, and knows no `@kind`.
 */
import { ensureContainer, getContainer } from './cosmos';

export const FEEDBACK_KIND = 'feedback';
export const RELEASE_KIND = 'release';
/** The container reports live in now. Named for its first tenant; Cosmos has no rename. */
export const FEEDBACK_HOME = 'releases' as const;
/** The container being folded away. Read-only here; deleted in PR 2. */
const LEGACY = 'feedback' as const;

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
 * Reports since `since` (ISO), newest first, from both homes. The projection
 * carries no `name` and no `ip`: the one reader is the operator's monthly
 * report, and a report is about the app, not the person.
 */
export async function readFeedbackSince(since: string): Promise<Row[]> {
  await ensureContainer(FEEDBACK_HOME, '/id');
  await ensureContainer(LEGACY, '/id');
  const select = 'SELECT c.id, c.kind, c.createdAt, c.message, c.tab, c.url FROM c';
  const params = [{ name: '@since', value: since }];
  const [home, legacy] = await Promise.all([
    getContainer(FEEDBACK_HOME).items.query<Row>({ query: `${select} WHERE c.kind = '${FEEDBACK_KIND}' AND c.createdAt >= @since`, parameters: params }).fetchAll(),
    getContainer(LEGACY).items.query<Row>({ query: `${select} WHERE c.createdAt >= @since`, parameters: params }).fetchAll(),
  ]);
  const rows = (home.resources ?? []).filter(isFeedback);
  const seen = new Set(rows.map((r) => r.id));
  for (const r of legacy.resources ?? []) if (!seen.has(r.id)) rows.push(r);
  // Re-checked: the mock store does not apply the WHERE.
  return rows
    .filter((r) => typeof r.createdAt === 'string' && r.createdAt >= since && typeof r.message === 'string')
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

/**
 * Account deletion: a report carries an optional reporter name AND the
 * submitting IP, both personal data; the text is operational and stays. Each
 * row is rewritten in the home it was found in. Returns the count.
 */
export async function anonymizeFeedbackRows(name: string, tombstone: string): Promise<number> {
  const lower = name.trim().toLowerCase();
  const sameName = (r: Row) => typeof r.name === 'string' && r.name.trim().toLowerCase() === lower;
  const params = [{ name: '@name', value: lower }];
  // Two literal container names, not a loop over a variable: the raw-access
  // canary cannot audit a call whose container name is a variable, and this file must stay auditable.
  await ensureContainer(FEEDBACK_HOME, '/id');
  await ensureContainer(LEGACY, '/id');
  const home = getContainer(FEEDBACK_HOME);
  const legacy = getContainer(LEGACY);
  let count = 0;
  for (const [container, where, keep] of [
    [home, `c.kind = '${FEEDBACK_KIND}' AND LOWER(c.name) = @name`, isFeedback],
    [legacy, 'LOWER(c.name) = @name', () => true],
  ] as const) {
    const { resources } = await container.items.query<Row>({ query: `SELECT * FROM c WHERE ${where}`, parameters: params }).fetchAll();
    for (const row of (resources ?? []).filter((r) => keep(r) && sameName(r))) {
      const { ip: _ip, ...rest } = row;
      await container.items.upsert({ ...rest, name: tombstone });
      count += 1;
    }
  }
  return count;
}
