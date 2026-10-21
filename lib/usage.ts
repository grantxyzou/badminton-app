import { writeEvent, type SignInVia } from './events';

/**
 * The server side of the usage records (docs/plans/usage-metrics.md).
 *
 * Always on since NEXT_PUBLIC_FLAG_USAGE_METRICS retired (2026-10-21), and
 * NEVER load-bearing: a sign-in must not fail because its record could not be
 * written, so this resolves on every path and only logs.
 */

export async function recordSignIn(
  member: { id: string; name: string },
  groupId: string,
  via: SignInVia,
): Promise<void> {
  try {
    await writeEvent({ memberId: member.id, name: member.name, kind: 'sign_in', via }, groupId);
  } catch (err) {
    console.warn('[usage] sign_in not recorded (not load-bearing):', err);
  }
}
