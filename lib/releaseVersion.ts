/**
 * The version the release form suggests. Pure; shared by the form and its test.
 *
 * Two places know a version: CHANGELOG.md headings (baked into
 * changelog-unreleased.json at build) and the releases actually published
 * from the admin form. They drift — the owner published "v2.0" from the form
 * while the changelog still topped out at v1.8, and the form went on
 * suggesting v1.9 below a release members had already seen. The suggestion is
 * the next minor above whichever is HIGHER.
 */

export interface Version { major: number; minor: number; patch: number }

/** "v2.0", "2.0", "v1.8.3" → a version; anything else → null. */
export function parseVersion(v: string | null | undefined): Version | null {
  const m = typeof v === 'string' ? v.trim().match(/^v?(\d+)\.(\d+)(?:\.(\d+))?$/) : null;
  return m ? { major: Number(m[1]), minor: Number(m[2]), patch: m[3] ? Number(m[3]) : 0 } : null;
}

export function compareVersions(a: Version, b: Version): number {
  return a.major - b.major || a.minor - b.minor || a.patch - b.patch;
}

export function nextMinor(v: Version): string {
  return `v${v.major}.${v.minor + 1}`;
}

/**
 * The form's suggestion. `changelogSuggestion` is already "next minor above the
 * highest changelog heading"; a published release above it wins.
 */
export function suggestReleaseVersion(latestPublished: string | undefined, changelogSuggestion: string | undefined): string {
  const published = parseVersion(latestPublished);
  const fromChangelog = parseVersion(changelogSuggestion);
  const afterPublished = published ? parseVersion(nextMinor(published)) : null;
  const best = [fromChangelog, afterPublished].filter((v): v is Version => !!v).sort(compareVersions).pop();
  return best ? `v${best.major}.${best.minor}${best.patch ? `.${best.patch}` : ''}` : 'v0.1';
}
