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

/**
 * The CAST the journeys need, by label. On production they come from
 * `E2E_ACCOUNTS` (made in the E2E test club, `docs/plans/e2e-test-club.md`);
 * a journey whose cast is incomplete is skipped with the missing labels named,
 * never run with stand-ins.
 *
 * On the mock store the organiser (Grant) makes them on first use
 * (`ensureMockCast` in `e2e/cast.ts`): a name on the roster and a fixed PIN,
 * which the mock's in-memory store forgets on restart.
 */
export const CAST_LABELS = ['organiser', 'player1', 'player2', 'player3', 'stringer'] as const;
export type CastLabel = (typeof CAST_LABELS)[number];

export const MOCK_CAST: Record<Exclude<CastLabel, 'organiser'>, { name: string; pin: string; stringer?: true }> = {
  player1: { name: 'E2E Player 1', pin: '2581' },
  player2: { name: 'E2E Player 2', pin: '3692' },
  player3: { name: 'E2E Player 3', pin: '4703' },
  stringer: { name: 'E2E Stringer', pin: '5814', stringer: true },
};

export function cast(labels: readonly CastLabel[]): { members: Partial<Record<CastLabel, Persona>>; missing: CastLabel[] } {
  const members: Partial<Record<CastLabel, Persona>> = {};
  if (target() === 'prod') {
    const all = parseAccounts(process.env.E2E_ACCOUNTS);
    for (const l of labels) {
      const p = all.find((x) => x.label === l);
      if (p) members[l] = p;
    }
  } else {
    for (const l of labels) {
      if (l === 'organiser') members[l] = MOCK_PERSONAS[0];
      else members[l] = { label: l, kind: 'pin', name: MOCK_CAST[l].name, pin: MOCK_CAST[l].pin };
    }
  }
  return { members, missing: labels.filter((l) => !members[l]) };
}

