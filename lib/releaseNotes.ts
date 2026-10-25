/**
 * Narrows the CHANGELOG `Unreleased` text the release form pre-fills to the
 * entries written since the last published release.
 *
 * The section is never cut when a release is published from the admin form,
 * so it only grows: ~12,000 characters in September, ~87,000 by late October,
 * against a 24,000-character draft limit (`lib/claudeLimits.ts`). Every
 * "Draft with AI" then failed with "too long" before it asked anything, and
 * the box held six weeks of entries players had already read about. Reading
 * the date the last release went out does what cutting the changelog by hand
 * was meant to do, without anyone having to remember.
 *
 * An entry is a `### ` heading and the text under it; its date is the first
 * `YYYY-MM-DD` on the heading line. A range ("2026-10-24 to 25") counts by its
 * first day. The changelog is newest-first but not strictly sorted, so every
 * dated entry is judged on its own. An undated entry is kept only while no
 * older dated entry has appeared above it: the undated `### Added` /
 * `### Fixed` blocks at the bottom are history, a new one at the top is not.
 * The publish DAY is kept, because a release can go out mid-day; the admin
 * trims what that release already said.
 */

const DATE_RE = /\b(\d{4}-\d{2}-\d{2})\b/;

/** The Vancouver calendar day of an ISO instant, as `YYYY-MM-DD` (the app's zone). */
export function vancouverDay(iso: string): string | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Vancouver', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d);
}

/** The entries of `text` dated on or after `sinceDay` (`YYYY-MM-DD`). */
export function changelogSince(text: string, sinceDay: string): string {
  const parts = text.split(/^(?=### )/m);
  const kept: string[] = [];
  let pastCutoff = false;
  for (const part of parts) {
    if (!part.startsWith('### ')) {
      // Text above the first heading is a preamble, not an entry.
      kept.push(part);
      continue;
    }
    const day = part.split('\n', 1)[0].match(DATE_RE)?.[1];
    if (day) {
      if (day >= sinceDay) kept.push(part);
      else pastCutoff = true;
    } else if (!pastCutoff) {
      kept.push(part);
    }
  }
  return kept.join('').replace(/\n{3,}/g, '\n\n').trim();
}
