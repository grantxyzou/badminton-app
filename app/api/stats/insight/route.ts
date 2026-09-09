import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { checkRateLimit, getClientIp } from '@/lib/rateLimit';
import { getContainer, getActiveSessionId, ensureContainer, sessionIdFromDate } from '@/lib/cosmos';
import { groupScope, groupDocId, type GroupScope } from '@/lib/groupScope';
import { resolveGroupId } from '@/lib/groupContext';
import { topPartners } from '@/lib/recommend';
import { ownsNameOrAdmin } from '@/lib/auth';
import { summarizeAssessmentTrend, type AssessmentTrend, type StoredAssessment } from '@/lib/assessment';
import { getCanonicalLevel } from '@/lib/levelStore';
import type { CanonicalLevel } from '@/lib/level';
import { recommendDrills, type DrillPick } from '@/lib/drills';
import { computeInsightSignals, signalsByCard, type InsightSignal, type SignalCard } from '@/lib/insightSignals';
import { VOICE_PERSONA } from '@/lib/aiPersona';
import { INSIGHT_MODEL } from '@/lib/aiModels';

/**
 * Account-gated, passively-generated player insight. Replaces the old
 * button-driven /api/stats/summary.
 *
 * Two slices per call: a plain-language `greeting` for the top of the Stats
 * tab and a short, non-obvious `trend` chip for the skill-trend card (the
 * "distributed insights" shape; the earlier recap+focus "Your read" blob
 * retired with the INSIGHT_CARDS flag in 2026-09). Generated
 * once per (member, active session) and cached server-side in the `insights`
 * container — so output is CONSISTENT for the whole session-cycle and we make
 * at most one Claude call per member per session (no client CTA, no per-view
 * regeneration).
 *
 * "Memory": each generation is fed the member's PREVIOUS slices so the
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
const MODEL = INSIGHT_MODEL;
// Structured card insights are several short fields rather than one blob
// (the retired recap+focus blob ran at 400).
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
  /** The retired "Your read" shape. Nothing writes these since 2026-09, but
   *  cached docs from before still carry them (additive schema rule); a doc
   *  with only these misses the cache below and regenerates once. */
  recap?: string;
  focus?: string;
  greeting?: string | null;
  /* `level` sat here until 2026-08-27. Cached docs written before then still
     carry it; nothing reads it, and Cosmos ignores the extra field. */
  trend?: CardInsight | null;
  generatedAt: string;
  /** `takenAt` of the latest self-assessment baked into this insight. Lets a
   *  fresh check-in invalidate the session cache so the read reflects it.
   *  Absent on pre-assessment docs (treated as "no assessment baked in"). */
  lastAssessmentAt?: string | null;
}

/**
 * HTTP 200 with every field null — "there is genuinely nothing to say".
 *
 * This is a LEGITIMATE EMPTY, and there are now exactly two callers, both correct:
 *   - no `?name=`, or the name is not a member → the account gate
 *   - the model returned all-null cards        → silence beat an obvious remark
 *
 * Every failure that used to wear this payload now returns a real status. The
 * earlier version of this docstring listed three of them as known-wrong-and-unfixed,
 * and was itself wrong in three ways worth recording, because they are why the
 * defect survived being written down:
 *   1. It MISSED the worst one. A thrown member lookup fell through to the
 *      `!member` line and answered `account: false` — a database failure telling a
 *      signed-in member they have no account — and this docstring filed that path
 *      under "not a member → correct".
 *   2. Its line numbers had drifted (~:153, ~:223, ~:262, ~:288 against real sites
 *      that had moved), so anyone checking it against the code lost confidence in
 *      the whole list rather than in the one wrong entry.
 *   3. It counted two generation-threw sites. There is one.
 * An audit that has gone stale inside the file it audits is worse than none: it
 * reads as evidence the ground has been covered.
 */
function emptyPayload(account: boolean) {
  return NextResponse.json({ account, greeting: null, trend: null, generatedAt: null });
}

/** A database read failed. Never a 200 with nulls — that is the lying empty state. */
function readFailed() {
  return NextResponse.json({ error: 'read_failed' }, { status: 503 });
}

