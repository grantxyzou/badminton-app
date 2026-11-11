/**
 * The "How to use BPM" guides (docs/superpowers/specs/2026-11-09-profile-reorg-design.md §7–§8).
 *
 * Pure, so the in-app Support page and the public guide pages read ONE list:
 * the order, the URL slug, the icon and who the guide is listed for. The copy
 * lives in `legal.help.guides.<key>` in both message files (arrays, read with
 * `t.raw`, so `__tests__/legal-pages.test.ts` pins its shape).
 *
 * Every guide is a public page under `/legal/help/<slug>`, readable before
 * sign-in like the rest of `/legal`. `organisersOnly` only decides whether the
 * Support page LISTS it; the page itself holds nothing a stranger could use.
 */
export const GUIDES = [
  { key: 'signup', slug: 'signing-up', icon: 'how_to_reg' },
  { key: 'paying', slug: 'paying', icon: 'payments' },
  { key: 'stringing', slug: 'stringing', icon: 'sports_tennis' },
  { key: 'stats', slug: 'stats', icon: 'bar_chart' },
  { key: 'app', slug: 'the-app', icon: 'notifications' },
  { key: 'organisers', slug: 'organisers', icon: 'admin_panel_settings', organisersOnly: true },
] as const;

export type GuideKey = (typeof GUIDES)[number]['key'];
export type Guide = (typeof GUIDES)[number];

export function guideBySlug(slug: string): Guide | undefined {
  return GUIDES.find((g) => g.slug === slug);
}

export function guideByKey(key: string): Guide | undefined {
  return GUIDES.find((g) => g.key === key);
}

/** "Was this helpful?" — the only two answers the form posts. */
export const GUIDE_ANSWERS = ['yes', 'no'] as const;
export type GuideAnswer = (typeof GUIDE_ANSWERS)[number];

export function isGuideAnswer(v: unknown): v is GuideAnswer {
  return typeof v === 'string' && (GUIDE_ANSWERS as readonly string[]).includes(v);
}

/** The guides' screenshots: `public/help/<locale>/<name>.webp`. */
export const HELP_LOCALES = ['en', 'zh-CN'] as const;

export function helpImageSrc(locale: string, name: string): string {
  const dir = (HELP_LOCALES as readonly string[]).includes(locale) ? locale : 'en';
  return `${process.env.NEXT_PUBLIC_BASE_PATH ?? ''}/help/${dir}/${name}.webp`;
}
