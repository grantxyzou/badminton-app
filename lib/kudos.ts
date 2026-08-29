/**
 * Kudos — positive-only, post-game peer recognition. Replaces the cut numeric
 * peer rating: no scores, no ranking, just a small fixed set of appreciations.
 *
 * Pure helpers only (no I/O). The aggregate is counts-per-tag, never rater
 * identities — `aggregateKudos` is what the gated GET returns.
 *
 * v1 is deliberately PURELY SOCIAL: `kudosLevelNudge` returns 0 (a reserved
 * seam). In a small friend group, positive-only peer signal is reciprocity-prone
 * — wiring it into the canonical level would re-introduce exactly the noise that
 * got numeric peer rating cut. Any future coupling must be a tiny, capped
 * confidence bump gated on distinct raters across distinct sessions, designed
 * separately.
 */

export const KUDOS_TAGS = ['great_defense', 'clutch', 'most_improved', 'good_sport', 'nice_shot'] as const;
export type KudosTag = (typeof KUDOS_TAGS)[number];

/** Max length of an optional note. Long enough for a real observation, short
 *  enough that it stays a gesture rather than a message thread. */
export const KUDOS_NOTE_MAX = 140;

/**
 * A stored kudos.
 *
 * `raterMemberId` is a strip-canary — like `pinHash`, it must never appear in
 * any GET response.
 *
 * `raterName` IS A DOCUMENTED EXCEPTION, and only alongside a note.
 * ------------------------------------------------------------------
 * Tags stay anonymous: the recipient sees "Clutch ×2" and never who. That is
 * the original promise and it is unchanged.
 *
 * A NOTE is different in kind. Adding free text turned an anonymous counter
 * into an anonymous message channel, which is the shape that goes wrong between
 * people — and leaves no way to trace one that lands badly. Signed notes are
 * also simply worth more: "someone noticed" means less than "Lin noticed".
 *
 * So: `raterName` may be returned ONLY on a kudos that carries a note, and
 * never on the aggregate tag counts. `aggregateKudos` still cannot leak it —
 * it takes `{ tag }` and returns counts. Do not "fix" this by stripping the
 * name from notes; that reinstates the anonymous-message shape on purpose.
 */
export interface KudosDoc {
  id: string;
  recipientMemberId: string; // partition key
  recipientName: string;
  raterMemberId: string;
  raterName: string;
  sessionId: string;
  tag: KudosTag;
  /** Optional free-text context. Signed by `raterName` when present. */
  note?: string;
  /** Optional assessment-skill key the note is about (lib/assessment.ts). */
  skillKey?: string;
  createdAt: string;
}

/**
 * What a recipient may see about a single noted kudos.
 *
 * A separate type from `KudosDoc` on purpose: it is impossible to hand this to
 * a client and accidentally include `raterMemberId`, because the field does not
 * exist on it.
 */
export interface KudosNote {
  tag: KudosTag;
  note: string;
  /** The signature. See the exception documented on `KudosDoc`. */
  raterName: string;
  skillKey?: string;
  createdAt: string;
}

/** Trim and bound a note. Returns undefined for anything not worth storing, so
 *  an empty string never becomes a signed blank line. */
export function normalizeNote(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, KUDOS_NOTE_MAX);
}

/**
 * The notes a recipient may read, newest first.
 *
 * Deliberately the ONLY path that carries `raterName`, and it drops every
 * kudos without a note — an unsigned tag must not become attributable just
 * because it sat next to one that is.
 */
export function visibleNotes(docs: KudosDoc[]): KudosNote[] {
  return docs
    .filter((d) => d && isKudosTag(d.tag) && typeof d.note === 'string' && d.note.trim().length > 0)
    .map((d) => ({
      tag: d.tag,
      note: d.note as string,
      raterName: d.raterName,
      ...(d.skillKey ? { skillKey: d.skillKey } : {}),
      createdAt: d.createdAt,
    }))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/**
 * ISO week key, e.g. `2026-W35`. The dedupe unit.
 *
 * Kudos used to dedupe per SESSION, which stopped making sense the moment
 * eligibility stopped being session-scoped: with no session in the picture,
 * per-session meant per-active-session, which is not a limit at all. A week is
 * the natural cadence for a weekly club and keeps a tag from being farmed.
 */
export function isoWeekKey(iso: string | Date): string {
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return 'invalid';
  // Copy to UTC midnight, then walk to the Thursday of this ISO week.
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7; // Sunday = 7
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((t.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

export interface KudosCount {
  tag: KudosTag;
  count: number;
}

export function isKudosTag(x: unknown): x is KudosTag {
  return typeof x === 'string' && (KUDOS_TAGS as readonly string[]).includes(x);
}

/**
 * Counts per tag, in the canonical `KUDOS_TAGS` order, omitting zero-count tags.
 * Only known tags are counted (defensive against legacy/garbage). Returns
 * counts only — no rater identities ever leak through here.
 */
export function aggregateKudos(docs: { tag: string }[]): KudosCount[] {
  const counts = new Map<KudosTag, number>();
  for (const d of docs) {
    if (d && isKudosTag(d.tag)) counts.set(d.tag, (counts.get(d.tag) ?? 0) + 1);
  }
  return KUDOS_TAGS.filter((t) => (counts.get(t) ?? 0) > 0).map((tag) => ({ tag, count: counts.get(tag) as number }));
}

/**
 * Tag → Material Symbols glyph.
 *
 * Replaces the `TAG_EMOJI` map that was duplicated byte-identically in
 * `KudosReceivedCard` and `GiveKudosCard`. The design system scopes emoji to
 * the Welcome card only; everywhere else icons are Material Symbols Rounded
 * with semantic colour, which also gives these a consistent optical weight
 * that 🛡️/🔥/📈/🤝/🎯 never had across platforms.
 *
 * ⚠️ Every glyph here MUST also be in the `icon_names=` allowlist in
 * `app/layout.tsx` — a missing one renders as its literal name ("shield") with
 * no error. `__tests__/icon-subset.test.ts` will NOT catch a regression here:
 * it only matches `<span className="material-icons">glyph</span>` literals and
 * `icon: 'glyph'` props, and a map lookup is neither. All five below were
 * verified present; check by hand when adding a tag.
 */
export const TAG_ICON: Record<KudosTag, string> = {
  great_defense: 'shield',
  clutch: 'bolt',
  most_improved: 'trending_up',
  good_sport: 'groups',
  nice_shot: 'star',
};

/** Reserved seam — kudos does NOT feed the canonical level in v1 (see header). */
export function kudosLevelNudge(_total: number): number {
  return 0;
}
