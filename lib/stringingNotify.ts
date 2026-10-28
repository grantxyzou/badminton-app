/**
 * What a player is TOLD about their stringing job, on any channel.
 *
 * Pure — builds the message, sends nothing. The adapters (in-app, email, push)
 * each take a `PlayerNotice` and render it; none of them composes its own copy.
 *
 * WHY THIS EXISTS AS A SEAM AND NOT AS THREE SEND FUNCTIONS
 * --------------------------------------------------------
 * A notification is the same job description leaving the server by a
 * different door, and the door where a rule is most likely to be forgotten,
 * because the copy gets written by hand at the call site rather than derived
 * from a type. So every channel's copy starts here.
 *
 * The price is EXACT since 2026-10-28 (docs/plans/stringing-canvas-redesign.md
 * — it was a $4 band, "$28–32", until Grant: "dont hide"), and it is for the
 * email only. The push builders never read `quote`: a banner renders on a
 * locked phone, in front of whoever is standing there.
 *
 * The other rule carries over too: the bench's status words never appear.
 * Copy is chosen by `PlayerStage`, so a new bench status cannot leak into an
 * email by default any more than it can into the API.
 */
import { playerStageFor } from './stringing';
import { fmtMoney } from './fmt';
import type { PlayerStage } from './stringing';
import type { StringingJob } from './types';

export type NotifyChannel = 'in_app' | 'email' | 'push';

export interface PlayerNotice {
  /** i18n key suffix under `stringing.notice`. Never raw English prose — an
   *  adapter that shipped a literal string would be untranslatable in zh-CN. */
  key: PlayerStage;
  jobNo: string;
  racketLabel: string;
  /** "$30", exact, or null when the job has not been priced. For the EMAIL
   *  only: a push carries no money, because it renders on a locked phone. */
  quote: string | null;
  readyBy: string | null;
  /** Which stages are worth interrupting someone for — see `shouldNotify`. */
  channels: NotifyChannel[];
}

/**
 * Stages that justify a push or an email.
 *
 * `with_stringer` is deliberately absent. The player just handed the racket
 * over in person; telling them so is a notification about something they
 * already know, and the fastest way to teach someone to ignore this app's
 * notifications is to send one that carries nothing.
 *
 * `done` is absent for the same reason — they are holding the racket.
 *
 * In-app is different and always on: the status screen showing the current
 * stage costs the player nothing and interrupts nobody. Interrupting is what
 * needs justifying, not displaying.
 */
const INTERRUPTING_STAGES: readonly PlayerStage[] = ['being_strung', 'ready_for_you'] as const;

export function shouldNotify(stage: PlayerStage): boolean {
  return INTERRUPTING_STAGES.includes(stage);
}

export function channelsFor(stage: PlayerStage): NotifyChannel[] {
  // In-app always; the interrupting channels only when there is news.
  return shouldNotify(stage) ? ['in_app', 'email', 'push'] : ['in_app'];
}

/**
 * The single constructor for anything a player is told about a job.
 *
 * Takes the whole job, so every adapter formats the price the same way.
 */
export function buildPlayerNotice(job: StringingJob): PlayerNotice {
  const stage = playerStageFor(job.status);
  return {
    key: stage,
    jobNo: job.jobNo,
    racketLabel: job.racketLabel,
    quote: typeof job.priceCents === 'number' ? fmtMoney(job.priceCents / 100) : null,
    readyBy: job.readyBy,
    channels: channelsFor(stage),
  };
}
