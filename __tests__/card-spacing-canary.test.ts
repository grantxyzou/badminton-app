import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

/**
 * A card that renders a `<CardHeader>` plus content must own the gap between
 * them.
 *
 * `CardHeader` is deliberately a bare header ROW — it sets no bottom margin, so
 * the card supplies the rhythm. Ten stringing cards missed that and rendered
 * with the primary button jammed flush against the subtitle. It looked like a
 * missing spec; the spec exists (`space-y-3`, used by 29 other cards) and was
 * simply not applied.
 *
 * WHY A SOURCE SCAN AND NOT A RENDER TEST. jsdom applies no stylesheet, so a
 * rendered assertion about margins measures nothing — every gap is 0px there.
 * The only thing that can be checked without a real browser is whether the
 * mechanism is present in the markup, which is exactly the thing that was
 * missing. It is a lint rule that happens to live in the test suite.
 */
const ROOT = join(__dirname, '..', 'components');

function tsxFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...tsxFiles(full));
    else if (entry.endsWith('.tsx')) out.push(full);
  }
  return out;
}

/**
 * Does this card element carry a vertical-rhythm mechanism?
 *
 * `space-y-*` is the convention. An inline `gap` on a flex/grid card is the
 * sanctioned alternative — several cards predate the utility and use it — so
 * both count. What does not count is nothing at all.
 *
 * A Tailwind `gap-*` class counts too, and has to: `space-y-*` compiles to
 * `> * + * { margin-top }`, which a child's inline `margin: '0'` silently
 * overrides, so `flex flex-col gap-*` is the prescribed fix for that bug (see
 * CLAUDE.md). Without this branch the documented remedy fails the very test
 * that polices the defect — which is exactly what happened when
 * KudosReceivedCard was fixed.
 */
const SPACED = /space-y-\d|gap-\d/;

describe('cards with a header own the gap under it', () => {
  const offenders: string[] = [];

  for (const file of tsxFiles(ROOT)) {
    const src = readFileSync(file, 'utf8');
    if (!src.includes('<CardHeader')) continue;

    // Each `glass-card p-*` opening tag, with the ~10 lines that follow it —
    // enough to see whether a CardHeader is the first thing inside.
    const re = /className="([^"]*glass-card[^"]*)"([\s\S]{0,400})/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) !== null) {
      const [, classes, after] = m;
      if (!after.includes('<CardHeader')) continue;

      // A header with nothing after it needs no gap.
      const body = after.slice(after.indexOf('<CardHeader'));
      const hasSibling = /\n\s*(<div|<button|<p |<ul|<input|\{)/.test(
        body.replace(/<CardHeader[\s\S]*?\/>/, ''),
      );
      if (!hasSibling) continue;

      const spaced = SPACED.test(classes) || /gap:\s*'var\(--space/.test(m[2].slice(0, 200));
      if (!spaced) {
        offenders.push(`${file.replace(ROOT, 'components')} :: ${classes}`);
      }
    }
  }

  it('every such card declares space-y-* or an explicit gap', () => {
    // If this fails, add `space-y-3` to the card's className. That is the
    // convention, not a preference: 29 cards already use it.
    expect(offenders).toEqual([]);
  });
});