/** Generation can't run (no key, or the call threw) and there is no stale read. */
function aiUnavailable() {
  return NextResponse.json({ error: 'service_unavailable' }, { status: 503 });
}

/**
 * The previous insight, when generation can't run — better than both an error and
 * an empty card, because it was true recently and carries its own timestamp.
 *
 * Gated on greeting OR trend, deliberately. Both call sites used to check
 * `existing?.greeting` alone, while the cache-freshness test uses `greeting ||
 * trend` and its comment explicitly documents a trend-only doc as a valid shape —
 * so a member whose cached insight had no greeting had a stale copy sitting in
 * Cosmos that neither failure path would serve them.
 */
function staleOrNull(existing: InsightDoc | null) {
  if (!existing || (!existing.greeting && !existing.trend)) return null;
  return NextResponse.json({
    account: true,
    greeting: existing.greeting ?? null,
    trend: existing.trend ?? null,
    generatedAt: existing.generatedAt,
    stale: true,
  });
}

/**
 * Latest self-assessment trend for a member, or null. The
 * `assessments` store only exists when the skill-assessment spine is on, so off
 * deployments skip the query entirely. JS-filters by memberId because the mock
 * store ignores `@memberId` (same reason the assessments GET does). Failures are
 * non-fatal — the insight still generates from attendance/games alone.
 */
