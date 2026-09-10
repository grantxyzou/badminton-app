/**
 * THE CONTAINER REGISTRY — the one place that says, per Cosmos container,
 * what its partition key is, whose data it holds, and whether it already
 * exists in production.
 *
 * Why one place: the partition-key mapping used to live in four by hand —
 * `lib/memberPurge.ts`'s `pk` column, the provisioning canary's list,
 * CLAUDE.md's bullet, and every caller of `container.item(id, pk)`. The mock
 * store IGNORES the pk argument, so a caller passing the wrong one passes CI
 * and silently 404s in production (the `item()` hazard in CLAUDE.md). With the
 * key recorded here, the group accessor (`lib/groupScope.ts`) derives it from
 * the container name and a caller cannot get it wrong.
 *
 * `__tests__/containers-registry.test.ts` fails the build when a container the
 * source touches is missing here, or when `memberPurge` / `groupScope` disagree
 * with this list. `__tests__/docs-canary.test.ts` separately holds CLAUDE.md's
 * bullet to the same set.
 *
 * SIX KEYS ARE INFERRED, NOT DECLARED: `sessions`, `players`, `announcements`,
 * `members`, `aliases`, `birds` predate `ensureContainer` and were created by
 * hand in the Azure portal. The values match every `.item(id, pk)` call site,
 * which is consistent with them but not proof; ground truth is the portal.
 */

/** Whose data a container holds — see `lib/groupScope.ts` for the rules. */
export type ContainerScope = 'group' | 'person' | 'global';

export interface ContainerMeta {
  /** Partition key PATH, as declared to `ensureContainer` (or inferred — see above). */
  readonly pk: `/${string}`;
  readonly scope: ContainerScope;
  /** Why it has that scope. The reason is what tells a considered decision from a guess. */
  readonly reason: string;
  /**
   * Exists in the production database (verified against
   * `az cosmosdb sql container list`, 2026-08-28). `false` means a route must
   * `ensureContainer` it before first use. A claim about production, not a way
   * to silence the provisioning canary.
   */
  readonly provisioned: boolean;
}

export const CONTAINERS = {
  // ── group-scoped ────────────────────────────────────────────────────────
  sessions: { pk: '/sessionId', scope: 'group', provisioned: true, reason: "a session is one club's night; the pointer doc is per group too" },
  players: { pk: '/sessionId', scope: 'group', provisioned: true, reason: 'a roster line of one session; the cost split lives here' },
  announcements: { pk: '/sessionId', scope: 'group', provisioned: true, reason: "written by one club's admin to that club" },
  skills: { pk: '/sessionId', scope: 'group', provisioned: true, reason: 'per-session skill scores, keyed by roster name within that session' },
  gameResults: { pk: '/sessionId', scope: 'group', provisioned: true, reason: 'four roster names from one session' },
  birds: { pk: '/id', scope: 'group', provisioned: true, reason: "shuttle purchases and stock adjustments — one club's inventory" },
  aliases: { pk: '/id', scope: 'group', provisioned: true, reason: "e-transfer names read against one club's payments (security rule 10)" },
  kudos: { pk: '/recipientMemberId', scope: 'group', provisioned: true, reason: 'eligibility is co-play on one roster, and raterName is a roster name' },
  stringingJobs: { pk: '/memberId', scope: 'group', provisioned: true, reason: "the bench is a club service; a job carries that club's rate card" },
  clubSettings: { pk: '/id', scope: 'group', provisioned: true, reason: 'shop sign, stocked strings, rate card — per club, per-group ids' },
  events: { pk: '/memberId', scope: 'group', provisioned: true, reason: "an engagement happens inside one group's tabs; slice0 is a per-group readout" },
  insights: { pk: '/memberId', scope: 'group', provisioned: true, reason: 'narrates group play (partners, kudos); one cache doc per group per member' },
  memberships: { pk: '/groupId', scope: 'group', provisioned: false, reason: "a person's role and roster name IN ONE GROUP, plus that group's name reservations; the group is the partition" },
  // ── person-scoped ───────────────────────────────────────────────────────
  members: { pk: '/id', scope: 'person', provisioned: true, reason: 'the person: one account, one PIN, one email — many groups' },
  identities: { pk: '/id', scope: 'person', provisioned: true, reason: 'one email maps to one member DB-wide, atomically; that fits one-account-many-groups' },
  playerGear: { pk: '/memberId', scope: 'person', provisioned: true, reason: 'one gear bag per person, whichever club they play at' },
  assessments: { pk: '/memberId', scope: 'person', provisioned: true, reason: 'one skill self-assessment history per person' },
  drillCompletions: { pk: '/memberId', scope: 'person', provisioned: true, reason: 'a drill done is done, regardless of club' },
  pushSubscriptions: { pk: '/memberId', scope: 'person', provisioned: false, reason: 'one device row per person; the SENDER narrows by roster' },
  authhandoff: { pk: '/id', scope: 'person', provisioned: true, reason: 'ten-minute OAuth stash keyed by a hashed ref, no group context' },
  authmigration: { pk: '/id', scope: 'person', provisioned: false, reason: 'five-minute PWA-to-native stash, no group context' },
  // ── global ──────────────────────────────────────────────────────────────
  equipmentCatalog: { pk: '/category', scope: 'global', provisioned: true, reason: 'the racket/string catalog; seeded, not user data' },
  releases: { pk: '/id', scope: 'global', provisioned: true, reason: "the app's own changelog" },
  feedback: { pk: '/id', scope: 'global', provisioned: true, reason: 'reports go to the operator, not to a group admin; groupId is context only' },
  groups: { pk: '/id', scope: 'global', provisioned: false, reason: 'the registry of clubs themselves — a group doc is not inside any group; read by id, never listed to a member' },
} as const satisfies Readonly<Record<string, ContainerMeta>>;

export type ContainerName = keyof typeof CONTAINERS;

/** The container names whose scope is `S`, as a type. */
export type ContainersOfScope<S extends ContainerScope> = {
  [K in ContainerName]: (typeof CONTAINERS)[K]['scope'] extends S ? K : never;
}[ContainerName];

export function pkOf(name: ContainerName): string {
  return CONTAINERS[name].pk;
}

/** The document FIELD the partition key reads — `'/sessionId'` → `'sessionId'`. */
export function pkFieldOf(name: ContainerName): string {
  return CONTAINERS[name].pk.slice(1);
}

export function containersOfScope<S extends ContainerScope>(scope: S): ContainersOfScope<S>[] {
  return (Object.keys(CONTAINERS) as ContainerName[]).filter(
    (n): n is ContainersOfScope<S> => CONTAINERS[n].scope === scope,
  );
}

/** Names of the containers that exist in production without `ensureContainer`. */
export const PROVISIONED_CONTAINERS: readonly ContainerName[] = (
  Object.keys(CONTAINERS) as ContainerName[]
).filter((n) => CONTAINERS[n].provisioned);
