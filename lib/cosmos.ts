import { CosmosClient, Container } from '@azure/cosmos';
import { randomBytes, scryptSync } from 'node:crypto';
import equipmentCatalogSeed from '../scripts/data/equipment-catalog.json';
import { scoreAssessment, placePhase } from './assessment';

// ---------------------------------------------------------------------------
// In-memory mock — used when COSMOS_CONNECTION_STRING is not set (local dev)
// Stored on `global` so Next.js HMR doesn't wipe it between reloads.
// ---------------------------------------------------------------------------
const g = global as typeof globalThis & {
  _mockStore?: Record<string, Record<string, unknown>[]>;
  _devAdminSeeded?: boolean;
  _devScenarioSeeded?: boolean;
};
if (!g._mockStore) g._mockStore = {};
const mockStore = g._mockStore;

/**
 * Dev-only admin seed for headless audits (#68).
 *
 * Set `SEED_DEV_ADMIN=Name:NNNN` (e.g. `SEED_DEV_ADMIN=Grant:1130`) when
 * starting the dev server with no `COSMOS_CONNECTION_STRING`. On first
 * access to the mock `members` container, this seeds a single admin
 * member with the given PIN hashed via the same scrypt params as
 * `lib/recoveryHash.ts`, so `POST /api/admin` works without going
 * through the player-signup chicken-and-egg.
 *
 * Idempotent across HMR reloads (the `_devAdminSeeded` flag lives on
 * `global` alongside the mock store).
 *
 * Refuses to fire when real Cosmos is configured — the seed is a
 * development affordance, not a production migration.
 */
function seedDevAdminIfRequested(containerName: string) {
  if (containerName !== 'members') return;
  if (g._devAdminSeeded) return;
  if (process.env.COSMOS_CONNECTION_STRING) return;
  const spec = process.env.SEED_DEV_ADMIN;
  if (!spec) return;

  const [name, pin] = spec.split(':');
  if (!name || !pin || !/^[0-9]{4}$/.test(pin)) {
    console.warn(
      '[dev] SEED_DEV_ADMIN format invalid — expected "Name:NNNN" with a 4-digit PIN. ' +
        `Got "${spec}". Skipping admin seed.`,
    );
    g._devAdminSeeded = true;
    return;
  }

  const salt = randomBytes(16);
  const hash = scryptSync(pin, salt, 32, { N: 16384, r: 8, p: 1 });
  mockStore.members ??= [];
  mockStore.members.push({
    id: 'dev-admin-seed',
    name,
    role: 'admin',
    active: true,
    sessionCount: 0,
    createdAt: new Date().toISOString(),
    pinHash: `${salt.toString('hex')}:${hash.toString('hex')}`,
  });
  g._devAdminSeeded = true;
  console.warn(
    `[dev] SEED_DEV_ADMIN: seeded admin member "${name}" with the given PIN ` +
      '(mock store only — not for production use).',
  );
}

/**
 * Dev-only scenario seed for end-to-end testing of the signup → settle →
 * cover flow without touching real Cosmos data.
 *
 * Set `SEED_DEV_SCENARIO=fresh-thursday` to seed:
 *   - one active session 48h in the future (signupOpen: true, deadline 24h out)
 *   - the active-session-pointer document
 *   - 6 invite-list members named after famous badminton players, covering
 *     all three sign-up modes:
 *       Lin     (PIN 2468) → sign-in flow
 *       Viktor  (no PIN)   → create-account flow
 *       Carolina, Akane, Kento, Sindhu (no PIN) → autocomplete fodder
 *
 * Players container stays empty by design — the test scenario starts
 * "no one signed up yet."
 *
 * Set `SEED_DEV_SCENARIO=played-thursday` for the same fixtures but a session
 * that JUST happened (3h ago, signup closed) plus a 4-player roster and 3 kudos
 * received by Lin — so the post-session surfaces (game logger, give-kudos +
 * received-kudos cards, drills, calibration) all render. Sign in as Lin (2468)
 * → Stats. See `scripts/dev-demo.sh`.
 *
 * Plays well with SEED_DEV_ADMIN — they seed different docs and both can
 * be active simultaneously. Refuses when real Cosmos is configured.
 */
