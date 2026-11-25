/**
 * Setting the stage before a journey, as the organiser, through the same API
 * the Admin screens call (docs/plans/e2e-test-club.md, "Reset fixture").
 *
 * Every helper here touches ONLY the cast: rows and jobs are matched to the
 * cast's own names, and the organiser was put through the club guard before
 * any of them runs, so on production all of it happens inside the E2E test
 * club and to its test members.
 */
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { MOCK_CAST } from './personas';
import { target } from './target';
import { api, type Actor } from './journey';

const DAY = 24 * 60 * 60 * 1000;

/** Move an ISO datetime by whole days, keeping its written offset. */
export function shiftIsoDays(iso: string, days: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})(T.*)$/.exec(iso);
  if (!m) throw new Error(`not an ISO datetime: ${iso}`);
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + days));
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}${m[4]}`;
}

/**
 * Mock only: the organiser adds the cast to the roster with fixed PINs and
 * turns on Stringer for the stringer. Safe to run twice: a name already on
 * the roster, or a PIN already set, is the state this wants.
 */
export async function ensureMockCast(org: Actor): Promise<void> {
  if (target() !== 'mock') return;
  // Once per run: every spec asks, and each pass sets PINs (a limited write).
  const marker = process.env.E2E_AUTH_DIR ? join(process.env.E2E_AUTH_DIR, 'mock-cast-ready') : null;
  if (marker && existsSync(marker)) return;
  for (const member of Object.values(MOCK_CAST)) {
    const added = await api<{ id?: string }>(org, 'POST', '/api/members', { name: member.name }, (s) => s < 300 || s === 409);
    let id = added.data?.id;
    if (!id) {
      const roster = await api<Array<{ id: string; name: string }>>(org, 'GET', '/api/members');
      id = roster.data.find((m) => m.name === member.name)?.id;
    }
    if (!id) throw new Error(`mock cast: ${member.name} is not on the roster`);
    await api(org, 'PATCH', '/api/members/me', { name: member.name, newPin: member.pin }, (s) => s < 300 || s === 401);
    if (member.stringer) await api(org, 'PATCH', '/api/members', { id, canString: true });
  }
  if (marker) writeFileSync(marker, '');
}

interface SessionDoc {
  datetime?: string;
  endDatetime?: string;
  deadline?: string;
}

/**
 * The week the sign-up journey plays in: open, two spots, and far enough
 * ahead that no cancel is late and no deadline has passed. A session that has
 * drifted into the past is moved forward a whole number of weeks, so its
 * weekday and time stay the club's.
 */
export async function prepareSession(org: Actor, spots = 2): Promise<void> {
  const res = await api<SessionDoc & { error?: string }>(org, 'GET', '/api/session', undefined, (s) => s === 200 || s === 404);
  if (res.status === 404) {
    throw new Error('the club has no session yet: set its first one (Admin tools → Set your first session) and run again');
  }
  const s = res.data;
  const update: Record<string, unknown> = { signupOpen: true, maxPlayers: spots };
  if (s.datetime) {
    const wantAfter = Date.now() + 7 * DAY;
    const starts = new Date(s.datetime).getTime();
    const deadline = s.deadline ? new Date(s.deadline).getTime() : starts;
    if (starts < Date.now() + 3 * DAY || deadline < Date.now() + DAY) {
      const weeks = Math.max(1, Math.ceil((wantAfter - starts) / (7 * DAY)));
      update.datetime = shiftIsoDays(s.datetime, weeks * 7);
      if (s.endDatetime) update.endDatetime = shiftIsoDays(s.endDatetime, weeks * 7);
      if (s.deadline) update.deadline = shiftIsoDays(s.deadline, weeks * 7);
    }
  }
  await api(org, 'PUT', '/api/session', update);
}

/** Take the named people off this week's list entirely, waitlist included. */
export async function clearSignups(org: Actor, names: string[]): Promise<void> {
  const rows = await api<Array<{ id: string; name: string }>>(org, 'GET', '/api/players?all=true');
  for (const row of rows.data) {
    if (!names.includes(row.name)) continue;
    await api(org, 'DELETE', '/api/players', { purgeOne: row.id }, (s) => s < 300 || s === 404);
  }
}

interface BenchJob {
  id: string;
  memberId: string;
  memberName: string;
}

/**
 * Remove the named people's stringing jobs: archive whatever is on the bench,
 * then delete from the archive (a job can only be deleted from there). Picks
 * up a job a crashed run left in either place.
 */
export async function clearJobs(org: Actor, names: string[]): Promise<void> {
  const bench = await api<{ jobs?: BenchJob[] }>(org, 'GET', '/api/stringing/jobs');
  for (const job of bench.data.jobs ?? []) {
    if (!names.includes(job.memberName)) continue;
    await api(org, 'PATCH', `/api/stringing/jobs/${encodeURIComponent(job.id)}`, { memberId: job.memberId, archived: true });
  }
  const archive = await api<{ jobs?: BenchJob[] }>(org, 'GET', '/api/stringing/jobs?archived=true');
  for (const job of archive.data.jobs ?? []) {
    if (!names.includes(job.memberName)) continue;
    await api(org, 'DELETE', `/api/stringing/jobs/${encodeURIComponent(job.id)}`, { confirm: true, memberId: job.memberId }, (s) => s < 300 || s === 404);
  }
}

/**
 * The join journey's reset: the named person off the club's roster (a soft
 * removal, which an approval later reverses), and any request to join under
 * that name declined, so a crashed run leaves neither a member nor a waiting
 * ask behind.
 */
export async function removeFromClub(org: Actor, name: string): Promise<void> {
  const roster = await api<Array<{ id: string; name: string; active?: boolean }>>(org, 'GET', '/api/members');
  for (const m of roster.data) {
    if (m.name !== name || m.active === false) continue;
    await api(org, 'DELETE', '/api/members', { id: m.id }, (s) => s < 300 || s === 404);
  }
  const asks = await api<{ joins?: Array<{ joinRequestId: string; name: string }> }>(org, 'GET', '/api/admin/access-requests');
  for (const j of asks.data.joins ?? []) {
    if (j.name !== name) continue;
    await api(org, 'POST', '/api/admin/access-requests', { joinRequestId: j.joinRequestId, decision: 'decline' }, (s) => s < 300 || s === 404);
  }
}

/** The club's link token, read as the organiser; made once if the club has none. */
export async function clubLinkToken(org: Actor): Promise<string> {
  const read = await api<{ link?: { token?: string } | null }>(org, 'GET', '/api/groups/claim-link');
  if (read.data.link?.token) return read.data.link.token;
  const made = await api<{ link?: { token?: string } }>(org, 'POST', '/api/groups/claim-link');
  if (!made.data.link?.token) throw new Error('the club has no link and none could be made');
  return made.data.link.token;
}
