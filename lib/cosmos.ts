import { CosmosClient, Container } from '@azure/cosmos';

let client: CosmosClient | null = null;

function getClient(): CosmosClient {
  if (!process.env.COSMOS_CONNECTION_STRING) {
    throw new Error('COSMOS_CONNECTION_STRING is not configured');
  }
  if (!client) {
    client = new CosmosClient(process.env.COSMOS_CONNECTION_STRING);
  }
  return client;
}

function getDatabase() {
  const dbName = process.env.COSMOS_DB_NAME || 'badminton';
  return getClient().database(dbName);
}

export function getContainer(name: string): Container {
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
