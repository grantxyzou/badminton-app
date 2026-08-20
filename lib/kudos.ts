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

/** A stored kudos. `raterMemberId`/`raterName` are strip-canaries — like
 *  `pinHash`, they must never appear in any GET response. */
export interface KudosDoc {
  id: string;
  recipientMemberId: string; // partition key
  recipientName: string;
  raterMemberId: string;
  raterName: string;
  sessionId: string;
  tag: KudosTag;
  createdAt: string;
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
