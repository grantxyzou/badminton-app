/**
 * The one place a `PlayerNotice` is actually SENT.
 *
 * `lib/stringingNotify.ts` builds the message; `lib/stringingNotifyEmail.ts` and
 * `buildStringingPayload` in `lib/pushMessages.ts` render the two delivered
 * channels; this joins them to the database and to the caller.
 *
 * THE TWO CHANNELS ARE INDEPENDENT. Email is a bonus for accounts that have an
 * address; push is the one that reaches a PIN-only member, which is most of
 * them. Neither is allowed to gate the other — see the note above the push call
 * for the bug that shape prevents.
 *
 * THE CONTRACT WITH THE CALLER: this never throws and never rejects. It is
 * invoked from the admin's PATCH on the bench, and a mail failure must not turn
 * moving a racket along into a 503. Every path returns a summary instead.
 *
 * IN-APP IS NOT SENT FROM HERE. It needs no delivery: the player's own
 * `GET /api/stringing/jobs?view=player` already carries the stage, and
 * `StringingCard` renders it. The "adapter" for that channel is the card
 * announcing itself when the stage is worth announcing — which is a rendering
 * decision in the player's browser, in the player's own locale, not a message
 * pushed from the stringer's request. Listing `in_app` in `channels` is still
 * meaningful: it documents that the stage IS shown, which is why quiet stages
 * carry that channel and only that one.
 */
import { getContainer } from '@/lib/cosmos';
import { buildPlayerNotice, shouldNotify, type PlayerNotice } from '@/lib/stringingNotify';
import { sendStringingNotice } from '@/lib/stringingNotifyEmail';
import { sendPushToMembers } from '@/lib/push';
import { buildStringingPayload } from '@/lib/pushMessages';
import { isFlagOn } from '@/lib/flags';
import type { StringingJob, Member } from '@/lib/types';

export interface NotifyOutcome {
  /** Did this stage justify interrupting anyone at all? */
  attempted: boolean;
  emailSent: boolean;
  /** Devices reached. 0 is the normal case, not a failure — nobody is obliged
   *  to have granted notification permission on any device. */
  pushSent: number;
  /** Why no EMAIL was sent, for the log. Never surfaced to a user, and
   *  deliberately about the email arm only: push has no single reason worth
   *  recording, because reaching zero devices is an ordinary outcome. */
  reason?: 'quiet_stage' | 'no_member' | 'no_email' | 'send_failed';
}

/**
 * The push arm. Separate function, and incapable of throwing, because it sits
 * upstream of the email arm and must not be able to cost it.
 */
async function pushToPlayer(notice: PlayerNotice, memberId: string): Promise<number> {
  if (!isFlagOn('NEXT_PUBLIC_FLAG_PUSH_NOTIFY')) return 0;
  const payload = buildStringingPayload(notice);
  if (!payload) return 0;
  try {
    // To this member's devices ONLY. A broadcast here would tell the whole club
    // about one person's racket.
    const { sent } = await sendPushToMembers([memberId], payload);
    return sent;
  } catch (err) {
    console.error('[stringing] push failed (the bench is unaffected):', err);
    return 0;
  }
}

export async function notifyPlayerOfStage(job: StringingJob): Promise<NotifyOutcome> {
  try {
    const notice = buildPlayerNotice(job);

    // `with_stringer` and `done` stop here: the player is standing in front of
    // the stringer, or holding the racket. See INTERRUPTING_STAGES.
    if (!shouldNotify(notice.key)) {
      return { attempted: false, emailSent: false, pushSent: 0, reason: 'quiet_stage' };
    }

    const { resource: member } = await getContainer('members')
      .item(job.memberId, job.memberId)
      .read<Member>();
    if (!member) {
      return { attempted: true, emailSent: false, pushSent: 0, reason: 'no_member' };
    }

    /* PUSH FIRST, AND ABOVE THE EMAIL GATE.
       This used to return early on `no_email`, and nearly every member is
       PIN-only — `Member.email` is populated only by the email/password and
       Google paths. Wiring push in below that gate would have shipped a
       channel that reached almost nobody while every test stayed green. Push
       is the channel that works for a member with no address, which is most
       of them, so it must not sit behind one. */
    const pushSent = await pushToPlayer(notice, job.memberId);

    /* No address is expected, not an error: in-app reaches everyone, push
       reaches whoever opted in, and email is the bonus for accounts that have
       one. */
    if (!member.email) {
      return { attempted: true, emailSent: false, pushSent, reason: 'no_email' };
    }

    const { sent } = await sendStringingNotice(notice, member.email, member.name);
    return sent
      ? { attempted: true, emailSent: true, pushSent }
      : { attempted: true, emailSent: false, pushSent, reason: 'send_failed' };
  } catch (err) {
    // Deliberately swallowed. The bench keeps working.
    console.error('stringing notify dispatch failed:', err);
    return { attempted: true, emailSent: false, pushSent: 0, reason: 'send_failed' };
  }
}