function seedDevScenarioIfRequested(containerName: string) {
  if (g._devScenarioSeeded) return;
  if (process.env.COSMOS_CONNECTION_STRING) return;
  const scenario = process.env.SEED_DEV_SCENARIO;
  if (scenario !== 'fresh-thursday' && scenario !== 'played-thursday') return;
  // `played-thursday` is a session that JUST happened (3h ago) so the
  // post-session windows are open — the game logger, the give-kudos card, and
  // calibration all have live data. `fresh-thursday` is the upcoming (+48h)
  // signup-open session. Both seed the same members + catalog + Lin check-ins.
  const played = scenario === 'played-thursday';
  // Only seed once, on first access to any container we care about.
  if (containerName !== 'sessions' && containerName !== 'members') return;

  const now = new Date();
  const sessionDate = new Date(now.getTime() + (played ? -3 * 60 * 60 * 1000 : 2 * 24 * 60 * 60 * 1000));
  const deadlineDate = new Date(now.getTime() + (played ? -27 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000));
  const datetime = sessionDate.toISOString();
  const deadline = deadlineDate.toISOString();
  const sessionId = sessionIdFromDate(datetime);

  // Sessions container: session doc + pointer doc
  mockStore.sessions ??= [];
  if (!mockStore.sessions.find((s) => s.id === sessionId)) {
    mockStore.sessions.push({
      id: sessionId,
      sessionId,
      title: 'Thursday Badminton',
      datetime,
      endDatetime: new Date(sessionDate.getTime() + 2 * 60 * 60 * 1000).toISOString(),
      deadline,
      courts: 2,
      costPerCourt: 60,
      maxPlayers: 12,
      signupOpen: !played,
      locationVenue: "Wing's Badminton",
      locationAddress: '11820 Horseshoe Way, Richmond',
      showCostBreakdown: true,
      createdAt: now.toISOString(),
    });
  }
  if (!mockStore.sessions.find((s) => s.id === POINTER_ID)) {
    mockStore.sessions.push({
      id: POINTER_ID,
      sessionId: POINTER_ID,
      activeSessionId: sessionId,
      updatedAt: now.toISOString(),
    });
  }

  // Members container: invite list with mixed PIN states.
  //
  // Famous badminton player first names — recognizable as fixtures by anyone
  // who plays the sport, and deliberately non-overlapping with any real
  // friend-group roster. Covers single-name (Lin), conventional first names
  // (Viktor, Carolina, Akane, Kento), and last-name-as-first (Sindhu).
  mockStore.members ??= [];
  const linSalt = randomBytes(16);
  const linHash = scryptSync('2468', linSalt, 32, { N: 16384, r: 8, p: 1 });
  const seedMembers = [
    {
      name: 'Lin',  // Lin Dan, CHN. PIN 2468 → sign-in flow.
      pinHash: `${linSalt.toString('hex')}:${linHash.toString('hex')}`,
    },
    { name: 'Viktor' },    // Viktor Axelsen, DEN. No PIN → create-account flow.
    { name: 'Carolina' },  // Carolina Marin, ESP.
    { name: 'Akane' },     // Akane Yamaguchi, JPN.
    { name: 'Kento' },     // Kento Momota, JPN.
    { name: 'Sindhu' },    // P. V. Sindhu, IND.
  ];
  for (const m of seedMembers) {
    if (mockStore.members.find((existing) => (existing as { name?: string }).name === m.name)) {
      continue;
    }
    mockStore.members.push({
      id: `dev-member-${m.name.toLowerCase()}`,
      name: m.name,
      role: 'member',
      active: true,
      sessionCount: 0,
      createdAt: now.toISOString(),
      ...(m.pinHash ? { pinHash: m.pinHash } : {}),
    });
  }

  // Value-Hub Slice-0: seed the racket catalog so the recommendation card +
  // gear picker have data, and one sample game so /api/games isn't empty during
  // e2e. Seeded here (not on equipmentCatalog/gameResults first-access) because
  // this whole block runs once, gated on sessions/members access.
  mockStore.equipmentCatalog ??= [];
  for (const item of equipmentCatalogSeed.items) {
    if (!mockStore.equipmentCatalog.find((c) => c.id === (item as { id: string }).id)) {
      mockStore.equipmentCatalog.push(item as Record<string, unknown>);
    }
  }
  mockStore.gameResults ??= [];
  if (mockStore.gameResults.length === 0) {
    mockStore.gameResults.push({
      id: randomBytes(16).toString('hex'),
      sessionId,
      teamA: ['Lin', 'Viktor'],
      teamB: ['Carolina', 'Akane'],
      scoreA: 21,
      scoreB: 17,
      loggedBy: 'Lin',
      loggedAt: now.toISOString(),
    });
  }

  // Skill self-assessment: two snapshots for Lin ~5 weeks apart so the trend
  // hero has a then-vs-now overlay to render (Switch → Commitment).
  mockStore.assessments ??= [];
  if (mockStore.assessments.length === 0) {
    const mkSnapshot = (id: string, daysAgo: number, ratingMap: Record<string, number>) => {
      const ratings = Object.entries(ratingMap).map(([skillKey, value]) => ({
        skillKey,
        value,
        source: 'self' as const,
      }));
      const score = scoreAssessment(ratings);
      return {
        id,
        memberId: 'dev-member-lin',
        name: 'Lin',
        takenAt: new Date(now.getTime() - daysAgo * 24 * 60 * 60 * 1000).toISOString(),
        ratings,
        overall: score.overall,
        dimensionScores: score.dimensionScores,
        phase: placePhase(score.overall),
      };
    };
    mockStore.assessments.push(
      mkSnapshot('dev-assess-lin-1', 35, {
        serves_returns: 3, net_play: 2, clears_lifts: 3, drops: 2, drives: 2, smashes: 3, grip_deception: 2,
        footwork_split_step: 3, court_coverage: 2, speed_stamina: 3,
        game_reading: 3, consistency: 2, rules_strategy: 3, training_mindset: 4,
      }),
      mkSnapshot('dev-assess-lin-2', 5, {
        serves_returns: 4, net_play: 3, clears_lifts: 3, drops: 3, drives: 3, smashes: 4, grip_deception: 3,
        footwork_split_step: 4, court_coverage: 3, speed_stamina: 3,
        game_reading: 3, consistency: 4, rules_strategy: 4, training_mindset: 4,
      }),
    );
  }

  // played-thursday extras: a roster (so the post-session logger sees Lin as
  // "attended") and a few kudos received by Lin (so the "Kudos you've received"
  // card renders). The give-kudos card derives its co-players from the seeded
  // game above, which now sits in the just-passed active session.
  if (played) {
    mockStore.players ??= [];
    for (const name of ['Lin', 'Viktor', 'Carolina', 'Akane']) {
      const dup = mockStore.players.find(
        (p) => (p as { sessionId?: string }).sessionId === sessionId && (p as { name?: string }).name === name,
      );
      if (!dup) {
        mockStore.players.push({
          id: `dev-player-${name.toLowerCase()}`,
          sessionId,
          name,
          removed: false,
          signedUpAt: now.toISOString(),
        });
      }
    }
    mockStore.kudos ??= [];
    if (mockStore.kudos.length === 0) {
      const mkKudos = (raterName: string, tag: string) => ({
        id: randomBytes(16).toString('hex'),
        recipientMemberId: 'dev-member-lin',
        recipientName: 'Lin',
        raterMemberId: `dev-member-${raterName.toLowerCase()}`,
        raterName,
        sessionId,
        tag,
        createdAt: now.toISOString(),
      });
      mockStore.kudos.push(mkKudos('Viktor', 'clutch'), mkKudos('Carolina', 'great_defense'), mkKudos('Akane', 'clutch'));
    }
  }

  g._devScenarioSeeded = true;
  console.warn(
    `[dev] SEED_DEV_SCENARIO=${scenario}: seeded session ${sessionId} ` +
      `(${played ? 'just played (3h ago), signup closed' : 'signupOpen'}, deadline ${deadline.slice(0, 10)}) ` +
      `+ 6 famous-player invite-list members (Lin has PIN 2468, others have no PIN) ` +
      `+ ${equipmentCatalogSeed.items.length}-racket catalog + 1 sample game + 2 skill-assessment snapshots for Lin` +
      `${played ? ' + 4-player roster + 3 kudos received by Lin' : ''}. Mock store only.`,
  );
}

