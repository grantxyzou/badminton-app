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

  it('is the only copy: neither row keeps its own colour table', () => {
    for (const f of ['components/admin/CommandCenter/StringingPage.tsx', 'components/stringing/StringerJobsCard.tsx']) {
      const src = readFileSync(f, 'utf8');
      expect(src, f).not.toMatch(/const DUE_FG/);
      expect(src, f).toMatch(/dueStyle\(/);
    }
  });
});
