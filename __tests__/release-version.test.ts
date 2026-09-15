import { describe, it, expect } from 'vitest';
import { parseVersion, suggestReleaseVersion } from '../lib/releaseVersion';

describe('suggestReleaseVersion', () => {
  it('suggests past a published release the changelog has not caught up with', () => {
    // Grant published v2.0 from the form; CHANGELOG.md still tops out at v1.8.
    expect(suggestReleaseVersion('v2.0', 'v1.9')).toBe('v2.1');
  });

  it('keeps the changelog suggestion when it is already ahead', () => {
    expect(suggestReleaseVersion('v1.8', 'v1.9')).toBe('v1.9');
    expect(suggestReleaseVersion('v1.8.3', 'v2.0')).toBe('v2.0');
  });

  it('reads vX.Y and vX.Y.Z alike, and survives a missing or odd version', () => {
    expect(parseVersion('2.0')).toEqual({ major: 2, minor: 0, patch: 0 });
    expect(parseVersion('v1.8.3')).toEqual({ major: 1, minor: 8, patch: 3 });
    expect(parseVersion('beta')).toBeNull();
    expect(suggestReleaseVersion(undefined, undefined)).toBe('v0.1');
    expect(suggestReleaseVersion('beta', 'v1.9')).toBe('v1.9');
    expect(suggestReleaseVersion('v2.0', undefined)).toBe('v2.1');
  });
});
