/**
 * SUITE-WIDE `[group-leak]` ALARM (multi-group Phase 5).
 *
 * `lib/groupScope.ts` drops any query row that belongs to another group and
 * logs `[group-leak]`. In production that line is the sentinel the flag flip
 * is gated on: a clean week of it means the group clause never let a row
 * through. In the test suite it was only ever looked at by the two tests that
 * provoke it on purpose, so a route that leaked in some other test logged a
 * line nobody read and still passed.
 *
 * This file is a `setupFiles` entry (vitest.config.ts): it wraps
 * `console.error` once, records every `[group-leak]` call, and fails the test
 * that produced one. A test that provokes the sentinel deliberately calls
 * `allowGroupLeakLog()` first.
 *
 * A test that replaces `console.error` itself (`vi.spyOn(...).mockImplementation`)
 * stops the recording for its own duration. That is accepted: such a test is
 * already asserting on what is logged.
 */
import { afterEach, beforeEach } from 'vitest';

const SENTINEL = '[group-leak]';

let leaks: unknown[][] = [];
let allowed = false;

/** The `[group-leak]` calls recorded in the current test (for the alarm's own self-test). */
export function recordedGroupLeaks(): readonly unknown[][] {
  return leaks;
}

/** Call at the top of a test that provokes `[group-leak]` on purpose. */
export function allowGroupLeakLog(): void {
  allowed = true;
}

const original = console.error.bind(console);
console.error = (...args: unknown[]) => {
  if (typeof args[0] === 'string' && args[0].startsWith(SENTINEL)) leaks.push(args);
  original(...args);
};

beforeEach(() => {
  leaks = [];
  allowed = false;
});

afterEach(() => {
  if (allowed || leaks.length === 0) return;
  const detail = leaks.map((a) => JSON.stringify(a[1] ?? {})).join('; ');
  leaks = [];
  throw new Error(
    `${SENTINEL} logged during this test — a row from another group reached a groupScope() read: ${detail}. ` +
      'If the test provokes it on purpose, call allowGroupLeakLog() from __tests__/setup/group-leak-spy.ts.',
  );
});
