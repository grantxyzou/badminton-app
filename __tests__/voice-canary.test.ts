import { describe, it, expect } from 'vitest';
import en from '../messages/en.json';
import zh from '../messages/zh-CN.json';

/**
 * Voice canary — guards the copy against accusatory / pressuring phrasing that
 * violates the voice charter (docs/voice-and-tone.md): the app is a reliable,
 * insightful friend, never a scold. If a future string trips one of these, it's
 * almost certainly off-voice — soften it (or, if genuinely needed, update the
 * charter and this list deliberately).
 */
const BANNED_EN = [
  'you failed',
  'you missed',
  'too many tries',
  'too many attempts',
  'lock you out',
  'last chance',
];

function flatten(obj: unknown, out: string[] = []): string[] {
  if (typeof obj === 'string') out.push(obj);
  else if (obj && typeof obj === 'object') for (const v of Object.values(obj as Record<string, unknown>)) flatten(v, out);
  return out;
}

describe('voice canary', () => {
  const enStrings = flatten(en);

  for (const phrase of BANNED_EN) {
    it(`en.json contains no "${phrase}"`, () => {
      const hits = enStrings.filter((s) => s.toLowerCase().includes(phrase));
      expect(hits).toEqual([]);
    });
  }

  it('en and zh-CN have identical key structures (parity)', () => {
    const keys = (obj: unknown, prefix = '', out: string[] = []): string[] => {
      if (obj && typeof obj === 'object') {
        for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
          const path = prefix ? `${prefix}.${k}` : k;
          if (v && typeof v === 'object') keys(v, path, out);
          else out.push(path);
        }
      }
      return out;
    };
    expect(keys(zh).sort()).toEqual(keys(en).sort());
  });
});
