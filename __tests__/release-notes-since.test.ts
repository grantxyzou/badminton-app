import { describe, it, expect } from 'vitest';
import { changelogSince, vancouverDay } from '../lib/releaseNotes';

const NOTES = `### Widgets (2026-10-25)

New widgets.

### Admin stays open (2026-10-24 to 25)

- Kept.

### Undated note at the top

Still new.

### Multi-group is on (2026-10-22)

Flag flipped.

### Tabs stay put (2026-10-21)

Already published.

### A late-filed fix (2026-10-23)

Filed below an older entry.

### Added

- An old undated block.`;

describe('changelogSince', () => {
  it('keeps entries dated on or after the day, and drops older ones', () => {
    const out = changelogSince(NOTES, '2026-10-22');
    expect(out).toContain('### Widgets');
    expect(out).toContain('### Admin stays open');
    expect(out).toContain('### Multi-group is on'); // the publish day itself
    expect(out).not.toContain('### Tabs stay put');
  });

  it('judges each dated entry on its own, since the changelog is not strictly sorted', () => {
    expect(changelogSince(NOTES, '2026-10-22')).toContain('### A late-filed fix');
  });

  it('keeps an undated entry above the cutoff and drops one below it', () => {
    const out = changelogSince(NOTES, '2026-10-22');
    expect(out).toContain('### Undated note at the top');
    expect(out).not.toContain('### Added');
  });

  it('counts a range by its first day', () => {
    expect(changelogSince(NOTES, '2026-10-25')).not.toContain('### Admin stays open');
  });

  it('answers empty when nothing is new', () => {
    // The undated entry now sits below older dated ones, so it goes too.
    expect(changelogSince(NOTES, '2026-11-01')).toBe('');
    expect(changelogSince('### Undated\n\nNew.\n\n### Old (2026-01-01)\n\nx', '2026-11-01')).toBe('### Undated\n\nNew.');
    expect(changelogSince('### Old (2026-01-01)\n\nx', '2026-11-01')).toBe('');
  });
});

describe('vancouverDay', () => {
  it('reads the publish instant in the app zone, not UTC', () => {
    // v2.1 went out at 07:34 UTC on 15 Oct: 00:34 in Vancouver, the same day.
    expect(vancouverDay('2026-10-15T07:34:09.726Z')).toBe('2026-10-15');
    // 03:00 UTC on the 23rd is still the 22nd in Vancouver.
    expect(vancouverDay('2026-10-23T03:00:00Z')).toBe('2026-10-22');
    expect(vancouverDay('not a date')).toBeNull();
  });
});
