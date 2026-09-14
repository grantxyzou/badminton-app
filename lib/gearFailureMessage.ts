import type { GearFailure } from '@/components/stats/useGear';

/**
 * One place a `GearFailure` becomes words, so every surface that writes gear
 * — the kit card, the Set-up card, their sheets — describes the same refusal
 * the same way. `t` is the `valueHub` namespace, where the bag copy lives.
 */
export function gearFailureMessage(reason: GearFailure, t: (key: string) => string): string {
  if (reason === 'bag_full') return t('bagFull');
  if (reason === 'duplicate_racket') return t('bagDuplicate');
  if (reason === 'unauthorized') return t('bagSignInAgain');
  if (reason === 'member_not_found') return t('bagMemberMissing');
  if (reason === 'tension_not_saved') return t('bagTensionNotSaved');
  if (reason === 'rate_limited') return t('bagRateLimited');
  return t('recError');
}
