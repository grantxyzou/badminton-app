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

    /**
     * LINE-BASED, and bounded to the card's own subtree.
     *
     * This was a regex window over the N characters following the className,
     * which failed in both directions. Too small (400) and a card with a long
     * header never reached its sibling; too large (2000) and the window ran
     * PAST the card into the next component and borrowed ITS `<CardHeader>` —
     * SkillTrendCard's error card, which contains only an <ErrorState>, was
     * reported as an offender on the strength of a header 15 lines below it.
     *
     * Indentation bounds it honestly: the card's children are indented deeper
     * than its opening tag, and the card has closed at the first line indented
     * the same or less.
     */
    const lines = src.split('\n');
    for (let i = 0; i < lines.length; i++) {
      // Both quoting styles. Requiring `className="` made every card whose
      // class list is a template literal invisible — WhereYouSitCard among
      // them, which is how it shipped with its rhythm cancelled while this
      // canary stayed green.
      const mq = lines[i].match(/className="([^"]*glass-card[^"]*)"/);
      const mt = lines[i].match(/className=\{`([^`]*glass-card[^`]*)`\}/);
      const classes = mq?.[1] ?? mt?.[1];
      if (!classes) continue;

      const cardIndent = lines[i].length - lines[i].trimStart().length;

      // The card's direct children: lines indented deeper, up to its close.
      const children: string[] = [];
      for (let j = i + 1; j < lines.length; j++) {
        const line = lines[j];
        if (!line.trim()) continue;
        const indent = line.length - line.trimStart().length;
        if (indent <= cardIndent) break; // card closed
        children.push(line);
      }
      if (!children.length) continue;

      const childIndent = children[0].length - children[0].trimStart().length;
      const direct = children.filter(
        (l) => l.length - l.trimStart().length === childIndent && /^[<{]/.test(l.trim()),
      );
      // Only cards whose FIRST child is the header are this rule's business.
      if (!direct[0]?.trim().startsWith('<CardHeader')) continue;
      // A header with nothing after it needs no gap.
      if (direct.length < 2) continue;

      // `space-y-*` / `gap-*` on the card, or an inline gap in its own tag.
      const ownTag = lines.slice(i, i + 3).join(' ');
      const spaced = SPACED.test(classes) || /gap:\s*'var\(--space/.test(ownTag);
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
