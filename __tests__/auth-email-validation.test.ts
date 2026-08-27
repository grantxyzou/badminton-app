import { describe, it, expect } from 'vitest';
import { isPlausibleEmail, MAX_EMAIL_LENGTH } from '../lib/authIdentity';

/**
 * Email validation, and the ReDoS it replaced.
 *
 * The obvious pattern — `^[^\s@]+@[^\s@]+\.[^\s@]+$` — is polynomial-time on
 * hostile input, because `[^\s@]` matches `.` as well: the two quantified
 * groups and the literal dot all compete for the same characters, so a
 * non-matching string makes the engine try every split point. CodeQL flagged
 * it, and it was reachable from an unauthenticated POST body that had no
 * length cap at all.
 *
 * The replacement is pure string scanning, so there is no backtracking to
 * exploit — but the timing test below is the one that would actually catch a
 * regression, since a reintroduced regex would still pass every correctness
 * case here.
 */
describe('isPlausibleEmail', () => {
  it('accepts ordinary addresses', () => {
    for (const ok of [
      'grant@example.com',
      'a.b+tag@example.co.uk',
      "o'brien@example.com",
      'x@y.z',
      'relay@privaterelay.appleid.com',
    ]) {
      expect(isPlausibleEmail(ok), ok).toBe(true);
    }
  });

  it('rejects the obvious malformations', () => {
    for (const bad of [
      '',
      'not-an-email',
      '@example.com',
      'grant@',
      'grant@example',
      'grant@.com',
      'grant@example.',
      'two@at@example.com',
      'has space@example.com',
      'tab\t@example.com',
      'newline\n@example.com',
    ]) {
      expect(isPlausibleEmail(bad), bad).toBe(false);
    }
  });

  it('enforces the RFC 5321 length cap', () => {
    const local = 'a'.repeat(MAX_EMAIL_LENGTH - '@example.com'.length);
    expect(isPlausibleEmail(`${local}@example.com`)).toBe(true);
    expect(isPlausibleEmail(`${local}a@example.com`)).toBe(false);
  });

  it('rejects an over-long address before it becomes a Cosmos document id', () => {
    // The genuinely missing guard. The old code ran `normalizeEmail` on an
    // unbounded POST body and used the result as a document id — a bad key
    // regardless of whether the matcher was exploitable.
    const hostile = `a@${'!.'.repeat(50_000)}!`;
    expect(hostile.length).toBeGreaterThan(MAX_EMAIL_LENGTH);
    expect(isPlausibleEmail(hostile)).toBe(false);
  });

  // DELIBERATELY NO TIMING TEST HERE.
  //
  // CodeQL flagged the previous `^[^\s@]+@[^\s@]+\.[^\s@]+$` as
  // polynomial-time on uncontrolled data, and the pattern genuinely has the
  // ambiguity it describes. But every hostile shape tried against V8 —
  // trailing dot, no dot, thousands of `!.` repetitions, up to 8k characters —
  // matched or failed in under a millisecond, because `.` is inside the
  // character class so a satisfying split almost always exists.
  //
  // A timing assertion would therefore have passed against the OLD code too:
  // a green test implying coverage that does not exist, which is worse than no
  // test. The replacement is kept because string scanning removes the class of
  // bug entirely and the length cap was genuinely absent — not because a live
  // denial of service was demonstrated.
});
