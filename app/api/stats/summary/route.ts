import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { checkRateLimit, getClientIp } from '@/lib/rateLimit';
import { getContainer } from '@/lib/cosmos';

/**
 * Player-facing weekly summary. Generates a 1-2 sentence read of the
 * player's recent attendance via Claude Haiku (cheapest model). The client
 * caches the result in localStorage by (name, week-of-year) so we make at
 * most one API call per friend per week.
 *
 * Token budget per call:
 *   - input: ~120 tokens (prompt + stats summary)
 *   - output: ≤80 tokens (capped via max_tokens)
 *   - 12 friends × 1 call/week × 200 tokens ≈ 2.4k tokens/week → trivial
 *
 * Rate limit: 5/hr per (name, IP). The weekly cache makes this mostly a
 * backstop against accidental loops; legitimate users hit it once per week.
 *
 * Auth: this is player-facing (not admin). We rely on the rate limit + the
 * fact that identity-claiming is already trust-based in localStorage. No
 * sensitive data leaves the server beyond what's already on the Stats tab.
 */

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const HAIKU_MODEL = 'claude-haiku-4-5-20251001';
const MAX_OUTPUT_TOKENS = 80;
const ATTENDANCE_WEEKS = 52;

interface AttendanceRow {
  sessionId: string;
  datetime: string | null;
  attended: boolean;
}

export async function POST(req: NextRequest) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: 'AI is not configured on this deployment' }, { status: 503 });
  }

  const ip = getClientIp(req);

  let body: { name?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name || name.length > 50) {
    return NextResponse.json({ error: 'name required' }, { status: 400 });
  }

  // Rate limit: 5 generations per hour per (name, IP). Higher than admin
  // rate limits because friends might genuinely click multiple times in
  // exploration; 5/hr leaves room without permitting accidental loops.
  if (!checkRateLimit(`stats-summary:${name.toLowerCase()}:${ip}`, 5, 60 * 60 * 1000)) {
    return NextResponse.json({ error: 'Too many requests. Try again later.' }, { status: 429 });
  }

  // Pull attendance directly from Cosmos. We don't go through the existing
  // /api/stats/attendance endpoint to avoid a self-fetch + double serialize;
  // the query logic below mirrors what that handler does.
  const playersContainer = getContainer('players');
  const sessionsContainer = getContainer('sessions');

  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - ATTENDANCE_WEEKS * 7);
  const cutoffIso = cutoffDate.toISOString();

  const [playerHits, sessionHits] = await Promise.all([
    playersContainer.items
      .query({
        query: 'SELECT * FROM c WHERE LOWER(c.name) = LOWER(@name) AND (NOT IS_DEFINED(c.removed) OR c.removed != true) AND (NOT IS_DEFINED(c.waitlisted) OR c.waitlisted != true)',
        parameters: [{ name: '@name', value: name }],
      })
      .fetchAll(),
    sessionsContainer.items
      .query({
        query: 'SELECT c.id, c.datetime FROM c WHERE c.datetime >= @cutoff',
        parameters: [{ name: '@cutoff', value: cutoffIso }],
      })
      .fetchAll(),
  ]);

  const attendedSessionIds = new Set<string>(
    (playerHits.resources as { sessionId?: string }[])
      .map((p) => p.sessionId)
      .filter((id): id is string => typeof id === 'string'),
  );

  const recentSessions = (sessionHits.resources as { id: string; datetime: string | null }[])
    .filter((s) => s.datetime)
    .sort((a, b) => (a.datetime ?? '').localeCompare(b.datetime ?? ''));

  const history: AttendanceRow[] = recentSessions.map((s) => ({
    sessionId: s.id,
    datetime: s.datetime,
    attended: attendedSessionIds.has(s.id),
  }));

  const totalSessions = history.length;
  const attended = history.filter((h) => h.attended).length;
  const attendanceRate = totalSessions > 0 ? Math.round((attended / totalSessions) * 100) : 0;

  // Compute current + longest streak the same way the heatmap does (run of
  // consecutive attended sessions, ordered chronologically).
  let currentStreak = 0;
  let longestStreak = 0;
  let runStreak = 0;
  for (const h of history) {
    if (h.attended) {
      runStreak += 1;
      if (runStreak > longestStreak) longestStreak = runStreak;
    } else {
      runStreak = 0;
    }
  }
  // Current streak = run from the most recent session backward
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].attended) currentStreak += 1;
    else break;
  }

  // Tight prompt — most of the spend would be on context if we let it.
  const prompt = `You're writing a friendly weekly quick-read for a casual badminton player named ${name}.

Stats from the last ${totalSessions} sessions (past year):
- Attended: ${attended} (${attendanceRate}%)
- Current streak: ${currentStreak} ${currentStreak === 1 ? 'session' : 'sessions'}
- Longest streak: ${longestStreak} ${longestStreak === 1 ? 'session' : 'sessions'}

Write a single 1-2 sentence summary in plain text. Friendly and honest tone, no jargon, no emoji, no markdown. Avoid generic praise — anchor on the specific numbers. Frame it as a week-in-review observation.`;

  let summary = '';
  try {
    const message = await anthropic.messages.create({
      model: HAIKU_MODEL,
      max_tokens: MAX_OUTPUT_TOKENS,
      messages: [{ role: 'user', content: prompt }],
    });
    if (message.content[0]?.type === 'text') {
      summary = message.content[0].text.trim();
    }
  } catch (err) {
    console.error('stats-summary Anthropic error:', err);
    return NextResponse.json({ error: 'AI request failed' }, { status: 502 });
  }

  if (!summary) {
    return NextResponse.json({ error: 'AI returned empty response' }, { status: 502 });
  }

  return NextResponse.json({
    name,
    summary,
    generatedAt: new Date().toISOString(),
    stats: { totalSessions, attended, attendanceRate, currentStreak, longestStreak },
  });
}
