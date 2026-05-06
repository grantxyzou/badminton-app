import { NextRequest, NextResponse } from 'next/server';
import { getContainer } from '@/lib/cosmos';
import { isAdminAuthedWithMember, unauthorized } from '@/lib/auth';
import type { ETransferRecipient } from '@/lib/types';

export const dynamic = 'force-dynamic';

const SKIP_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_SKIP_DATES = 100;

function isValidETransferRecipient(value: unknown): value is ETransferRecipient {
  if (!value || typeof value !== 'object') return false;
  const v = value as { name?: unknown; email?: unknown; memo?: unknown };
  if (typeof v.name !== 'string' || !v.name.trim() || v.name.length > 100) return false;
  if (typeof v.email !== 'string' || !v.email.trim() || v.email.length > 200) return false;
  if (v.memo !== undefined && (typeof v.memo !== 'string' || v.memo.length > 200)) return false;
  return true;
}

function isValidSkipDates(value: unknown): value is string[] {
  if (!Array.isArray(value)) return false;
  if (value.length > MAX_SKIP_DATES) return false;
  return value.every((d) => typeof d === 'string' && SKIP_DATE_RE.test(d));
}

export async function PATCH(req: NextRequest) {
  const auth = await isAdminAuthedWithMember(req);
  if (!auth.authed) return unauthorized();

  let body: { skipDates?: unknown; eTransferRecipient?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }

  if (body.skipDates !== undefined && !isValidSkipDates(body.skipDates)) {
    return NextResponse.json({ error: 'Invalid skipDates' }, { status: 400 });
  }
  if (body.eTransferRecipient !== undefined && !isValidETransferRecipient(body.eTransferRecipient)) {
    return NextResponse.json({ error: 'Invalid eTransferRecipient' }, { status: 400 });
  }

  try {
    const container = getContainer('members');
    const { resource: existing } = await container.item(auth.memberId, auth.memberId).read();
    if (!existing) {
      return NextResponse.json({ error: 'Member not found' }, { status: 404 });
    }

    const updated = {
      ...existing,
      ...(body.skipDates !== undefined ? { skipDates: body.skipDates } : {}),
      ...(body.eTransferRecipient !== undefined ? { eTransferRecipient: body.eTransferRecipient } : {}),
    };
    const { resource } = await container.items.upsert(updated);
    const safe = resource as Record<string, unknown>;
    const { pinHash: _ph, ...exposed } = safe;
    return NextResponse.json(exposed);
  } catch (error) {
    console.error('PATCH /api/admin/settings error:', error);
    return NextResponse.json({ error: 'Failed to update settings' }, { status: 500 });
  }
}
