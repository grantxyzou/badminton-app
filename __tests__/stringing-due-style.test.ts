import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dueStyle } from '@/lib/stringingDue';

/**
 * One rule for how a job's date is drawn, on every row that shows one: the
 * admin bench and a stringer's own queue each kept a copy of the colours, and
 * the two drifted (the queue bolded "No date set"; the bench had stopped).
 */
describe('dueStyle', () => {
  it('bolds only a date that asks for something', () => {
    expect(dueStyle('overdue').fontWeight).toBe(600);
    expect(dueStyle('soon').fontWeight).toBe(600);
    expect(dueStyle('ok').fontWeight).toBe(400);
    expect(dueStyle('done').fontWeight).toBe(400);
  });

  it('keeps late red and today/tomorrow amber', () => {
    expect(dueStyle('overdue').color).toContain('--sev-crit-text');
    expect(dueStyle('soon').color).toContain('--pill-waitlist-text');
  });

  it('is the only copy: every row that shows a date draws it with dueStyle', () => {
    // The bench draws its rows with JobCard (docs/plans/stringing-canvas-redesign.md).
    // A stringer's queue draws its own card since the 2026-11-12 canvas pass
    // (a status pill with a glyph and a progress bar the bench card does not
    // carry), so it must call dueStyle itself rather than keep a colour table.
    expect(readFileSync('components/stringing/JobCard.tsx', 'utf8')).toMatch(/dueStyle\(/);
    expect(readFileSync('components/stringing/StringerJobsCard.tsx', 'utf8')).toMatch(/dueStyle\(/);
    for (const f of ['components/admin/CommandCenter/StringingPage.tsx', 'components/stringing/StringerJobsCard.tsx', 'components/stringing/JobCard.tsx']) {
      const src = readFileSync(f, 'utf8');
      expect(src, f).not.toMatch(/const DUE_FG/);
    }
    expect(readFileSync('components/admin/CommandCenter/StringingPage.tsx', 'utf8')).toMatch(/<JobCard/);
  });
});
