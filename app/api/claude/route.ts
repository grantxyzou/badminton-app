import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { checkRateLimit, getClientIp } from '@/lib/rateLimit';
import { isAdminAuthedWithMember, unauthorized } from '@/lib/auth';
import { describeAiFailure } from '@/lib/aiError';
import { PROSE_MODEL } from '@/lib/aiModels';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  if (!checkRateLimit(`claude:${ip}`, 10, 60 * 1000)) {
    return NextResponse.json({ error: 'Too many requests. Please wait a moment.' }, { status: 429 });
  }

  // Spends real API budget, so use the fresh role re-check rather than the cheap
  // signature-only variant — the admin cookie outlives a demotion by up to 30 days.
  // Same trade as `app/api/push/test`, and the same known cost: that helper folds a
  // Cosmos failure into `{ authed: false }` (lib/auth.ts), so a database blip tells
  // an admin they are unauthorized. Accepted rather than fixed here, because
  // `lib/auth.ts` sits on 31 routes and is the wrong place to add a failure mode for
  // one caller's benefit.
  if (!(await isAdminAuthedWithMember(req)).authed) return unauthorized();

  // Parsed OUTSIDE the AI try/catch on purpose: a malformed body is a 400 from
  // this route, and folding it into the catch below would have described a bad
  // request as an AI outage.
  let prompt: unknown;
  try {
    ({ prompt } = await req.json());
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  if (typeof prompt !== 'string' || !prompt.trim()) {
    return NextResponse.json({ error: 'Prompt required' }, { status: 400 });
  }
  if (prompt.length > 4000) {
    return NextResponse.json({ error: 'Prompt too long' }, { status: 400 });
  }

  try {
    const message = await anthropic.messages.create({
      model: PROSE_MODEL,
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }],
    });

    const block = message.content[0];
    const text = block?.type === 'text' ? block.text : '';
    return NextResponse.json({ text });
  } catch (error) {
    console.error('Claude API error:', error);
    // Admin-only route, so the reason is safe to surface — and necessary: a flat
    // "AI request failed" is what let a retired model ID sit broken in
    // production, since the only person who could fix it couldn't see why.
    const { message, status } = describeAiFailure(error);
    return NextResponse.json({ error: message }, { status });
  }
}
