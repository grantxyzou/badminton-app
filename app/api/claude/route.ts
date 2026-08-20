import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { checkRateLimit, getClientIp } from '@/lib/rateLimit';
import { isAdminAuthed, unauthorized } from '@/lib/auth';
import { describeAiFailure } from '@/lib/aiError';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  if (!checkRateLimit(`claude:${ip}`, 10, 60 * 1000)) {
    return NextResponse.json({ error: 'Too many requests. Please wait a moment.' }, { status: 429 });
  }

  if (!isAdminAuthed(req)) return unauthorized();

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
      model: 'claude-sonnet-5',
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
