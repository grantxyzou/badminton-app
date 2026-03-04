import { NextRequest, NextResponse } from 'next/server';
import { getContainer, SESSION_ID, DEFAULT_SESSION } from '@/lib/cosmos';

export async function GET() {
  try {
    const container = getContainer('sessions');
    const { resource } = await container.item(SESSION_ID, SESSION_ID).read();
    return NextResponse.json(resource ?? DEFAULT_SESSION);
  } catch (error: unknown) {
    const cosmosError = error as { code?: number };
    if (cosmosError?.code === 404) {
      return NextResponse.json(DEFAULT_SESSION);
    }
    // DB not configured or other error — return defaults so UI still works
    return NextResponse.json(DEFAULT_SESSION);
  }
}

export async function PUT(req: NextRequest) {
  try {
    const body = await req.json();
    const session = { ...body, id: SESSION_ID };
    const container = getContainer('sessions');
    const { resource } = await container.items.upsert(session);
    return NextResponse.json(resource);
  } catch (error) {
    console.error('PUT session error:', error);
    return NextResponse.json({ error: 'Failed to update session' }, { status: 500 });
  }
}
