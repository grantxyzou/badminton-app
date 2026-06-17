import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { checkRateLimit, getClientIp } from '@/lib/rateLimit';
import { getContainer, getActiveSessionId, ensureContainer } from '@/lib/cosmos';
import { topPartners } from '@/lib/recommend';
import { isFlagOn } from '@/lib/flags';
import { summarizeAssessmentTrend, type AssessmentTrend, type StoredAssessment } from '@/lib/assessment';
import { getCanonicalLevel } from '@/lib/levelStore';
import type { CanonicalLevel } from '@/lib/level';
import { recommendDrills, type DrillPick } from '@/lib/drills';
import { computeInsightSignals, signalsByCard, type InsightSignal, type SignalCard } from '@/lib/insightSignals';

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
// Structured card insights are several short fields rather than one blob.
const MAX_OUTPUT_TOKENS_CARDS = 600;
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

/** One distributed-insight slice: a styled chip's content. `kind` is set
 *  server-side from the driving signal (drives the chip icon), never trusted
 *  from the model. */
interface CardInsight {
  headline: string;
  support?: string;
  kind: string;
}

interface InsightDoc {
  id: string;
  memberId: string;
  name: string;
  sessionId: string;
  /** Legacy "Your read" shape (flag off). Optional now — structured docs omit it. */
  recap?: string;
  focus?: string;
  /** Distributed-insight shape (NEXT_PUBLIC_FLAG_INSIGHT_CARDS on). Additive —
   *  legacy recap/focus docs simply lack these and regenerate once on a flag flip. */
  greeting?: string | null;
  level?: CardInsight | null;
  trend?: CardInsight | null;
  generatedAt: string;
  /** `takenAt` of the latest self-assessment baked into this insight. Lets a
   *  fresh check-in invalidate the session cache so the read reflects it.
   *  Absent on pre-assessment docs (treated as "no assessment baked in"). */
  lastAssessmentAt?: string | null;
}

function emptyPayload(account: boolean) {
  return NextResponse.json({ account, recap: null, focus: null, greeting: null, level: null, trend: null, generatedAt: null });
}

/**
 * Latest self-assessment trend for a member, or null. Flag-gated: the
 * `assessments` store only exists when the skill-assessment spine is on, so off
 * deployments skip the query entirely. JS-filters by memberId because the mock
 * store ignores `@memberId` (same reason the assessments GET does). Failures are
 * non-fatal — the insight still generates from attendance/games alone.
 */
