import { NextRequest, NextResponse } from 'next/server';
import { getActiveSessionId } from '@/lib/cosmos';
import { groupScope } from '@/lib/groupScope';
import { resolveGroupId, noActiveSession } from '@/lib/groupContext';
import { readActiveAnnouncements } from '@/lib/announcements';
import { isAdminAuthedWithMember, unauthorized } from '@/lib/auth';
import { sendPushToAll } from '@/lib/push';
import { buildAnnouncementPayload } from '@/lib/pushMessages';
import { randomBytes } from 'crypto';

export async function GET(req: NextRequest) {
  // Delegates to the shared lib so the server-rendered home page
  // (`app/page.tsx`) and this REST endpoint stay in lockstep.
  const resources = await readActiveAnnouncements(resolveGroupId(req));
  return NextResponse.json(resources);
}

export async function DELETE(req: NextRequest) {
  if (!(await isAdminAuthedWithMember(req)).authed) return unauthorized();

  try {
    const scope = groupScope(resolveGroupId(req));
    const sessionId = await getActiveSessionId(scope.groupId);
    if (!sessionId) return noActiveSession();
    const { id } = await req.json();
    if (!id || typeof id !== 'string') {
      return NextResponse.json({ error: 'ID required' }, { status: 400 });
    }

    // remove() read-verifies the doc belongs to this group's session first.
    const removed = await scope.remove('announcements', id, sessionId);
    if (!removed) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('DELETE announcement error:', error);
    return NextResponse.json({ error: 'Failed to delete' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  if (!(await isAdminAuthedWithMember(req)).authed) return unauthorized();

  try {
    const scope = groupScope(resolveGroupId(req));
    const sessionId = await getActiveSessionId(scope.groupId);
    if (!sessionId) return noActiveSession();
    const { id, text } = await req.json();
    if (!id || typeof id !== 'string') {
      return NextResponse.json({ error: 'ID required' }, { status: 400 });
    }
    const trimmed = typeof text === 'string' ? text.trim() : '';
    if (!trimmed) {
      return NextResponse.json({ error: 'Text required' }, { status: 400 });
    }
    if (trimmed.length > 800) {
      return NextResponse.json({ error: 'Announcement too long (max 800 chars)' }, { status: 400 });
    }

    const existing = await scope.read('announcements', id, sessionId);
    if (!existing) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const updated = await scope.upsert('announcements', {
      ...existing,
      text: trimmed,
      editedAt: new Date().toISOString(),
    });
    return NextResponse.json(updated);
  } catch (error) {
    console.error('PATCH announcement error:', error);
    return NextResponse.json({ error: 'Failed to update' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  if (!(await isAdminAuthedWithMember(req)).authed) return unauthorized();

  try {
    const scope = groupScope(resolveGroupId(req));
    const sessionId = await getActiveSessionId(scope.groupId);
    if (!sessionId) return noActiveSession();
    const { text } = await req.json();
    const trimmed = typeof text === 'string' ? text.trim() : '';
    if (!trimmed) {
      return NextResponse.json({ error: 'Text required' }, { status: 400 });
    }
    if (trimmed.length > 800) {
      return NextResponse.json({ error: 'Announcement too long (max 800 chars)' }, { status: 400 });
    }

    const announcement = {
      id: randomBytes(12).toString('hex'),
      text: trimmed,
      time: new Date().toISOString(),
      sessionId,
    };

    const resource = await scope.create('announcements', announcement);

    /* Persist first, notify best-effort — a push failure must never fail the
       admin's post (same posture as the signup-open trigger in
       app/api/session/route.ts and app/api/report/route.ts).

       CREATE only. PATCH upserts an edit, and re-notifying everyone because a
       typo was fixed is exactly the empty interruption that teaches people to
       swipe these away. */
    try {
      await sendPushToAll(buildAnnouncementPayload(announcement));
    } catch (err) {
      console.error('[announcements] push failed (announcement still saved):', err);
    }

    return NextResponse.json(resource, { status: 201 });
  } catch (error) {
    console.error('POST announcement error:', error);
    return NextResponse.json({ error: 'Failed to post' }, { status: 500 });
  }
}
