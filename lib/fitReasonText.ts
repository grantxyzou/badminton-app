import en from '@/messages/en.json';
import type { FitReason } from './racketFit';

/**
 * TRANSITIONAL: renders a fit reason KEY to its English sentence on the
 * server, so the existing client — which reads `reasons: string[]` and
 * `warnings: string[]` off `/api/recommend` — keeps working while the engine
 * speaks in keys. Phase 3 teaches `GearPickRail` to translate `reasonKeys`
 * itself, in the member's locale; Phase 4 deletes this file.
 *
 * Reads the same `messages/en.json` block the client will use, so the two
 * cannot drift. Interpolation is the plain `{param}` form; none of the fit
 * keys use ICU plurals or rich tags.
 */
type Block = Record<string, string | Record<string, string>>;
const GEAR = (en as { stats: { gear: Block } }).stats.gear;

export function fitReasonText(r: FitReason): string {
  const [group, name] = r.key.split('.');
  const table = GEAR[group];
  const template = table && typeof table === 'object' ? table[name] : undefined;
  if (typeof template !== 'string') return r.key;
  return template.replace(/\{(\w+)\}/g, (_, k: string) => {
    const v = r.params?.[k];
    return v === undefined ? `{${k}}` : String(v);
  });
}

export function fitReasonTexts(rs: FitReason[]): string[] {
  return rs.map(fitReasonText);
}
