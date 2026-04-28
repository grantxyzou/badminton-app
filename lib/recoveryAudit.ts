import type { RecoveryEvent } from './types';

const MAX_EVENTS = 200;

/**
 * Returns a new array with the event appended. Old entries are dropped first
 * if the cap is exceeded, so the array stays bounded at MAX_EVENTS.
 */
export function appendEvent(
  existing: RecoveryEvent[] | undefined,
  event: RecoveryEvent,
): RecoveryEvent[] {
  const list = existing ?? [];
  const next = [...list, event];
  if (next.length <= MAX_EVENTS) return next;
  return next.slice(next.length - MAX_EVENTS);
}
