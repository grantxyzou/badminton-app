/**
 * What a new club name has to carry with it (docs/plans/profile-nickname.md).
 *
 * A roster name is what the club calls someone, and a few rows hold it as
 * TEXT rather than by id. When the name changes, two of them would go wrong:
 *
 * - **This week's sign-up rows.** Home finds "am I signed up?" by comparing a
 *   row's name with the member's, so a member who renamed after signing up
 *   would read as not signed up and could not cancel. Their OWN rows in the
 *   active session (matched by `memberId`, never by name) take the new name.
 *   A guest row keeps the name it was given (`Jenny (Josh)`): nothing finds a
 *   guest by name, and it leaves with the session.
 * - **E-transfer aliases.** An alias maps a bank's legal name to the app name
 *   (`appName`), and the inbox matches on that text. An alias pointing at the
 *   old name would stop matching their payments. Aliases carrying their
 *   `memberId`, or naming the old name exactly, move to the new one.
 *
 * History (past sessions, game results, kudos notes) keeps the name it was
 * written under, as a receipt does. Best-effort after the rename itself, and
 * never throws: the rename has happened, and a row left behind is a smaller
 * harm than refusing it.
 */
import { getActiveSessionId } from '@/lib/cosmos';
import { groupScope } from '@/lib/groupScope';
import { readAliases, updateAlias } from '@/lib/aliases';
import type { Player } from '@/lib/types';

export async function carryRosterRename(
  groupId: string,
  memberId: string,
  oldName: string,
  newName: string,
): Promise<void> {
  const from = oldName.trim();
  const to = newName.trim();
  if (!to || from === to) return;
  const scope = groupScope(groupId);

  try {
    const sessionId = await getActiveSessionId(groupId);
    if (sessionId) {
      const rows = await scope.query<Player>('players', {
        where: 'c.sessionId = @sessionId AND c.memberId = @memberId',
        params: [
          { name: '@sessionId', value: sessionId },
          { name: '@memberId', value: memberId },
        ],
        partitionKey: sessionId,
      });
      // Re-checked in JS: the mock store reads parameters by name, and a guest
      // row (no memberId) must never be renamed after its host.
      const mine = rows.filter((r) => r.memberId === memberId && r.sessionId === sessionId && !r.guestOf);
      await Promise.all(mine.map((r) => scope.replace('players', { ...r, name: to }, sessionId)));
    }
  } catch (err) {
    console.error('[roster-rename] sign-up rows not renamed:', err);
  }

  try {
    const lowerFrom = from.toLowerCase();
    const aliases = await readAliases(scope);
    const theirs = aliases.filter(
      (a) => a.memberId === memberId || (!a.memberId && a.appName.trim().toLowerCase() === lowerFrom),
    );
    await Promise.all(theirs.map((a) => updateAlias(scope, { ...a, appName: to, memberId })));
  } catch (err) {
    console.error('[roster-rename] aliases not renamed:', err);
  }
}