async function fetchAssessmentDocs(memberId: string): Promise<StoredAssessment[]> {
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
    // A real 429, not `emptyPayload(true)`. The empty payload is HTTP 200 with
    // every field null, which is exactly what "this member has no insight yet"
    // looks like — so a throttled read was indistinguishable from a legitimate
    // absence and the greeting just silently disappeared. Same lying-empty
    // state /api/stats/partners and /api/players/unpaid were fixed for.
    //
    // `useInsight` already routes any non-403 non-ok to its `error` state (see
    // the note beside its 403 check), so this needs no client change: it goes
    // from "no insight" to a legible load failure the moment the status is
    // honest. And 403 stays separate on purpose — telling a rate-limited
    // member to sign in again would be its own lie.
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }

  const name = new URL(req.url).searchParams.get('name')?.trim().slice(0, 50) ?? '';
  if (!name) return emptyPayload(false);

  // ── Privacy gate (rule 3: auth before DB). Same posture as /stats/level.
  //    Note the "Account gate" further down is a DIFFERENT thing: it decides
  //    WHOSE name resolves to a member, not WHO may ask. This is the one that
  //    answers "may you". Two harms it closes:
  //      1. The payload is AI prose grounded in this member's canonical level,
  //         trend and self-rated WEAKEST skills. Names are enumerable via the
  //         public GET /api/members, so ungated this was readable for anyone.
  //      2. A cache miss GENERATES — an unauthenticated caller could spend
  //         Anthropic budget at will. The gate therefore sits above every DB
  //         read and every generation path, not merely above the model call.
  if (!ownsNameOrAdmin(req, name)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  let membersContainer;
  const scope = groupScope(resolveGroupId(req));
  try {
    await ensureInsightsContainer();
    membersContainer = getContainer('members');
  } catch (err) {
    console.error('insight container setup failed:', err);
    // No stale fallback is even possible here — this runs before `existing` is
    // read, so there is nothing to serve. A 503 is the only honest answer.
    return readFailed();
  }

  // ── Account gate: resolve the member. Anonymous names get nothing. ──
  // Deliberately NOT lib/memberResolve: this needs the member's CANONICAL
  // stored name (`m.name`), which flows into buildSnapshot and the generated
  // prose, whereas MemberSubject.name is the trimmed QUERY string. Same
  // active-only filter, different return shape — folding it in would silently
  // change the casing the AI narrates. Allowlisted in the resolver canary.
  //
  // The `lookupFailed` flag is load-bearing. This catch used to only log, leaving
  // `member` null, so a THROWN Cosmos read fell through to the `!member` line below
  // and answered `account: false` — telling a signed-in member they have no account
  // because the database blipped. That is a worse lie than the three the
  // `emptyPayload` docstring admits to, and the docstring classified it as correct.
  let member: { id: string; name: string } | null = null;
  let lookupFailed = false;
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
    lookupFailed = true;
  }
  if (lookupFailed) return readFailed();
  if (!member) return emptyPayload(false);

  // A group with no session yet gets an empty seed: the cache key never
  // matches (nothing to be stale against) and the drill rotation is constant.
  // The insight doc itself moves to a per-group id in Phase 1b.
  const activeSessionId = (await getActiveSessionId(scope.groupId)) ?? '';
  // One cache doc per group per member: the insight narrates group play, so a
  // person in two groups gets two, instead of the two thrashing one doc.
  const insightId = groupDocId(scope.groupId, member.id);

  // ── Latest self-assessment. Fetched before the cache check so a
  //    fresh check-in invalidates the session-cached read. Raw docs are kept so
  //    the signal engine can fold the full history (sticky-weak, streaks). ──
  const assessmentDocs = await fetchAssessmentDocs(member.id);
  const trend = summarizeAssessmentTrend(assessmentDocs);
  const latestAssessmentAt = trend?.latestAt ?? null;

  // ── Cache: return the stored insight if it's for the current session AND no
  //    newer assessment has landed since it was generated. ──
  let existing: InsightDoc | null = null;
  try {
    existing = (await scope.read<InsightDoc>('insights', insightId, member.id)) ?? null;
  } catch {
    existing = null;
  }
  // Nullish-normalize both sides: a pre-assessment cached doc (undefined) with a
  // new assessment present (a string) mismatches → regenerate to fold it in.
  const assessmentMatches = (existing?.lastAssessmentAt ?? null) === latestAssessmentAt;
  const cacheFresh = !!existing && existing.sessionId === activeSessionId && assessmentMatches;
  // A persisted cards-doc always has at least one non-null slice (the generator
  // bails without writing when both are null), so "any slice present" is the
  // correct freshness test. Keying on `greeting` alone made a legitimately
  // null greeting (with a trend chip) miss the cache on every view and
  // re-call Claude — breaking the one-call-per-member-per-session guarantee.
  if (cacheFresh && (existing!.greeting || existing!.trend)) {
    return NextResponse.json({ account: true, greeting: existing!.greeting ?? null, trend: existing!.trend ?? null, generatedAt: existing!.generatedAt, cached: true });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    // No key — serve any stale insight rather than nothing.
    const stale = staleOrNull(existing);
    if (stale) return stale;
    return aiUnavailable();
  }

  // Canonical level. Same memberId-resolve as the trend; folds the
  // self-assessments into one private headline number. Non-fatal — the insight
  // still generates without it.
  //
  // MUST stay below the cache early-returns. `getCanonicalLevel` does two
  // unbounded `FROM c` container scans (lib/levelStore.ts), and its first USE
  // is the drills call immediately below — i.e. miss-path only. It used to sit
  // above the cache read, under a comment claiming it "only runs on miss",
  // which was simply false: every cached load paid for both scans and threw
  // the result away. Moving a read above the cache is not free here.
  const canonicalLevel = await getCanonicalLevel({ memberId: member.id, name: member.name }).catch((err) => {
    console.error('insight level read failed:', err);
    return null;
  });

  // Drills for the work-on skills. Deterministic; rotates by session.
  const drills = trend
    ? recommendDrills({ workOn: trend.workOn, level: canonicalLevel?.level ?? null, rotationSeed: activeSessionId })
    : [];

  // ── Gather the data snapshot (deterministic — fed verbatim to Claude). ──
  const snapshot = await buildSnapshot({ name: member.name, scope, trend, canonicalLevel, drills });

  // ── Distributed insights: structured, signal-grounded slices. ──
  {
    const signals = signalsByCard(computeInsightSignals({ snapshots: assessmentDocs, canonicalLevel, now: new Date().toISOString() }));
    let cards: { greeting: string | null; trend: CardInsight | null };
    try {
      cards = await generateCards(member.name, snapshot, signals, existing);
    } catch (err) {
      console.error('insight cards generation failed:', err);
      const stale = staleOrNull(existing);
      if (stale) return stale;
      return aiUnavailable();
    }
    if (!cards.greeting && !cards.trend) return emptyPayload(true);

    const generatedAt = new Date().toISOString();
    const doc: InsightDoc = { id: insightId, memberId: member.id, name: member.name, sessionId: activeSessionId, greeting: cards.greeting, trend: cards.trend, generatedAt, lastAssessmentAt: latestAssessmentAt };
    try {
      await scope.upsert('insights', doc);
    } catch (err) {
      console.warn('insight cache write failed (non-fatal):', err);
    }
    return NextResponse.json({ account: true, greeting: cards.greeting, trend: cards.trend, generatedAt, cached: false });
  }
}

