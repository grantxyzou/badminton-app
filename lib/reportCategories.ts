/**
 * What a problem report is about (docs/superpowers/specs/2026-11-09-profile-reorg-design.md §6):
 * the chip the member started from on Report a problem. Pure, so the page and
 * the route share ONE list — the route keeps a category only when it is here,
 * so a hand-made request cannot invent one.
 */
export const REPORT_CATEGORIES = ['signup', 'money', 'payment', 'stringing', 'performance', 'other'] as const;
export type ReportCategory = (typeof REPORT_CATEGORIES)[number];

export function isReportCategory(v: unknown): v is ReportCategory {
  return typeof v === 'string' && (REPORT_CATEGORIES as readonly string[]).includes(v);
}
