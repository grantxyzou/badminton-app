import { STRINGING_FLOW, type StringingStatus } from '@/lib/stringing';

/**
 * What a stringing job's status LOOKS like — its icon and its colour — defined
 * once, for the stringer's "Rackets to string" list and the admin job page's
 * Progress stepper (Stringing canvas, 2026-11-12; Grant: "I am having trouble
 * telling the status apart", and on the job page "colour should match the
 * updated status colour").
 *
 * Before this the list drew every status as one of the four `.pill-*` tones,
 * so Received and Strung were the same orange and Requested and Picked up the
 * same grey, while the job page coloured every finished step accent green
 * whatever the job's stage. One hue per stage now, and both screens read it
 * from here, so they cannot disagree about what colour "Received" is.
 *
 *   not dropped off (requested)  grey    schedule
 *   received                     amber   inventory_2
 *   strung                       blue    check  (the canvas drew `done`; it is
 *                                        the same glyph, and `check` is already
 *                                        in the self-hosted icon subset)
 *   ready for pickup             green   check_circle
 *   waiting on the player        purple  hourglass_top
 *   picked up                    muted   check_circle
 *
 * Every colour is an existing theme-aware token (each has a light-mode value
 * in `globals.css`), so no hue here needs a raw hex: amber is
 * `--sev-high-text` (the canvas's #fdba74), blue `--sev-low-text` (#93c5fd),
 * green `--pill-paid-text`, purple `--pill-admin-text` (#c4b5fd). The pill's
 * fill is the same hue mixed toward transparent, so a tone is one value.
 *
 * "Waiting on the player" is not a `StringingStatus` — the racket is still
 * wherever it is (usually Received) while a proposed change (`pendingEdit`)
 * waits for the player's yes. It wins the pill and the bar's colour because it
 * is what decides the stringer's next move (none, until they answer); the bar
 * still fills to where the racket actually is.
 */
export type ToneStage = StringingStatus | 'waiting';

export interface StageLook {
  /** A Material Symbols name, in `lib/iconNames.ts`. */
  icon: string;
  /** The stage's colour: text, icon, the bar's filled segments, the stepper's line. */
  tone: string;
  /** A pill's fill: the same hue, washed out. */
  tint: string;
}

const tintOf = (tone: string, pct: number) => `color-mix(in srgb, ${tone} ${pct}%, transparent)`;

function look(icon: string, tone: string, pct = 22): StageLook {
  return { icon, tone, tint: tintOf(tone, pct) };
}

export const STAGE_LOOK: Record<ToneStage, StageLook> = {
  requested: look('schedule', 'var(--text-secondary)', 12),
  received: look('inventory_2', 'var(--sev-high-text)'),
  strung: look('check', 'var(--sev-low-text)'),
  ready: look('check_circle', 'var(--pill-paid-text)'),
  picked_up: look('check_circle', 'var(--text-muted)', 12),
  waiting: look('hourglass_top', 'var(--pill-admin-text)'),
};

/** An unfilled bar segment or stepper line: a quiet track in either theme. */
export const STAGE_TRACK = tintOf('var(--text-primary)', 12);

/** Anything with a `status`, and, when the projection carries one, a pending change. */
export interface ToneStageInput {
  status: StringingStatus;
  pendingEdit?: unknown;
}

/** The stage a job is SHOWN as: a pending change outranks the status. */
export function toneStageOf(job: ToneStageInput): ToneStage {
  if (job.pendingEdit) return 'waiting';
  return job.status;
}

/** The look of a stage, falling back to Requested for an unknown status
 *  (a row written by newer code read by older, after a rollback). */
export function stageLook(stage: ToneStage): StageLook {
  return STAGE_LOOK[stage] ?? STAGE_LOOK.requested;
}

/** The four segments of the list's progress bar. Requested is not one: a
 *  racket still in the player's bag has made no progress on the bench. */
export const PROGRESS_STEPS: readonly StringingStatus[] = STRINGING_FLOW.filter((s) => s !== 'requested');

/** How many of `PROGRESS_STEPS` a job at `status` has reached (0 for Requested). */
export function progressFilled(status: StringingStatus): number {
  return Math.max(0, STRINGING_FLOW.indexOf(status));
}
