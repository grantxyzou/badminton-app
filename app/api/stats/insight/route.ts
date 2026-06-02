import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { checkRateLimit, getClientIp } from '@/lib/rateLimit';
import { getContainer, getActiveSessionId, ensureContainer } from '@/lib/cosmos';
import { topPartners } from '@/lib/recommend';
import { isFlagOn } from '@/lib/flags';
import { summarizeAssessmentTrend, type AssessmentTrend, type StoredAssessment } from '@/lib/assessment';

/**
 * Account-gated, passively-generated player insight. Replaces the old
 * button-driven /api/stats/summary.
 *
 * Two sections per call: a `recap` of the last completed session / recent
 * stretch, and a forward-looking `focus` for the current session. Generated
 * once per (member, active session) and cached server-side in the `insights`
 * container — so output is CONSISTENT for the whole session-cycle and we make
 * at most one Claude call per member per session (no client CTA, no per-view
 * regeneration).
 *
 * "Memory": each generation is fed the member's PREVIOUS recap+focus so the
 * read builds a narrative ("you stuck with last week's plan...") rather than
 * starting cold.
 *
 * Model: Sonnet (not Haiku) — caching makes volume trivial (~one call per
 * member per session week), so we spend the per-call budget on better judgment
 * for the "what to focus on" coaching. Single call beats a draft→review chain
 * here: the output is short and fully grounded in numbers we compute, so a
 * second pass would only rewrite it for ~2× tokens and latency.
 *
 * Account gate: only members (resolvable in the directory) get an insight;
 * anonymous names get an empty payload. Rate-limited as a backstop.
 */

export const dynamic = 'force-dynamic';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = 'claude-sonnet-4-6';
const MAX_OUTPUT_TOKENS = 400;
const ATTENDANCE_WEEKS = 52;

// Lazy bootstrap — real Cosmos doesn't auto-create containers. PK /memberId
// (one insight doc per member, id === memberId).
let insightsReady: Promise<void> | null = null;
function ensureInsightsContainer(): Promise<void> {
  if (!insightsReady) {
    insightsReady = ensureContainer('insights', '/memberId').catch((err) => {
      insightsReady = null;
      throw err;
    });
  }
  return insightsReady;
}

interface InsightDoc {
  id: string;
  memberId: string;
  name: string;
  sessionId: string;
  recap: string;
  focus: string;
  generatedAt: string;
  /** `takenAt` of the latest self-assessment baked into this insight. Lets a
   *  fresh check-in invalidate the session cache so the read reflects it.
   *  Absent on pre-assessment docs (treated as "no assessment baked in"). */
  lastAssessmentAt?: string | null;
}

function emptyPayload(account: boolean) {
  return NextResponse.json({ account, recap: null, focus: null, generatedAt: null });
}

/**
 * Latest self-assessment trend for a member, or null. Flag-gated: the
 * `assessments` store only exists when the skill-assessment spine is on, so off
 * deployments skip the query entirely. JS-filters by memberId because the mock
 * store ignores `@memberId` (same reason the assessments GET does). Failures are
 * non-fatal — the insight still generates from attendance/games alone.
 */
async function fetchAssessmentTrend(memberId: string): Promise<AssessmentTrend | null> {
  if (!isFlagOn('NEXT_PUBLIC_FLAG_SKILL_ASSESS')) return null;
  try {
    await ensureContainer('assessments', '/memberId');
    const { resources } = await getContainer('assessments').items
      .query({
        query: 'SELECT c.memberId, c.takenAt, c.ratings, c.overall, c.phase FROM c WHERE c.memberId = @memberId',
        parameters: [{ name: '@memberId', value: memberId }],
      })
      .fetchAll();
    const docs = (resources as (StoredAssessment & { memberId?: string })[]).filter(
      (d) => d && d.memberId === memberId && typeof d.takenAt === 'string',
    );
    return summarizeAssessmentTrend(docs);
  } catch (err) {
    console.error('insight assessment read failed:', err);
    return null;
  }
}