interface Snapshot {
  /** The most recent session the member actually PLAYED, for partner context.
   *  Stage 8 (2026-08-20) removed every attendance count, rate and streak from
   *  this snapshot: Stats v2 deleted the surfaces that showed them, and leaving
   *  them here meant the greeting kept delivering the same "you missed N" guilt
   *  through the AI copy instead. A session the member skipped is not recorded
   *  at all now — there is nothing to narrate about it. */
  lastPlayed: { date: string; partners: string[] } | null;
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
  scope,
  trend,
  canonicalLevel,
  drills,
}: {
  name: string;
  /** The group whose play this narrates. Partner names leave for Anthropic, so this is a privacy boundary too. */
  scope: GroupScope;
  trend: AssessmentTrend | null;
  canonicalLevel: CanonicalLevel | null;
  drills: DrillPick[];
}): Promise<Snapshot> {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - ATTENDANCE_WEEKS * 7);
  const cutoffIso = cutoffDate.toISOString();
  const cutoffSessionId = sessionIdFromDate(cutoffIso, scope.groupId);
  const nowIso = new Date().toISOString();

  const [playerHits, sessionHits, partnerHits] = await Promise.all([
    scope.query<{ sessionId?: string }>('players', {
      select: 'c.sessionId',
      where: 'LOWER(c.name) = LOWER(@name) AND (NOT IS_DEFINED(c.removed) OR c.removed != true) AND (NOT IS_DEFINED(c.waitlisted) OR c.waitlisted != true)',
      params: [{ name: '@name', value: name }],
    }),
    scope.query<{ id: string; datetime: string | null }>('sessions', {
      select: 'c.id, c.datetime',
      where: 'c.datetime >= @cutoff',
      params: [{ name: '@cutoff', value: cutoffIso }],
    }),
    scope.query<{ sessionId?: string; name?: string; removed?: boolean }>('players', {
      select: 'c.sessionId, c.name, c.removed',
      where: 'c.sessionId >= @cutoff',
      params: [{ name: '@cutoff', value: cutoffSessionId }],
    }),
  ]);

  const attendedSessionIds = new Set<string>(
    playerHits.map((p) => p.sessionId).filter((id): id is string => typeof id === 'string'),
  );

  // Exclude not-yet-played (future-dated) sessions — an upcoming session is not
  // something the member has played yet. (Same rule as the attendance route.)
  const nowMs = Date.now();
  const recentSessions = sessionHits
    .filter((s) => s.datetime && new Date(s.datetime).getTime() <= nowMs)
    .sort((a, b) => (a.datetime ?? '').localeCompare(b.datetime ?? ''));

  const history = recentSessions.map((s) => ({ id: s.id, datetime: s.datetime as string, attended: attendedSessionIds.has(s.id) }));

  // Co-attendance map for partners + the last-played partner list.
  const bySession = new Map<string, string[]>();
  for (const row of partnerHits) {
    if (typeof row.sessionId !== 'string' || typeof row.name !== 'string' || row.removed === true) continue;
    const arr = bySession.get(row.sessionId) ?? [];
    arr.push(row.name);
    bySession.set(row.sessionId, arr);
  }
  const sessions = [...bySession.entries()].map(([sessionId, names]) => ({ sessionId, names }));
  const regularPartners = topPartners({ me: name, sessions, limit: 3 });

  // Last session the member PLAYED — not merely the last session that happened.
  // Anchoring on a session they skipped would let the narrator reach for "you
  // weren't there", and the partner list would be other people's game.
  const played = history.filter((h) => h.attended && h.datetime < nowIso);
  const last = played[played.length - 1] ?? null;
  const lastPlayed = last
    ? {
        date: last.datetime,
        partners: (bySession.get(last.id) ?? []).filter((n) => n.toLowerCase() !== name.toLowerCase()),
      }
    : null;

  // Legacy admin skills are a FALLBACK only — when a self-assessment exists we
  // skip this read entirely and never mix the two scales in one prompt.
  let skills: Record<string, number> | null = null;
  if (!trend) {
    try {
      const skillRows = await scope.query<{ scores?: Record<string, number> }>('skills', {
        select: 'c.name, c.scores',
        where: 'LOWER(c.name) = LOWER(@name)',
        params: [{ name: '@name', value: name }],
      });
      const scores = skillRows[0]?.scores;
      if (scores && Object.keys(scores).length > 0) skills = scores;
    } catch {
      skills = null;
    }
  }

  return { lastPlayed, regularPartners, assessment: trend, canonicalLevel, skills, drills };
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
): Promise<{ greeting: string | null; trend: CardInsight | null }> {
  const lastLine = s.lastPlayed
    ? `Last session ${name} played (${s.lastPlayed.date.slice(0, 10)}).`
    : 'No sessions played on record yet.';
  const partnerLine = s.regularPartners.length
    ? `Regular partners: ${s.regularPartners.map((p) => `${p.name} (${p.count})`).join(', ')}.`
    : 'No regular partners yet.';
  const skillLine = buildSkillLine(s);

  const cards: SignalCard[] = ['greeting', 'trend'];
  const signalBlock = cards
    .map((card) => {
      const sig = signals[card];
      return sig
        ? `- ${card}: [${sig.kind}] ${sig.hint} (grounded facts: ${JSON.stringify(sig.facts)})`
        : `- ${card}: (no non-obvious signal — return null for this slot)`;
    })
    .join('\n');
  const memoryLine = prev?.greeting ? `\n\nYour previous greeting to ${name}: "${prev.greeting}"` : '';

  const prompt = `${VOICE_PERSONA}

You're writing short, scannable insights for ${name}, a casual weekly player. Use ONLY the facts below — never invent numbers, names, events, or patterns.

DATA
${lastLine}
${partnerLine}${skillLine ? `\n${skillLine}` : ''}

NON-OBVIOUS SIGNALS (pre-computed — narrate the ones present; do not restate plain numbers):
${signalBlock}${memoryLine}

The whole point is value BEYOND the obvious: ${name} can already SEE their level number, phase, and skill ratings on the cards. NEVER restate those. Surface the relationship/pattern in the signals instead, in plain words.

Return ONLY a JSON object, no markdown fences:
{"greeting": "...", "trend": {"headline": "...", "support": "..."} | null}
- "greeting": ONE warm, plain-language sentence (max ~16 words) leading with the most interesting honest thing. Translate jargon (never "3.1 / switch / medium confidence"). If nothing is beyond the obvious, a brief encouraging line is fine.
- "trend": ONLY if that signal is present above — "headline" ≤ 8 words (the punch), "support" ≤ 14 words (one grounding clause). If the slot says "return null", return null for it.
- Plain, encouraging, specific. No emoji, no hashtags, no jargon. Do NOT repeat a raw rating number the card already shows.
- NEVER mention attendance, how many sessions they made or missed, or any kind of attendance streak. Those facts are deliberately not given to you; do not infer or imply them. A "streak" signal below counts CHECK-INS, never sessions.`;

  const message = await anthropic.messages.create({
    model: MODEL,
    max_tokens: MAX_OUTPUT_TOKENS_CARDS,
    messages: [{ role: 'user', content: prompt }],
  });
  const text = message.content[0]?.type === 'text' ? message.content[0].text.trim() : '';
  const parsed = parseCards(text);

  return {
    greeting: parsed.greeting,
    trend: signals.trend && parsed.trend ? { ...parsed.trend, kind: signals.trend.kind } : null,
  };
}

/** Tolerant parse of the structured card payload. Each card slice is nullable
 *  and requires a non-empty headline; support is optional. */
function parseCards(text: string): {
  greeting: string | null;
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
    const obj = JSON.parse(slice) as { greeting?: unknown; trend?: unknown };
    return {
      greeting: typeof obj.greeting === 'string' && obj.greeting.trim() ? obj.greeting.trim() : null,
      trend: coerceCard(obj.trend),
    };
  } catch {
    return { greeting: null, trend: null };
  }
}