async function fetchAssessmentDocs(memberId: string): Promise<StoredAssessment[]> {
  if (!isFlagOn('NEXT_PUBLIC_FLAG_SKILL_ASSESS')) return [];
  try {
    await ensureContainer('assessments', '/memberId');
    const { resources } = await getContainer('assessments').items
      .query({
        query: 'SELECT c.memberId, c.takenAt, c.ratings, c.overall, c.phase, c.dimensionScores FROM c WHERE c.memberId = @memberId',
        parameters: [{ name: '@memberId', value: memberId }],
      })
      .fetchAll();
    return (resources as (StoredAssessment & { memberId?: string })[]).filter(
      (d) => d && d.memberId === memberId && typeof d.takenAt === 'string',
    );
  } catch (err) {
    console.error('insight assessment read failed:', err);
    return [];
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

  const cardsOn = isFlagOn('NEXT_PUBLIC_FLAG_INSIGHT_CARDS');

  // ── Latest self-assessment (flag-gated). Fetched before the cache check so a
  //    fresh check-in invalidates the session-cached read. Raw docs are kept so
  //    the signal engine can fold the full history (sticky-weak, streaks). ──
  const assessmentDocs = await fetchAssessmentDocs(member.id);
  const trend = summarizeAssessmentTrend(assessmentDocs);
  const latestAssessmentAt = trend?.latestAt ?? null;

  // Canonical level (flag-gated). Same memberId-resolve as the trend; folds the
  // self-assessments into one private headline number. Non-fatal — the insight
  // still generates without it. Cheap on the cached path (only runs on miss).
  const canonicalLevel = isFlagOn('NEXT_PUBLIC_FLAG_SKILL_LEVEL')
    ? await getCanonicalLevel({ memberId: member.id, name: member.name }).catch((err) => {
        console.error('insight level read failed:', err);
        return null;
      })
    : null;

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
  const cacheFresh = !!existing && existing.sessionId === activeSessionId && assessmentMatches;
  // The cache is keyed by the shape the current flag wants: a flag flip leaves a
  // doc with the wrong field set, which misses here and regenerates once.
  if (cacheFresh && cardsOn && existing!.greeting) {
    return NextResponse.json({ account: true, greeting: existing!.greeting, level: existing!.level ?? null, trend: existing!.trend ?? null, generatedAt: existing!.generatedAt, cached: true });
  }
  if (cacheFresh && !cardsOn && existing!.recap) {
    return NextResponse.json({ account: true, recap: existing!.recap, focus: existing!.focus, generatedAt: existing!.generatedAt, cached: true });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    // No key — serve any stale insight of the right shape rather than nothing.
    if (cardsOn && existing?.greeting) {
      return NextResponse.json({ account: true, greeting: existing.greeting, level: existing.level ?? null, trend: existing.trend ?? null, generatedAt: existing.generatedAt, stale: true });
    }
    if (!cardsOn && existing?.recap) {
      return NextResponse.json({ account: true, recap: existing.recap, focus: existing.focus, generatedAt: existing.generatedAt, stale: true });
    }
    return emptyPayload(true);
  }

  // Drills for the work-on skills (flag-gated). Deterministic; rotates by session.
  const drills = isFlagOn('NEXT_PUBLIC_FLAG_SKILL_DRILLS') && trend
    ? recommendDrills({ workOn: trend.workOn, level: canonicalLevel?.level ?? null, rotationSeed: activeSessionId })
    : [];

  // ── Gather the data snapshot (deterministic — fed verbatim to Claude). ──
  const snapshot = await buildSnapshot({ name: member.name, playersContainer, sessionsContainer, trend, canonicalLevel, drills });

  // ── Distributed insights (flag on): structured, signal-grounded slices. ──
  if (cardsOn) {
    const signals = signalsByCard(computeInsightSignals({ snapshots: assessmentDocs, canonicalLevel, now: new Date().toISOString() }));
    let cards: { greeting: string | null; level: CardInsight | null; trend: CardInsight | null };
    try {
      cards = await generateCards(member.name, snapshot, signals, existing);
    } catch (err) {
      console.error('insight cards generation failed:', err);
      if (existing?.greeting) {
        return NextResponse.json({ account: true, greeting: existing.greeting, level: existing.level ?? null, trend: existing.trend ?? null, generatedAt: existing.generatedAt, stale: true });
      }
      return emptyPayload(true);
    }
    if (!cards.greeting && !cards.level && !cards.trend) return emptyPayload(true);

    const generatedAt = new Date().toISOString();
    const doc: InsightDoc = { id: member.id, memberId: member.id, name: member.name, sessionId: activeSessionId, greeting: cards.greeting, level: cards.level, trend: cards.trend, generatedAt, lastAssessmentAt: latestAssessmentAt };
    try {
      await insightsContainer.items.upsert(doc);
    } catch (err) {
      console.warn('insight cache write failed (non-fatal):', err);
    }
    return NextResponse.json({ account: true, greeting: cards.greeting, level: cards.level, trend: cards.trend, generatedAt, cached: false });
  }

  // ── Legacy "Your read" (flag off): recap + focus blob. ──
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
  /** Canonical level (1–5) — the private headline, when the level flag is on.
   *  Narrated as a one-line header above the self-assessment detail. */
  canonicalLevel: CanonicalLevel | null;
  /** Legacy admin-entered skills (0–6). Fallback only — populated when there is
   *  no self-assessment. Never narrated alongside `assessment` (two scales). */
  skills: Record<string, number> | null;
  /** Drills for the work-on skills (flag-gated). Narrated by name in the focus. */
  drills: DrillPick[];
}

async function buildSnapshot({
  name,
  playersContainer,
  sessionsContainer,
  trend,
  canonicalLevel,
  drills,
}: {
  name: string;
  playersContainer: ReturnType<typeof getContainer>;
  sessionsContainer: ReturnType<typeof getContainer>;
  trend: AssessmentTrend | null;
  canonicalLevel: CanonicalLevel | null;
  drills: DrillPick[];
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

  return { totalSessions, attended, attendanceRate, currentStreak, longestStreak, lastSession, regularPartners, assessment: trend, canonicalLevel, skills, drills };
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
- "focus": 1-2 sentences naming ONE concrete thing to work on for the upcoming session. If a self-assessment lists "working on" skills, anchor the focus on one of them. If "Suggested drills" are listed, name ONE of them verbatim as the concrete action (don't invent a different drill). Build on the previous focus if there was one (did they act on it?). Specific, encouraging, no jargon, no emoji.
- If the notes mention a gap between recent games and the self-rating, you MAY reference it gently and only as encouragement — never as criticism, and never with a number.`;

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
  // Canonical level is a one-line HEADER (1–5) above the self-assessment detail.
  // It and the self-assessment share the 1–5 scale, so they never conflict the
  // way the legacy 0–6 skills would — but we still never emit the 0–6 line
  // alongside it (that branch is the no-assessment fallback below).
  const lvl = s.canonicalLevel;
  let levelHeader = '';
  if (lvl && lvl.level !== null) {
    levelHeader = `Canonical level: ${lvl.level.toFixed(1)} / 5${lvl.phase ? ` (${lvl.phase} phase, ${lvl.confidence} confidence)` : ''}. `;
    if (lvl.basis.game !== null) {
      levelHeader += `Recent logged games put their play around ${lvl.basis.game.toFixed(1)}. `;
    }
    // The blind-spot direction is a SOFT hint for the narrator — framed, never a
    // deficit number. 'above' = pleasant surprise; 'below' = games haven't caught up.
    if (lvl.blindSpot?.direction === 'above') {
      levelHeader += 'Their games are running a bit ahead of their self-rating (a nice sign). ';
    } else if (lvl.blindSpot?.direction === 'below') {
      levelHeader += 'Their self-rating is a little ahead of recent game results (room to grow into it). ';
    }
    if (lvl.pendingPromotion) {
      levelHeader += `They're on the cusp of the ${lvl.pendingPromotion} phase — one more consistent check-in confirms it. `;
    }
  }

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
    let line = `${levelHeader}${parts.join('; ')}.`;
    if (a.strengths.length) line += ` Strongest: ${a.strengths.map((r) => `${r.label} (${r.value})`).join(', ')}.`;
    if (a.workOn.length) line += ` Working on (lowest-rated): ${a.workOn.map((r) => `${r.label} (${r.value})`).join(', ')}.`;
    if (s.drills.length) {
      line += ` Suggested drills for those skills: ${s.drills.map((d) => `"${d.title}" (${d.minutes}min, ${d.setting}, for ${d.skillLabel})`).join('; ')}.`;
    }
    return line;
  }
  if (s.skills) {
    return `Self-rated skills (0-6): ${Object.entries(s.skills).map(([k, v]) => `${k} ${v}`).join(', ')}.`;
  }
  return '';
}