export async function GET(req: NextRequest) {
  const ip = getClientIp(req);
  if (!checkRateLimit(`stats-insight:${ip}`, 30, 60 * 60 * 1000)) {
    return emptyPayload(true);
  }

  const name = new URL(req.url).searchParams.get('name')?.trim().slice(0, 50) ?? '';
  if (!name) return emptyPayload(false);

  let membersContainer, playersContainer, sessionsContainer, insightsContainer;
  try {
    await ensureInsightsContainer();
    membersContainer = getContainer('members');
    playersContainer = getContainer('players');
    sessionsContainer = getContainer('sessions');
    insightsContainer = getContainer('insights');
  } catch (err) {
    console.error('insight container setup failed:', err);
    return emptyPayload(true);
  }

  // ── Account gate: resolve the member. Anonymous names get nothing. ──
  let member: { id: string; name: string } | null = null;
  try {
    const { resources } = await membersContainer.items
      .query({
        query: 'SELECT c.id, c.name FROM c WHERE LOWER(c.name) = LOWER(@name) AND c.active = true',
        parameters: [{ name: '@name', value: name }],
      })
      .fetchAll();
    const m = resources[0] as { id?: string; name?: string } | undefined;
    if (m && typeof m.id === 'string' && typeof m.name === 'string') member = { id: m.id, name: m.name };
  } catch (err) {
    console.error('insight member lookup failed:', err);
  }
  if (!member) return emptyPayload(false);

  const activeSessionId = await getActiveSessionId();

  // ── Latest self-assessment (flag-gated). Fetched before the cache check so a
  //    fresh check-in invalidates the session-cached read. ──
  const trend = await fetchAssessmentTrend(member.id);
  const latestAssessmentAt = trend?.latestAt ?? null;

  // ── Cache: return the stored insight if it's for the current session AND no
  //    newer assessment has landed since it was generated. ──
  let existing: InsightDoc | null = null;
  try {
    const { resource } = await insightsContainer.item(member.id, member.id).read<InsightDoc>();
    existing = resource ?? null;
  } catch {
    existing = null;
  }
  // Nullish-normalize both sides: a pre-assessment cached doc (undefined) with a
  // new assessment present (a string) mismatches → regenerate to fold it in.
  const assessmentMatches = (existing?.lastAssessmentAt ?? null) === latestAssessmentAt;
  if (existing && existing.sessionId === activeSessionId && existing.recap && assessmentMatches) {
    return NextResponse.json({
      account: true,
      recap: existing.recap,
      focus: existing.focus,
      generatedAt: existing.generatedAt,
      cached: true,
    });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    // No key — serve any stale insight rather than nothing, but don't generate.
    if (existing?.recap) {
      return NextResponse.json({ account: true, recap: existing.recap, focus: existing.focus, generatedAt: existing.generatedAt, stale: true });
    }
    return emptyPayload(true);
  }

  // ── Gather the data snapshot (deterministic — fed verbatim to Claude). ──
  const snapshot = await buildSnapshot({ name: member.name, playersContainer, sessionsContainer, trend });

  // ── Generate (memory = previous recap+focus). ──
  let recap = '';
  let focus = '';
  try {
    const result = await generate(member.name, snapshot, existing);
    recap = result.recap;
    focus = result.focus;
  } catch (err) {
    console.error('insight generation failed:', err);
    if (existing?.recap) {
      return NextResponse.json({ account: true, recap: existing.recap, focus: existing.focus, generatedAt: existing.generatedAt, stale: true });
    }
    return emptyPayload(true);
  }
  if (!recap && !focus) return emptyPayload(true);

  const generatedAt = new Date().toISOString();
  const doc: InsightDoc = { id: member.id, memberId: member.id, name: member.name, sessionId: activeSessionId, recap, focus, generatedAt, lastAssessmentAt: latestAssessmentAt };
  try {
    await insightsContainer.items.upsert(doc);
  } catch (err) {
    console.warn('insight cache write failed (non-fatal):', err);
  }

  return NextResponse.json({ account: true, recap, focus, generatedAt, cached: false });
}

interface Snapshot {
  totalSessions: number;
  attended: number;
  attendanceRate: number;
  currentStreak: number;
  longestStreak: number;
  lastSession: { date: string; attended: boolean; partners: string[] } | null;
  regularPartners: { name: string; count: number }[];
  /** Self-assessment trend (1–5). The preferred skill source — when present the
   *  legacy `skills` read is skipped and `skills` is null. */
  assessment: AssessmentTrend | null;
  /** Legacy admin-entered skills (0–6). Fallback only — populated when there is
   *  no self-assessment. Never narrated alongside `assessment` (two scales). */
  skills: Record<string, number> | null;
}

