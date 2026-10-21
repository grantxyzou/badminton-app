import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as cosmos from '../lib/cosmos';
import { eligibleCoPlayers, playedTogetherRecently } from '../lib/kudosEligibility';
import { resetMockStore, getStore } from './helpers';

/**
 * `lib/kudosEligibility.ts` reads the roster of every recent session. It used
 * to do so one session at a time — up to nine serial round trips on every
 * GiveKudosCard mount and every send — and the enforcement path asked each
 * session for its game log too before moving to the next. The rule did not
 * change here; only the shape of the reads. These cases pin both halves: the
 * answers are the ones the serial walk gave, and the reads go out together.
 *
 * The spy wraps the REAL mock container and, for one named container, parks
 * every `fetchAll` until the test releases it. A loop that awaited each read
 * before issuing the next could never have N queries parked at once.
 */
function instrument(hold: string) {
  const real = cosmos.getContainer;
  const counts: Record<string, number> = {};
  const held: Array<() => void> = [];
  const spy = vi.spyOn(cosmos, 'getContainer').mockImplementation(((name: string) => {
    const c = real(name as never);
    return {
      ...c,
      items: {
        ...c.items,
        query: (q: unknown) => {
          const inner = c.items.query(q as never);
          return {
            fetchAll: () => {
              counts[name] = (counts[name] ?? 0) + 1;
              if (name !== hold) return inner.fetchAll();
              return new Promise((resolve) => held.push(() => resolve(inner.fetchAll())));
            },
          };
        },
      },
    } as never;
  }) as never);
  return {
    counts,
    held,
    /** Let the parked reads through — in REVERSE order, so a merge that
     *  depended on arrival order rather than session order would show. */
    release: () => { for (const r of held.splice(0).reverse()) r(); },
    restore: () => spy.mockRestore(),
  };
}

const ACTIVE = 'current-session';
const DATED = ['session-2026-10-15', 'session-2026-10-08', 'session-2026-10-01'];
/** The active session plus the three dated ones. */
const N = 1 + DATED.length;

function seedRosterFor(sessionId: string, names: string[]) {
  const store = getStore();
  if (!store['players']) store['players'] = [];
  for (const n of names) store['players'].push({ id: `p-${sessionId}-${n}`, sessionId, name: n, removed: false });
}

function seed() {
  const store = getStore();
  store['sessions'] = DATED.map((id) => ({ id, sessionId: id }));
  seedRosterFor(ACTIVE, ['Viktor', 'Lin']);
  seedRosterFor('session-2026-10-15', ['Viktor', 'Akane', 'lin']); // `lin` dedupes against Lin
  seedRosterFor('session-2026-10-08', ['Kento', 'Carolina']); // Viktor was not here
  seedRosterFor('session-2026-10-01', ['Viktor', 'Sindhu']);
}

describe('kudos eligibility reads every recent roster at once', () => {
  let inst: ReturnType<typeof instrument> | null = null;
  beforeEach(() => {
    resetMockStore();
    seed();
  });
  afterEach(() => {
    inst?.restore();
    inst = null;
  });

  it('GET path: all N roster queries are in flight before any resolves, and the list keeps session order', async () => {
    inst = instrument('players');
    const pending = eligibleCoPlayers('bpm', 'Viktor', ACTIVE);
    await vi.waitFor(() => expect(inst!.held).toHaveLength(N));
    // Nothing has resolved yet, and every session's read was already issued.
    expect(inst.counts['players']).toBe(N);

    inst.release();
    // Active first, then newest dated session first — the serial walk's order,
    // even though the reads came back oldest first.
    expect(await pending).toEqual(['Lin', 'Akane', 'Sindhu']);
    // No more reads than before: one bounded sessions read plus one per session.
    expect(inst.counts['sessions']).toBe(1);
    expect(inst.counts['players']).toBe(N);
  });

  it('POST path: a roster proof needs no game read, and the rosters go out together', async () => {
    inst = instrument('players');
    const pending = playedTogetherRecently('bpm', 'Viktor', 'Sindhu', ACTIVE);
    await vi.waitFor(() => expect(inst!.held).toHaveLength(N));
    inst.release();
    expect(await pending).toBe(true);
    expect(inst.counts['players']).toBe(N);
    expect(inst.counts['gameResults'] ?? 0).toBe(0);
  });

  it('POST path: a refusal reads every game log together, and no more than the serial walk did', async () => {
    inst = instrument('gameResults');
    const pending = playedTogetherRecently('bpm', 'Viktor', 'Kento', ACTIVE);
    await vi.waitFor(() => expect(inst!.held).toHaveLength(N));
    inst.release();
    expect(await pending).toBe(false);
    // The serial walk's worst case was two reads per session; so is this.
    expect(inst.counts['players']).toBe(N);
    expect(inst.counts['gameResults']).toBe(N);
  });

  it('POST path: a logged game in the OLDEST session still proves it', async () => {
    getStore()['gameResults'] = [
      { id: 'g1', sessionId: 'session-2026-10-01', teamA: ['Viktor', 'Kento'], teamB: ['A', 'B'], scoreA: 21, scoreB: 10 },
    ];
    inst = instrument('gameResults');
    const pending = playedTogetherRecently('bpm', 'Viktor', 'Kento', ACTIVE);
    await vi.waitFor(() => expect(inst!.held).toHaveLength(N));
    inst.release();
    expect(await pending).toBe(true);
  });
});
