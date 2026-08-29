import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { flattenMarkdown, buildAnnouncementPayload } from '@/lib/pushMessages';

/**
 * The announcement trigger.
 *
 * Two things it must get right, and both are easy to get wrong silently:
 * announcements are stored as RAW MARKDOWN, and only a genuinely NEW one is
 * worth interrupting anyone for.
 */

describe('flattenMarkdown — a lock screen has no renderer', () => {
  it('strips the tokens the app renders, leaving the words', () => {
    expect(flattenMarkdown('**Courts moved** to _Wing’s_')).toBe('Courts moved to Wing’s');
  });

  it('keeps link TEXT and drops the URL', () => {
    expect(flattenMarkdown('See [the map](https://maps.example.com/x)')).toBe('See the map');
  });

  it('drops images entirely — there is nothing to show', () => {
    expect(flattenMarkdown('![court photo](a.png) Doors at 7')).toBe('Doors at 7');
  });

  it('flattens headings, quotes and inline code', () => {
    expect(flattenMarkdown('# Heads up\n> bring `$10`')).toBe('Heads up bring $10');
  });

  it('turns bullets into something readable on one line', () => {
    expect(flattenMarkdown('- bring water\n- pay Grant')).toBe('• bring water • pay Grant');
  });

  it('collapses newlines rather than emitting a multi-line banner', () => {
    expect(flattenMarkdown('Line one\n\n\nLine two')).toBe('Line one Line two');
  });

  it('leaves plain text completely alone', () => {
    expect(flattenMarkdown('Courts are booked for 8pm')).toBe('Courts are booked for 8pm');
  });
});

describe('buildAnnouncementPayload', () => {
  it('uses the announcement text as the body, flattened', () => {
    const p = buildAnnouncementPayload({ id: 'a1', text: '**Late start** tonight' });
    expect(p.title).toBe('New announcement');
    expect(p.body).toBe('Late start tonight');
    expect(p.body).not.toContain('**');
  });

  /** An empty body would render a banner that says nothing at all. */
  it('falls back to something useful when the text is empty or markdown-only', () => {
    expect(buildAnnouncementPayload({ id: 'a1', text: '' }).body).toBe('Tap to read it in the app.');
    expect(buildAnnouncementPayload({ id: 'a1', text: '![x](y.png)' }).body).toBe(
      'Tap to read it in the app.',
    );
  });

  it('tags per announcement, so two notices do not collapse into one', () => {
    const a = buildAnnouncementPayload({ id: 'a1', text: 'one' });
    const b = buildAnnouncementPayload({ id: 'a2', text: 'two' });
    expect(a.tag).not.toBe(b.tag);
  });

  it('survives a missing text field rather than throwing', () => {
    expect(() => buildAnnouncementPayload({ id: 'a1' })).not.toThrow();
  });
});

/**
 * The route wiring. A source scan for the CREATE-only rule: a runtime test
 * would need the whole admin-auth + Cosmos path, and the thing worth pinning is
 * the structural claim — that PATCH does not notify.
 */
describe('the announcement route notifies on CREATE only', () => {
  let src = '';
  beforeEach(async () => {
    const { readFileSync } = await import('fs');
    src = readFileSync(new URL('../app/api/announcements/route.ts', import.meta.url), 'utf8');
  });
  afterEach(() => vi.restoreAllMocks());

  it('sends from the POST handler', () => {
    const post = src.slice(src.indexOf('export async function POST'));
    expect(post).toContain('sendPushToAll');
    expect(post).toContain('buildAnnouncementPayload');
  });

  /** Re-notifying everyone because a typo was fixed is the empty interruption
   *  the whole notification design exists to avoid. */
  it('does NOT send from the PATCH (edit) handler', () => {
    const patch = src.slice(src.indexOf('export async function PATCH'), src.indexOf('export async function POST'));
    expect(patch).not.toContain('sendPushToAll');
  });

  it('is behind the push flag, and persists before it notifies', () => {
    expect(src).toContain("isFlagOn('NEXT_PUBLIC_FLAG_PUSH_NOTIFY')");
    // Scoped to the POST BODY: `sendPushToAll` also appears in the import at
    // the top of the file, which made a whole-file index comparison
    // meaningless. The claim is about order WITHIN the handler.
    const post = src.slice(src.indexOf('export async function POST'));
    expect(post.indexOf('items.create')).toBeLessThan(post.indexOf('sendPushToAll'));
  });
});
