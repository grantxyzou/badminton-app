/**
 * Who the tour signs in as.
 *
 * MOCK: the seeded famous players (`SEED_DEV_SCENARIO=fresh-thursday`,
 * `SEED_DEV_ADMIN=Grant:1130`), signed in with name and PIN.
 *
 * PROD: the E2E test club's personas, from the `E2E_ACCOUNTS` secret, signed
 * in with email and password. Its shape is an object of label → account:
 *
 *   {
 *     "organiser": { "email": "you+e2e-org@gmail.com", "password": "…" },
 *     "player1":   { "email": "you+e2e-p1@gmail.com",  "password": "…" },
 *     "joiner":    { "email": "you+e2e-join@gmail.com", "password": "…" }
 *   }
 *
 * Labels are free text. A persona's ROLE is not taken from its label; it is
 * read from the server after sign-in (`GET /api/groups/current`), so a label
 * cannot make the tour treat a player as an organiser. A label starting
 * `joiner` is held back for the join journey (step 4): the joiner belongs to
 * no club, so it would fail the club guard by design.
 *
 * The secret is never printed. Only labels reach a log or a report.
 */
import { target } from './target';

export type Persona =
  | { label: string; kind: 'pin'; name: string; pin: string }
  | { label: string; kind: 'password'; email: string; password: string };

const MOCK_PERSONAS: Persona[] = [
  { label: 'organiser', kind: 'pin', name: 'Grant', pin: '1130' },
  { label: 'player', kind: 'pin', name: 'Lin', pin: '2468' },
];

export function parseAccounts(raw: string | undefined): Persona[] {
  if (!raw || !raw.trim()) {
    throw new Error('E2E_ACCOUNTS is not set. See e2e/personas.ts for its shape.');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Never echo the input: it holds passwords.
    throw new Error('E2E_ACCOUNTS is not valid JSON. See e2e/personas.ts for its shape.');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('E2E_ACCOUNTS must be an object of label → { email, password }.');
  }
  const out: Persona[] = [];
  for (const [label, value] of Object.entries(parsed as Record<string, unknown>)) {
    const v = value as { email?: unknown; password?: unknown } | null;
    if (!v || typeof v.email !== 'string' || typeof v.password !== 'string' || !v.email || !v.password) {
      throw new Error(`E2E_ACCOUNTS["${label}"] needs a string email and password.`);
    }
    out.push({ label, kind: 'password', email: v.email, password: v.password });
  }
  if (out.length === 0) throw new Error('E2E_ACCOUNTS lists no accounts.');
  return out;
}

export function isJoiner(p: Persona): boolean {
  return p.label.toLowerCase().startsWith('joiner');
}

/** The personas that take the tour: every member of the club, never the joiner. */
export function tourPersonas(): Persona[] {
  const all = target() === 'prod' ? parseAccounts(process.env.E2E_ACCOUNTS) : MOCK_PERSONAS;
  return all.filter((p) => !isJoiner(p));
}
