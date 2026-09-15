import { createHash } from 'node:crypto';
import { VOICE_PERSONA } from './aiPersona';
import type { FitFacts } from './fitVerdict';

/**
 * The fit verdict's WORDS, when an AI writes them — the prompt and the
 * contract the reply must meet. Server-only (`node:crypto`).
 *
 * The facts (`lib/fitVerdict.ts`) are the verdict; this only phrases them. So
 * the contract is strict, and anything off it is thrown away for the page's own
 * templated copy rather than repaired:
 *   - a headline, a body, and exactly one line per reason, in the facts' order;
 *   - length caps the card was drawn at;
 *   - NO DIGITS outside the racket's own name ("Air Force 79"). The range, the
 *     tension and the frame tag are rendered from the facts beside the prose,
 *     so any other number can only be one the model made up or restated — and
 *     a restated number that disagrees with the one next to it is worse than
 *     none.
 */

export const FIT_COPY_VERSION = 2;

export const COPY_LIMITS = { headline: 70, body: 220, reason: 90 } as const;

export interface FitVerdictCopy {
  headline: string;
  body: string;
  /** One per `facts.reasons`, same order. */
  reasons: string[];
}

export type CopyLocale = 'en' | 'zh-CN';

/** What the cached copy was written for. A change in any fact, the language or
 *  the prompt makes a new key, so stale words are never served over new facts. */
export function copyKey(facts: FitFacts, locale: CopyLocale): string {
  return createHash('sha256').update(JSON.stringify({ facts, locale, v: FIT_COPY_VERSION })).digest('hex').slice(0, 24);
}

const STATE_MEANING: Record<FitFacts['state'], string> = {
  suits: 'The racket suits them. Nothing in their answers argues against it.',
  fighting_slightly: 'The racket mostly suits them, with one small thing working against them.',
  fighting: 'The racket is working against them in more than one way.',
  insufficient: 'There is not enough to judge yet.',
};

const REASON_MEANING: Record<FitFacts['reasons'][number]['key'], string> = {
  goalAgainstBalance: 'the frame’s balance pulls away from what they said they want more of',
  goalWithBalance: 'the frame’s balance matches what they said they want more of',
  shaftTooStiff: 'the shaft is stiffer than their swing can bend, which costs power and loads the arm',
  shaftTooSoft: 'the shaft is softer than their fast swing wants, which costs precision',
  shaftFitsSwing: 'the shaft stiffness suits their swing speed',
  heavyForArm: 'the frame is on the heavy side for an arm that already gets sore',
  tensionHigh: 'their strings are tighter than the range that suits them',
  tensionLow: 'their strings are looser than the range that suits them',
  tensionInRange: 'their strings sit inside the range that suits them',
};

export function buildCopyPrompt(facts: FitFacts, locale: CopyLocale): string {
  const reasons = facts.reasons.map((r, i) => `${i + 1}. (${r.polarity === 'plus' ? 'in their favour' : 'against them'}) ${REASON_MEANING[r.key]}`).join('\n');
  const language = locale === 'zh-CN'
    ? 'Write in Simplified Chinese, in the same warm, plain voice.'
    : 'Write in plain modern English.';
  return `${VOICE_PERSONA}

You are putting a racket-fit verdict into words for a casual club player, on a small card in the app. The verdict is already decided; you only phrase it. Never soften it, strengthen it, or add a judgement of your own.

Verdict: ${STATE_MEANING[facts.state]}
Racket: ${facts.frame?.name ?? 'unknown'} (${facts.prospective ? 'a racket they are looking at, not one they own' : 'the racket they already play'})
Reasons, in order:
${reasons || '(none)'}

Rules:
- The headline says the verdict plainly and names the racket, the way a friend would ("Your … suits you", "Your … is fighting you slightly").
- No numbers or digits anywhere, except inside the racket's name. The tension range and the racket's specs are shown next to your words.
- Do not name other rackets, brands or strings. Do not tell them to buy anything.
- No medical advice. A sore arm is something the setup can ease, never a diagnosis.
- ${language}

Reply with JSON only, no code fence:
{"headline": "at most ${COPY_LIMITS.headline} characters", "body": "one or two sentences, at most ${COPY_LIMITS.body} characters", "reasons": [${facts.reasons.length} strings, one per reason above in the same order, each at most ${COPY_LIMITS.reason} characters]}`;
}

const DIGIT = /[0-9０-９]/;

function line(v: unknown, max: number, frameName: string): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  const withoutName = frameName ? s.split(frameName).join('') : s;
  if (!s || s.length > max || DIGIT.test(withoutName)) return null;
  return s;
}

/** The model's reply held to the contract, or null. Never repaired: a reply
 *  that breaks one rule is not trusted on the others. */
export function parseCopy(text: string, facts: FitFacts): FitVerdictCopy | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text.trim().replace(/^```(?:json)?\s*|\s*```$/g, ''));
  } catch {
    return null;
  }
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const name = facts.frame?.name ?? '';
  const headline = line(o.headline, COPY_LIMITS.headline, name);
  const body = line(o.body, COPY_LIMITS.body, name);
  if (!headline || !body || !Array.isArray(o.reasons) || o.reasons.length !== facts.reasons.length) return null;
  const reasons: string[] = [];
  for (const r of o.reasons) {
    const s = line(r, COPY_LIMITS.reason, name);
    if (!s) return null;
    reasons.push(s);
  }
  return { headline, body, reasons };
}
