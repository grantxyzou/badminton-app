/**
 * POST /api/help/feedback — "Was this helpful?" under a guide
 * (docs/superpowers/specs/2026-11-09-profile-reorg-design.md §8).
 *
 * A PLAIN FORM POST, not a fetch: the guides are `/legal` pages, which render
 * from HTML alone (no script, no client state), so the two buttons submit a
 * form and this answers with a 303 back to the guide with `?helpful=`, where
 * the thanks replaces the question.
 *
 * One `guide_feedback` event (the guide's slug and the answer, nothing else),
 * only for a signed-in member: `events` is partitioned by member and a
 * stranger has none. A signed-out reader is thanked all the same — the answer
 * is a courtesy to us, not something they are owed a record of.
 */
import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit, getClientIp } from '@/lib/rateLimit';
import { verifyLiveMemberAuth } from '@/lib/auth';
import { resolveGroupId } from '@/lib/groupContext';
import { writeEvent } from '@/lib/events';
import { guideBySlug, isGuideAnswer } from '@/lib/helpGuides';
import { skipsUsageRecord } from '@/lib/operator';

export const dynamic = 'force-dynamic';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

const back = (req: NextRequest, path: string) => NextResponse.redirect(new URL(`${BASE}${path}`, req.url), 303);

export async function POST(req: NextRequest) {
  // Rate limit first (security rule 4); a refusal still lands on a page.
  if (!checkRateLimit(`help-feedback:${getClientIp(req)}`, 20, 60 * 60_000)) return back(req, '/legal/help');

  let guideSlug = '';
  let answer: unknown = null;
  try {
    const form = await req.formData();
    guideSlug = String(form.get('guide') ?? '');
    answer = form.get('answer');
  } catch {
    return back(req, '/legal/help');
  }
  const guide = guideBySlug(guideSlug);
  if (!guide || !isGuideAnswer(answer)) return back(req, '/legal/help');

  const member = await verifyLiveMemberAuth(req);
  if (member && !skipsUsageRecord(member.memberId)) {
    try {
      await writeEvent(
        { memberId: member.memberId, name: member.name, kind: 'guide_feedback', guide: guide.slug, answer },
        resolveGroupId(req),
      );
    } catch (err) {
      // Best-effort: the reader is thanked either way.
      console.warn('POST /api/help/feedback: event not written', err);
    }
  }
  // `#helpful`: back to where they answered, not the top of the guide.
  return back(req, `/legal/help/${guide.slug}?helpful=${answer}#helpful`);
}