function getMockContainer(name: string) {
  if (!mockStore[name]) mockStore[name] = [];
  seedDevAdminIfRequested(name);
  seedDevScenarioIfRequested(name);
  const store = mockStore[name];

  return {
    items: {
      query(q: { query: string; parameters?: { name: string; value: unknown }[] }) {
        return {
          fetchAll: async () => {
            const params: Record<string, unknown> = {};
            for (const p of q.parameters ?? []) {
              params[p.name] = p.value;
            }
            let results = [...store];
            if ('@sessionId' in params) {
              results = results.filter((r) => r.sessionId === params['@sessionId']);
            }
            if (q.query.includes('c.removed != true')) {
              results = results.filter((r) => r.removed !== true);
            }
            if (q.query.includes('c.waitlisted != true')) {
              results = results.filter((r) => r.waitlisted !== true);
            }
            if ('@name' in params) {
              results = results.filter(
                (r) => typeof r.name === 'string' &&
                  r.name.toLowerCase() === String(params['@name']).toLowerCase()
              );
            }
            if ('@id' in params) {
              results = results.filter((r) => r.id === params['@id']);
            }
            if ('@pointerId' in params) {
              results = results.filter((r) => r.id !== params['@pointerId']);
            }
            if ('@legacyId' in params) {
              results = results.filter((r) => r.id !== params['@legacyId']);
            }
            if ('@activeId' in params) {
              results = results.filter((r) => r.id !== params['@activeId']);
            }
            return { resources: results };
          },
        };
      },
      async create(item: Record<string, unknown>) {
        store.push(item);
        return { resource: item };
      },
      async upsert(item: Record<string, unknown>) {
        const idx = store.findIndex((r) => r.id === item.id);
        if (idx >= 0) store[idx] = item; else store.push(item);
        return { resource: item };
      },
    },
    item(id: string, _pk?: string) {
      return {
        async read() {
          return { resource: store.find((r) => r.id === id) ?? undefined };
        },
        async delete() {
          const idx = store.findIndex((r) => r.id === id);
          if (idx >= 0) store.splice(idx, 1);
        },
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Active session pointer helpers
// ---------------------------------------------------------------------------

export const POINTER_ID = 'active-session-pointer';

// Derives a session ID from an ISO datetime string.
export function sessionIdFromDate(isoDatetime: string): string {
  return `session-${isoDatetime.slice(0, 10)}`;
}

// ---------------------------------------------------------------------------
// Real Cosmos DB client
// ---------------------------------------------------------------------------
let client: CosmosClient | null = null;

function getClient(): CosmosClient {
  if (!client) {
    const connectionString = process.env.COSMOS_CONNECTION_STRING;
    if (!connectionString) {
      throw new Error('COSMOS_CONNECTION_STRING environment variable is not set');
    }
    client = new CosmosClient(connectionString);
  }
  return client;
}

function getDatabase() {
  const dbName = process.env.COSMOS_DB_NAME || 'badminton';
  return getClient().database(dbName);
}

export function getContainer(name: string): Container {
  if (!process.env.COSMOS_CONNECTION_STRING) {
    return getMockContainer(name) as unknown as Container;
  }
  return getDatabase().container(name);
}

/**
 * Ensures a Cosmos container exists with the given partition key. No-op in
 * mock mode (the mock auto-creates containers). Idempotent — safe to call
 * on every request; the first call does the create, subsequent calls just
 * verify existence via Cosmos's createIfNotExists API.
 *
 * Use this for containers added after the initial manual portal setup, so
 * a deploy doesn't require a human to provision the container first.
 */
export async function ensureContainer(
  name: string,
  partitionKeyPath: string,
): Promise<void> {
  if (!process.env.COSMOS_CONNECTION_STRING) return;
  await getDatabase().containers.createIfNotExists({
    id: name,
    partitionKey: { paths: [partitionKeyPath] },
  });
}

// Resolves the currently active session ID via the pointer document.
// Falls back to 'current-session' for backward compatibility with existing
// production data until the admin performs the first "Advance" action.
export async function getActiveSessionId(): Promise<string> {
  try {
    const container = getContainer('sessions');
    const { resource } = await container.item(POINTER_ID, POINTER_ID).read();
    return (resource as { activeSessionId?: string } | undefined)?.activeSessionId ?? 'current-session';
  } catch {
    return 'current-session';
  }
}

// Writes the pointer to a new session ID.
export async function setActiveSessionId(id: string): Promise<void> {
  const container = getContainer('sessions');
  await container.items.upsert({ id: POINTER_ID, sessionId: POINTER_ID, activeSessionId: id });
}

// Keep for any remaining references during migration
export const SESSION_ID = 'current-session';

export const DEFAULT_SESSION = {
  id: SESSION_ID,
  title: 'Weekly Badminton Session',
  locationName: '',
  locationAddress: '',
  datetime: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
  endDatetime: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000 + 2 * 60 * 60 * 1000).toISOString(),
  deadline: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString(),
  courts: 2,
  maxPlayers: parseInt(process.env.NEXT_PUBLIC_MAX_PLAYERS ?? '12', 10) || 12,
};
