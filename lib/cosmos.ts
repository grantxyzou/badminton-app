import { CosmosClient, Container } from '@azure/cosmos';

// ---------------------------------------------------------------------------
// In-memory mock — used when COSMOS_CONNECTION_STRING is not set (local dev)
// Stored on `global` so Next.js HMR doesn't wipe it between reloads.
// ---------------------------------------------------------------------------
const g = global as typeof globalThis & { _mockStore?: Record<string, Record<string, unknown>[]> };
if (!g._mockStore) g._mockStore = {};
const mockStore = g._mockStore;

function getMockContainer(name: string) {
  if (!mockStore[name]) mockStore[name] = [];
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

export const SESSION_ID = 'current-session';

export const DEFAULT_SESSION = {
  id: SESSION_ID,
  title: 'Weekly Badminton Session',
  locationName: '',
  locationAddress: '',
  datetime: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
  deadline: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString(),
  courts: 2,
  maxPlayers: parseInt(process.env.NEXT_PUBLIC_MAX_PLAYERS ?? '12', 10) || 12,
};
