import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import en from '../messages/en.json';
import zh from '../messages/zh-CN.json';
import { SKILLS } from '../lib/assessment';
import { DRILLS } from '../lib/drills';

/**
 * Skill and drill copy is read by screens from `messages/*.json`
 * (`skillContent`, through `lib/useSkillText.ts`) while scoring, the drill
 * picker and the AI prompts read the English in `lib/assessment.ts` and
 * `scripts/data/drill-library.json`. This pins the two Englishes together so
 * there is still only one, and holds the Chinese complete.
 */
type Content = {
  skills: Record<string, { label: string; anchors: string[] }>;
  drills: Record<string, { title: string; description: string }>;
  settings: Record<string, string>;
  drillReason: string;
};
const EN = (en as unknown as { skillContent: Content }).skillContent;
const ZH = (zh as unknown as { skillContent: Content }).skillContent;
const CJK = /[一-鿿]/;

describe('skillContent', () => {
  it('en.json holds the same English as lib/assessment.ts, for every skill', () => {
    expect(Object.keys(EN.skills).sort()).toEqual(SKILLS.map((s) => s.key).sort());
    for (const s of SKILLS) {
      expect(EN.skills[s.key].label, s.key).toBe(s.label);
      expect(EN.skills[s.key].anchors, s.key).toEqual([...s.anchors]);
    }
  });

  it('en.json holds the same English as the drill library, for every drill', () => {
    expect(Object.keys(EN.drills).sort()).toEqual(DRILLS.map((d) => d.id).sort());
    for (const d of DRILLS) {
      expect(EN.drills[d.id], d.id).toEqual({ title: d.title, description: d.description });
    }
  });

  it('zh-CN has Chinese for every skill, answer, drill and setting', () => {
    for (const s of SKILLS) {
      const z = ZH.skills[s.key];
      expect(CJK.test(z.label), s.key).toBe(true);
      expect(z.anchors, s.key).toHaveLength(5);
      z.anchors.forEach((a, i) => expect(CJK.test(a), `${s.key}[${i}]`).toBe(true));
    }
    for (const d of DRILLS) {
      expect(CJK.test(ZH.drills[d.id].title), d.id).toBe(true);
      expect(CJK.test(ZH.drills[d.id].description), d.id).toBe(true);
    }
    for (const setting of ['solo', 'pair', 'group']) expect(CJK.test(ZH.settings[setting]), setting).toBe(true);
  });

  it('the reason line carries the same placeholders in both languages', () => {
    const args = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    expect(args(ZH.drillReason)).toEqual(args(EN.drillReason));
  });

  it('no Stats component reads skill or drill copy around the hook', () => {
    // The shapes that printed English on the Chinese tab before this existed.
    const banned = [
      /SKILL_BY_KEY\.get\([^)]*\)\??\.label/,
      /SKILL_LABEL/,
      /\b(?:s|skill)\.label\b/,
      /\b(?:s|skill)\.anchors\b/,
      /\{\s*(?:d|drill|focus)\??\.(?:title|description|reason|skillLabel|setting)\s*\}/,
    ];
    const dir = 'components/stats';
    const offenders: string[] = [];
    for (const f of readdirSync(dir).filter((n) => n.endsWith('.tsx'))) {
      const src = readFileSync(join(dir, f), 'utf8');
      for (const re of banned) if (re.test(src)) offenders.push(`${f}: ${re}`);
    }
    expect(offenders).toEqual([]);
  });
});
