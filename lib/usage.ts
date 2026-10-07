import { isFlagOn } from './flags';
import { writeEvent, type SignInVia } from './events';

/**
 * The server side of the usage records (docs/plans/usage-metrics.md).
 *
 * Off by flag until the store privacy labels say "Product Interaction", and
 * NEVER load-bearing: a sign-in must not fail because its record could not be
 * written, so this resolves on every path and only logs.
 */
export function usageOn(): boolean {
  return isFlagOn('NEXT_PUBLIC_FLAG_USAGE_METRICS');
}

export async function recordSignIn(
  member: { id: string; name: string },
  groupId: string,
  via: SignInVia,
): Promise<void> {
  if (!usageOn()) return;
  try {
    await writeEvent({ memberId: member.id, name: member.name, kind: 'sign_in', via }, groupId);
  } catch (err) {
    console.warn('[usage] sign_in not recorded (not load-bearing):', err);
  }
}
