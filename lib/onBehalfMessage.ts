/**
 * What an admin screen says when the server refuses to open someone else's
 * account for them (`lib/onBehalfGuard.ts`): a PIN set or cleared, a recovery
 * code, a "let me in" approved. Admin surfaces are English-only by decision
 * (.claude/rules/i18n.md). `null` for any other answer, so a caller keeps its
 * own wording for those.
 */
export function onBehalfMessage(code: unknown): string | null {
  if (code === 'organiser_only') {
    return 'Only an organiser can do this for an admin or organiser.';
  }
  if (code === 'other_club') {
    return 'They’re in another club too, so they need to get back in themselves: with an email code, Apple or Google.';
  }
  return null;
}
