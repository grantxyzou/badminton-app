import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  try {
    const { pin } = await req.json();
    const adminPin = process.env.ADMIN_PIN;
    if (!adminPin) {
      return NextResponse.json({ error: 'Admin PIN not configured' }, { status: 500 });
    }
    if (pin !== adminPin) {
      return NextResponse.json({ error: 'Incorrect PIN' }, { status: 401 });
    }
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: 'Verification failed' }, { status: 500 });
  }
}