/**
 * Distributed-insight generation: a plain-language greeting + a short,
 * NON-OBVIOUS chip per card, grounded in the pre-computed signals. The model
 * only narrates the signals into plain words — it never selects them and never
 * invents a pattern. `kind` is attached server-side from the signal (drives the
 * chip icon), and any card without a signal is forced null (silence > obvious).
 */
async function generateCards(
  name: string,
  s: Snapshot,
  signals: Record<SignalCard, InsightSignal | null>,
  prev: InsightDoc | null,
): Promise<{ greeting: string | null; level: CardInsight | null; trend: CardInsight | null }> {
  const lastLine = s.lastSession
    ? `Last completed session (${s.lastSession.date.slice(0, 10)}): ${name} ${s.lastSession.attended ? 'PLAYED' : 'did NOT play'}.`
    : 'No completed sessions on record yet.';
  const partnerLine = s.regularPartners.length
    ? `Regular partners: ${s.regularPartners.map((p) => `${p.name} (${p.count})`).join(', ')}.`
    : 'No regular partners yet.';
  const skillLine = buildSkillLine(s);

  const cards: SignalCard[] = ['greeting', 'level', 'trend'];
  const signalBlock = cards
    .map((card) => {
      const sig = signals[card];
      return sig
        ? `- ${card}: [${sig.kind}] ${sig.hint} (grounded facts: ${JSON.stringify(sig.facts)})`
        : `- ${card}: (no non-obvious signal — return null for this slot)`;
    })
    .join('\n');
  const memoryLine = prev?.greeting ? `\n\nYour previous greeting to ${name}: "${prev.greeting}"` : '';

  const prompt = `You are a warm, plain-spoken badminton companion writing short, scannable insights for ${name}, a casual weekly player. Use ONLY the facts below — never invent numbers, names, events, or patterns.

DATA
${lastLine}
Season (last ${s.totalSessions} sessions): attended ${s.attended} (${s.attendanceRate}%), current streak ${s.currentStreak}, longest ${s.longestStreak}.
${partnerLine}${skillLine ? `\n${skillLine}` : ''}

NON-OBVIOUS SIGNALS (pre-computed — narrate the ones present; do not restate plain numbers):
${signalBlock}${memoryLine}

The whole point is value BEYOND the obvious: ${name} can already SEE their level number, phase, and skill ratings on the cards. NEVER restate those. Surface the relationship/pattern in the signals instead, in plain words.

Return ONLY a JSON object, no markdown fences:
{"greeting": "...", "level": {"headline": "...", "support": "..."} | null, "trend": {"headline": "...", "support": "..."} | null}
- "greeting": ONE warm, plain-language sentence (max ~16 words) leading with the most interesting honest thing. Translate jargon (never "3.1 / switch / medium confidence"). If nothing is beyond the obvious, a brief encouraging line is fine.
- "level" / "trend": ONLY if that signal is present above — "headline" ≤ 8 words (the punch), "support" ≤ 14 words (one grounding clause). If the slot says "return null", return null for it.
- Plain, encouraging, specific. No emoji, no hashtags, no jargon. Do NOT repeat a raw rating number the card already shows.`;

  const message = await anthropic.messages.create({
    model: MODEL,
    max_tokens: MAX_OUTPUT_TOKENS_CARDS,
    messages: [{ role: 'user', content: prompt }],
  });
  const text = message.content[0]?.type === 'text' ? message.content[0].text.trim() : '';
  const parsed = parseCards(text);

  return {
    greeting: parsed.greeting,
    level: signals.level && parsed.level ? { ...parsed.level, kind: signals.level.kind } : null,
    trend: signals.trend && parsed.trend ? { ...parsed.trend, kind: signals.trend.kind } : null,
  };
}

