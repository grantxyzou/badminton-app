/**
 * The one place a `PlayerNotice` is actually SENT.
 *
 * `lib/stringingNotify.ts` builds the message and `lib/stringingNotifyEmail.ts`
 * renders one channel; this joins them to the database and to the caller. Until
 * now nothing called either of them, so the notification seam had adapters on
 * neither side and no player was ever told their racket was ready.
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
import { buildPlayerNotice, shouldNotify } from '@/lib/stringingNotify';
import { sendStringingNotice } from '@/lib/stringingNotifyEmail';
import type { StringingJob, Member } from '@/lib/types';

export interface NotifyOutcome {
  /** Did this stage justify interrupting anyone at all? */
  attempted: boolean;
  emailSent: boolean;
  /** Why nothing was sent, for the log. Never surfaced to a user. */
  reason?: 'quiet_stage' | 'no_member' | 'no_email' | 'send_failed';
}

export async function notifyPlayerOfStage(job: StringingJob): Promise<NotifyOutcome> {
  try {
    const notice = buildPlayerNotice(job);

    // `with_stringer` and `done` stop here: the player is standing in front of
    // the stringer, or holding the racket. See INTERRUPTING_STAGES.
    if (!shouldNotify(notice.key)) {
      return { attempted: false, emailSent: false, reason: 'quiet_stage' };
    }

    const { resource: member } = await getContainer('members')
      .item(job.memberId, job.memberId)
      .read<Member>();
    if (!member) {
      return { attempted: true, emailSent: false, reason: 'no_member' };
    }

    /* Most members are PIN-only and have no address — `Member.email` is only
       populated by the email/password and Google paths. That is expected, not
       an error: the in-app stage is the channel that reaches everyone, and
       email is the bonus for accounts that have one. */
    if (!member.email) {
      return { attempted: true, emailSent: false, reason: 'no_email' };
    }

    const { sent } = await sendStringingNotice(notice, member.email, member.name);
    return sent
      ? { attempted: true, emailSent: true }
      : { attempted: true, emailSent: false, reason: 'send_failed' };
  } catch (err) {
    // Deliberately swallowed. The bench keeps working.
    console.error('stringing notify dispatch failed:', err);
    return { attempted: true, emailSent: false, reason: 'send_failed' };
  }
}
