import type { StateTone } from '@/components/primitives/StatusBadge';
import type { StringingStatus } from '@/lib/stringing';

/**
 * Each job status in one of the canonical pill tones (`StatusBadge
 * variant="state"`), for every row that shows a job's status: the admin bench
 * and a stringer's own queue. One table, so the two rows cannot disagree about
 * what colour "Received" is.
 */
export const STATUS_TONE: Record<StringingStatus, StateTone> = {
  requested: 'unpaid',
  received: 'waitlist',
  strung: 'waitlist',
  ready: 'paid',
  picked_up: 'unpaid',
};