/** Tolerant parse of the structured card payload. Each card slice is nullable
 *  and requires a non-empty headline; support is optional. */
function parseCards(text: string): {
  greeting: string | null;
  level: { headline: string; support?: string } | null;
  trend: { headline: string; support?: string } | null;
} {
  const cleaned = text.replace(/```json/gi, '').replace(/```/g, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  const slice = start >= 0 && end > start ? cleaned.slice(start, end + 1) : cleaned;
  const coerceCard = (v: unknown): { headline: string; support?: string } | null => {
    if (!v || typeof v !== 'object') return null;
    const o = v as { headline?: unknown; support?: unknown };
    const headline = typeof o.headline === 'string' ? o.headline.trim() : '';
    if (!headline) return null;
    const support = typeof o.support === 'string' && o.support.trim() ? o.support.trim() : undefined;
    return support ? { headline, support } : { headline };
  };
  try {
    const obj = JSON.parse(slice) as { greeting?: unknown; level?: unknown; trend?: unknown };
    return {
      greeting: typeof obj.greeting === 'string' && obj.greeting.trim() ? obj.greeting.trim() : null,
      level: coerceCard(obj.level),
      trend: coerceCard(obj.trend),
    };
  } catch {
    return { greeting: null, level: null, trend: null };
  }
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