async function buildSnapshot({
  name,
  playersContainer,
  sessionsContainer,
  trend,
}: {
  name: string;
  playersContainer: ReturnType<typeof getContainer>;
  sessionsContainer: ReturnType<typeof getContainer>;
  trend: AssessmentTrend | null;
}): Promise<Snapshot> {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - ATTENDANCE_WEEKS * 7);
  const cutoffIso = cutoffDate.toISOString();
  const cutoffSessionId = `session-${cutoffIso.slice(0, 10)}`;
  const nowIso = new Date().toISOString();

  const [playerHits, sessionHits, partnerHits] = await Promise.all([
    playersContainer.items
      .query({
        query: 'SELECT c.sessionId FROM c WHERE LOWER(c.name) = LOWER(@name) AND (NOT IS_DEFINED(c.removed) OR c.removed != true) AND (NOT IS_DEFINED(c.waitlisted) OR c.waitlisted != true)',
        parameters: [{ name: '@name', value: name }],
      })
      .fetchAll(),
    sessionsContainer.items
      .query({
        query: 'SELECT c.id, c.datetime FROM c WHERE c.datetime >= @cutoff',
        parameters: [{ name: '@cutoff', value: cutoffIso }],
      })
      .fetchAll(),
    playersContainer.items
      .query({
        query: 'SELECT c.sessionId, c.name, c.removed FROM c WHERE c.sessionId >= @cutoff',
        parameters: [{ name: '@cutoff', value: cutoffSessionId }],
      })
      .fetchAll(),
  ]);

  const attendedSessionIds = new Set<string>(
    (playerHits.resources as { sessionId?: string }[]).map((p) => p.sessionId).filter((id): id is string => typeof id === 'string'),
  );

  const recentSessions = (sessionHits.resources as { id: string; datetime: string | null }[])
    .filter((s) => s.datetime)
    .sort((a, b) => (a.datetime ?? '').localeCompare(b.datetime ?? ''));

  const history = recentSessions.map((s) => ({ id: s.id, datetime: s.datetime as string, attended: attendedSessionIds.has(s.id) }));
  const totalSessions = history.length;
  const attended = history.filter((h) => h.attended).length;
  const attendanceRate = totalSessions > 0 ? Math.round((attended / totalSessions) * 100) : 0;

  let longestStreak = 0;
  let run = 0;
  for (const h of history) {
    if (h.attended) { run += 1; if (run > longestStreak) longestStreak = run; } else { run = 0; }
  }
  let currentStreak = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].attended) currentStreak += 1; else break;
  }

  // Co-attendance map for partners + the last-session partner list.
  const bySession = new Map<string, string[]>();
  for (const row of partnerHits.resources as { sessionId?: string; name?: string; removed?: boolean }[]) {
    if (typeof row.sessionId !== 'string' || typeof row.name !== 'string' || row.removed === true) continue;
    const arr = bySession.get(row.sessionId) ?? [];
    arr.push(row.name);
    bySession.set(row.sessionId, arr);
  }
  const sessions = [...bySession.entries()].map(([sessionId, names]) => ({ sessionId, names }));
  const regularPartners = topPartners({ me: name, sessions, limit: 3 });

  // Last COMPLETED session (most recent with datetime in the past).
  const completed = history.filter((h) => h.datetime < nowIso);
  const last = completed[completed.length - 1] ?? null;
  const lastSession = last
    ? {
        date: last.datetime,
        attended: last.attended,
        partners: (bySession.get(last.id) ?? []).filter((n) => n.toLowerCase() !== name.toLowerCase()),
      }
    : null;

  // Legacy admin skills are a FALLBACK only — when a self-assessment exists we
  // skip this read entirely and never mix the two scales in one prompt.
  let skills: Record<string, number> | null = null;
  if (!trend) {
    try {
      const { resources: skillRows } = await getContainer('skills').items
        .query({
          query: 'SELECT c.name, c.scores FROM c WHERE LOWER(c.name) = LOWER(@name)',
          parameters: [{ name: '@name', value: name }],
        })
        .fetchAll();
      const scores = (skillRows[0] as { scores?: Record<string, number> } | undefined)?.scores;
      if (scores && Object.keys(scores).length > 0) skills = scores;
    } catch {
      skills = null;
    }
  }

  return { totalSessions, attended, attendanceRate, currentStreak, longestStreak, lastSession, regularPartners, assessment: trend, skills };
}

