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
      query(_q: unknown) {
        return { fetchAll: async () => ({ resources: [...store] }) };
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
    client = new CosmosClient(process.env.COSMOS_CONNECTION_STRING!);
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
  location: 'Sports Hall',
  datetime: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
  deadline: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString(),
  cost: '$5 per person',
  courts: 2,
  maxPlayers: parseInt(process.env.NEXT_PUBLIC_MAX_PLAYERS ?? '12'),
};
