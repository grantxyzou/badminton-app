/**
 * What a player is TOLD about their stringing job, on any channel.
 *
 * Pure — builds the message, sends nothing. The adapters (in-app, email, push)
 * each take a `PlayerNotice` and render it; none of them composes its own copy.
 *
 * WHY THIS EXISTS AS A SEAM AND NOT AS THREE SEND FUNCTIONS
 * --------------------------------------------------------
 * The route's `toPlayerJob` carefully strips the stringer's exact price and
 * replaces it with a band. A notification is the same job description leaving
 * the server by a different door — and it is the door where the strip is most
 * likely to be forgotten, because the copy gets written by hand at the call
 * site rather than derived from a type.
 *
 * "Grant quoted you $30.00" in an email would defeat the entire price rule
 * while every API test stayed green, because no test looks at an email body.
 * So the price NEVER reaches this module in exact form: `buildPlayerNotice`
 * takes a job and does its own banding, and there is no parameter through
 * which a caller could pass the real figure.
 *
 * The other rule carries over too: the bench's status words never appear.
 * Copy is chosen by `PlayerStage`, so a new bench status cannot leak into an
 * email by default any more than it can into the API.
 */
import { playerStageFor, priceBand, formatPriceBand } from './stringing';
import type { PlayerStage } from './stringing';
import type { StringingJob } from './types';

export type NotifyChannel = 'in_app' | 'email' | 'push';

export interface PlayerNotice {
  /** i18n key suffix under `stringing.notice`. Never raw English prose — an
   *  adapter that shipped a literal string would be untranslatable in zh-CN. */
  key: PlayerStage;
  jobNo: string;
  racketLabel: string;
  /** "$28–32", or null when the job has not been priced. Never exact. */
  priceRange: string | null;
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
 * Takes the whole job rather than a price, on purpose: there is no parameter
 * here through which an exact figure could be passed, so an adapter cannot
 * accidentally be handed one.
 */
export function buildPlayerNotice(job: StringingJob): PlayerNotice {
  const stage = playerStageFor(job.status);
  return {
    key: stage,
    jobNo: job.jobNo,
    racketLabel: job.racketLabel,
    priceRange: formatPriceBand(priceBand(job.priceCents)),
    readyBy: job.readyBy,
    channels: channelsFor(stage),
  };
}
