/**
 * Anthropic model IDs — single source of truth.
 *
 * There are exactly two places in this app that call a model, and until now each
 * pinned its own ID in its own way: `app/api/claude/route.ts` inline at the call
 * site, `app/api/stats/insight/route.ts` in a module-local `MODEL` const. Nothing
 * connected them, so a retirement meant knowing to look in two files — and a
 * retirement is the failure mode that has actually happened here: a dead ID sat in
 * production for weeks, 404ing on every call, while the flat error message of the
 * day hid the reason (see `lib/aiError.ts`).
 *
 * `__tests__/ai-model-canary.test.ts` is a DENYLIST of IDs already known dead. It
 * cannot warn about the next retirement, only refuse a repeat of the last one. This
 * module is the other half: it makes "migrate off a retired model" a one-file edit,
 * so the denylist entry and the migration land in the same small change.
 * `__tests__/ai-model-owner-canary.test.ts` keeps it that way.
 *
 * Named by ROLE, not by version, so a call site reads as intent and a migration
 * doesn't require re-reading the call sites to work out which model belonged where.
 */

/**
 * Free-form prose for an admin to read and edit — announcement polish, release-note
 * drafting. Output goes through a human before any player sees it.
 */
export const PROSE_MODEL = 'claude-sonnet-5';

/**
 * The player-facing Stats insight. Sonnet rather than Haiku deliberately: the
 * per-member-per-session cache makes volume trivial, so the per-call budget buys
 * better judgment on what is worth saying. Rationale in the route's own docstring.
 */
export const INSIGHT_MODEL = 'claude-sonnet-4-6';
