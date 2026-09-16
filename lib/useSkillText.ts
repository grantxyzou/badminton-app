'use client';

import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { SKILLS } from './assessment';
import { rawList } from './rawList';
import type { DrillPick } from './drills';

/**
 * Skill and drill copy in the reader's language — the one way a component
 * shows a skill's name, its five check-in answers, or a drill's text.
 *
 * The English lives in `lib/assessment.ts` and `scripts/data/drill-library.json`,
 * where the scoring, the drill picker and the AI prompts read it. The screens
 * read `skillContent` in `messages/*.json` instead, keyed by skill key and drill
 * id, and `__tests__/skill-content-canary.test.ts` holds `en.json`'s copy equal
 * to those two sources, so there is still one English.
 *
 * Every read falls back to the English source when a key is missing, so a
 * surface rendered without the namespace (a test with empty messages, a drill
 * added to the library before its translation) shows English rather than a key
 * path.
 */
const SKILL_BY_KEY = new Map(SKILLS.map((s) => [s.key, s]));

export interface SkillText {
  label: (skillKey: string) => string;
  anchors: (skillKey: string) => string[];
  drillTitle: (drill: Pick<DrillPick, 'id' | 'title'>) => string;
  drillDescription: (drill: Pick<DrillPick, 'id' | 'description'>) => string;
  setting: (setting: DrillPick['setting']) => string;
  /** "For your net play (rated 2/5)". Falls back to the server's English line
   *  for a pick from before `rating` was sent. */
  drillReason: (drill: Pick<DrillPick, 'skillKey' | 'reason'> & { rating?: number }) => string;
}

export function useSkillText(): SkillText {
  const t = useTranslations('skillContent');
  return useMemo(() => {
    const label = (key: string) =>
      t.has(`skills.${key}.label`) ? t(`skills.${key}.label`) : SKILL_BY_KEY.get(key)?.label ?? key;
    return {
      label,
      anchors: (key) => {
        const own = t.has(`skills.${key}.anchors`) ? rawList<string>(t.raw(`skills.${key}.anchors`)) : [];
        return own.length === 5 ? own : [...(SKILL_BY_KEY.get(key)?.anchors ?? [])];
      },
      drillTitle: (d) => (t.has(`drills.${d.id}.title`) ? t(`drills.${d.id}.title`) : d.title),
      drillDescription: (d) => (t.has(`drills.${d.id}.description`) ? t(`drills.${d.id}.description`) : d.description),
      setting: (s) => (t.has(`settings.${s}`) ? t(`settings.${s}`) : s),
      drillReason: (d) =>
        typeof d.rating === 'number' && t.has('drillReason')
          ? t('drillReason', { skill: label(d.skillKey).toLowerCase(), value: d.rating })
          : d.reason,
    };
  }, [t]);
}
