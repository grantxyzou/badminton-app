import { NextRequest, NextResponse } from 'next/server';
import { getContainer } from '@/lib/cosmos';
import { checkRateLimit, getClientIp } from '@/lib/rateLimit';

export async function GET(req: NextRequest) {
  const ip = getClientIp(req);
  if (!checkRateLimit(`members-me:${ip}`, 10, 60 * 1000)) {
    return NextResponse.json({ role: 'member', hasPin: false });
  }

  try {
    const name = new URL(req.url).searchParams.get('name')?.trim().slice(0, 50);
    if (!name) {
      return NextResponse.json({ role: 'member', hasPin: false });
    }

    const container = getContainer('members');
    const { resources } = await container.items
      .query({
        query: 'SELECT c.role, c.pinHash FROM c WHERE LOWER(c.name) = LOWER(@name) AND c.active = true',
        parameters: [{ name: '@name', value: name }],
      })
      .fetchAll();

    const role = resources[0]?.role ?? 'member';
    const hasPin = typeof resources[0]?.pinHash === 'string' && resources[0].pinHash.length > 0;
    return NextResponse.json({ role, hasPin });
  } catch (error) {
    console.error('GET members/me error:', error);
    return NextResponse.json({ role: 'member', hasPin: false });
  }
}
