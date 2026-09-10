/**
 * Deployment-wide defaults that a GROUP's own settings supersede.
 *
 * `NEXT_PUBLIC_MAX_PLAYERS` is read here and nowhere else. It used to be
 * parsed inline in five places (the dev-seed session, both capacity checks in
 * the players route, HomeTab, and the first cut of `lib/groups.ts`), and the
 * moment a group-level default became authoritative was the moment five
 * copies became a bug waiting to happen. The literal `process.env.NEXT_PUBLIC_…`
 * access is what lets Next inline it for the client bundle (HomeTab imports
 * this), the same rule `lib/flags.ts` follows.
 */
export function defaultMaxPlayers(): number {
  return parseInt(process.env.NEXT_PUBLIC_MAX_PLAYERS ?? '12', 10) || 12;
}