async function generate(name: string, s: Snapshot, prev: InsightDoc | null): Promise<{ recap: string; focus: string }> {
  const lastLine = s.lastSession
    ? `Last completed session (${s.lastSession.date.slice(0, 10)}): ${name} ${s.lastSession.attended ? 'PLAYED' : 'did NOT play'}${
        s.lastSession.attended && s.lastSession.partners.length ? `, alongside ${s.lastSession.partners.join(', ')}` : ''
      }.`
    : 'No completed sessions on record yet.';
  const partnerLine = s.regularPartners.length
    ? `Regular partners: ${s.regularPartners.map((p) => `${p.name} (${p.count})`).join(', ')}.`
    : 'No regular partners yet.';
  // Skill source is EXCLUSIVE: a self-assessment trend (1-5) when present, else
  // the legacy admin skills (0-6). Never both — two scales confuse the model.
  const skillLine = buildSkillLine(s);
  const memoryLine = prev?.recap
    ? `\n\nYour previous note to ${name} (one session ago):\n- Recap: ${prev.recap}\n- Focus: ${prev.focus}`
    : '';

  const prompt = `You are a warm, plain-spoken badminton companion writing for ${name}, a casual weekly player. Use ONLY the facts below — never invent numbers, names, or events.

${lastLine}
Season (last ${s.totalSessions} sessions): attended ${s.attended} (${s.attendanceRate}%), current streak ${s.currentStreak}, longest streak ${s.longestStreak}.
${partnerLine}${skillLine ? `\n${skillLine}` : ''}${memoryLine}

Return ONLY a JSON object, no markdown fences:
{"recap": "...", "focus": "..."}
- "recap": 1-2 sentences on how the last session / recent stretch went. Weave in attendance AND, if a self-assessment is present, how their skill rating moved (up, down, or holding). If a previous note exists, acknowledge progress against it.
- "focus": 1-2 sentences naming ONE concrete thing to work on for the upcoming session. If a self-assessment lists "working on" skills, anchor the focus on one of them. Build on the previous focus if there was one (did they act on it?). Specific, encouraging, no jargon, no emoji.`;

  const message = await anthropic.messages.create({
    model: MODEL,
    max_tokens: MAX_OUTPUT_TOKENS,
    messages: [{ role: 'user', content: prompt }],
  });
  const text = message.content[0]?.type === 'text' ? message.content[0].text.trim() : '';
  return parseInsight(text);
}

/**
 * The skill section of the prompt. Self-assessment (1-5) is preferred and
 * EXCLUSIVE; legacy admin skills (0-6) are the fallback. Empty when neither
 * exists. The trend phrasing mirrors SkillTrendCard's then→now delta so the
 * narrated movement agrees with the radar the player is looking at.
 */
function buildSkillLine(s: Snapshot): string {
  const a = s.assessment;
  if (a) {
    const fmt = (n: number | null) => (n === null ? '—' : n.toFixed(1));
    const parts: string[] = [
      `Self-assessment (1-5 self-rating, ${a.count} check-in${a.count === 1 ? '' : 's'} on record): overall ${fmt(a.overall)}`,
    ];
    if (a.phase) parts.push(`${a.phase} phase`);
    if (a.delta === null) {
      parts.push('first check-in — this is the baseline');
    } else if (a.delta > 0.05) {
      parts.push(`up ${a.delta.toFixed(1)} since the previous check-in (was ${fmt(a.prevOverall)})`);
    } else if (a.delta < -0.05) {
      parts.push(`down ${Math.abs(a.delta).toFixed(1)} since the previous check-in (was ${fmt(a.prevOverall)})`);
    } else {
      parts.push(`holding steady since the previous check-in (was ${fmt(a.prevOverall)})`);
    }
    let line = `${parts.join('; ')}.`;
    if (a.strengths.length) line += ` Strongest: ${a.strengths.map((r) => `${r.label} (${r.value})`).join(', ')}.`;
    if (a.workOn.length) line += ` Working on (lowest-rated): ${a.workOn.map((r) => `${r.label} (${r.value})`).join(', ')}.`;
    return line;
  }
  if (s.skills) {
    return `Self-rated skills (0-6): ${Object.entries(s.skills).map(([k, v]) => `${k} ${v}`).join(', ')}.`;
  }
  return '';
}

/** Tolerant JSON extraction — strips code fences, pulls the first {...} block. */
function parseInsight(text: string): { recap: string; focus: string } {
  const cleaned = text.replace(/```json/gi, '').replace(/```/g, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  const slice = start >= 0 && end > start ? cleaned.slice(start, end + 1) : cleaned;
  try {
    const obj = JSON.parse(slice) as { recap?: unknown; focus?: unknown };
    return {
      recap: typeof obj.recap === 'string' ? obj.recap.trim() : '',
      focus: typeof obj.focus === 'string' ? obj.focus.trim() : '',
    };
  } catch {
    // Last resort: the whole thing is the recap, no focus.
    return { recap: cleaned.slice(0, 400), focus: '' };
  }
}
