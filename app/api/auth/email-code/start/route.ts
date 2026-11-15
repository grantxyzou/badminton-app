/**
 * POST /api/auth/email-code/start — email a 6-digit sign-in code
 * (docs/plans/one-way-in.md, step 3; `lib/emailCode.ts`).
 *
 * ALWAYS ONE ANSWER. Whether or not the address belongs to an account, the
 * body is the same 200, as `forgot-password` does: a different status, body
 * or delay for an unknown address would map emails to accounts, and member
 * names are already enumerable.
 *
 * So the mail is NOT awaited. Sending through Gmail takes about a second, and
 * waiting for it only when the address is real would put the answer in the
 * response time. The write that stores the code is awaited (a code the server
 * has not stored must not be mailed); the send is fire-and-forget with its
 * failure logged.
 *
 * Rate limits before the body (rule 4): per address-of-caller first, then per
 * email once it is known. Both answer the same 429 for every address, so the
 * limit says nothing about accounts, and the per-email one stops this being a
 * mail cannon pointed at someone's inbox.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getContainer } from '@/lib/cosmos';
import { checkRateLimit, getClientIp } from '@/lib/rateLimit';
import { normalizeEmail, lookupIdentity, isPlausibleEmail, MAX_EMAIL_LENGTH } from '@/lib/authIdentity';
import { issueEmailCode, storeSignupCode } from '@/lib/emailCode';
import { resolveClaimLink } from '@/lib/claimLinks';
import { isFlagOn } from '@/lib/flags';
import { sendSignInCodeEmail } from '@/lib/authEmail';
import type { Member } from '@/lib/types';

export const dynamic = 'force-dynamic';

const HOUR = 60 * 60 * 1000;

/** The single answer this endpoint gives to a well-formed request. */
const OK = () => NextResponse.json({ ok: true });

export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  if (!checkRateLimit(`auth-code-start:ip:${ip}`, 10, HOUR)) {
    return NextResponse.json({ error: 'rate_limited', retryAfter: 3600 }, { status: 429 });
  }

  let body: { email?: unknown; doorToken?: unknown };
  try {
    body = await req.json();
  } catch {
    return OK();
  }
  const email =
    typeof body.email === 'string' && body.email.length <= MAX_EMAIL_LENGTH ? normalizeEmail(body.email) : '';
  if (!email || !isPlausibleEmail(email)) return OK();

  // Three codes per address per 15 minutes, whoever asks.
  if (!checkRateLimit(`auth-code-start:${email}`, 3, 15 * 60 * 1000)) {
    return NextResponse.json({ error: 'rate_limited', retryAfter: 900 }, { status: 429 });
  }

  try {
    const identity = await lookupIdentity('email', email);
    if (!identity) {
      // No account at this address. Through a club's LINK (docs/plans/
      // one-way-in.md, step 4) that is a new person: mail a code that will
      // let them make one. Without a link, nothing: an account needs a key
      // (rule 13). Same answer either way.
      const door =
        isFlagOn('NEXT_PUBLIC_FLAG_MULTI_GROUP') && body.doorToken !== undefined
          ? await resolveClaimLink(body.doorToken)
          : null;
      if (!door) return OK();
      const { code, stored } = await issueEmailCode();
      await storeSignupCode(email, stored, door);
      void sendSignInCodeEmail(email, 'there', code).catch((err) => {
        console.error('[email-code] sign-up code mail failed:', err);
      });
      return OK();
    }

    const container = getContainer('members');
    const { resource: member } = await container.item(identity.memberId, identity.memberId).read<Member & { _etag?: string }>();
    if (!member || member.active !== true) return OK();

    const { code, stored } = await issueEmailCode();
    // A new code replaces any earlier one, and its try count starts again.
    const next = { ...member, emailCode: stored };
    if (typeof member._etag === 'string') {
      const written = await container
        .item(member.id, member.id)
        .replace(next, { accessCondition: { type: 'IfMatch', condition: member._etag } })
        .catch((err: { code?: number }) => {
          if (err?.code === 412) return null; // changed under us: send nothing, same answer
          throw err;
        });
      if (!written) return OK();
    } else {
      await container.items.upsert(next);
    }

    void sendSignInCodeEmail(email, member.name, code).catch((err) => {
      console.error('[email-code] sign-in code mail failed:', err);
    });
    return OK();
  } catch (err) {
    // An internal failure answers the same way: the alternative is an error
    // path that only real addresses can reach.
    console.error('POST /api/auth/email-code/start unhandled:', err);
    return OK();
  }
}
