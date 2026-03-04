import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function POST(req: NextRequest) {
  try {
    const { prompt } = await req.json();
    if (!prompt) {
      return NextResponse.json({ error: 'Prompt required' }, { status: 400 });
    }

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }],
    });

    const text =
      message.content[0].type === 'text' ? message.content[0].text : '';
    return NextResponse.json({ text });
  } catch (error) {
    console.error('Claude API error:', error);
    return NextResponse.json({ error: 'AI request failed' }, { status: 500 });
  }
}
