// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { shareMessage, shareTextOrCopy } from '@/lib/shareText';

/**
 * One message, the link inside it exactly once. Handing the share sheet text
 * AND a separate url made Messages and WhatsApp show the link twice; the
 * clipboard fallback copied text alone and dropped a link the text lacked.
 */
const URL = 'https://bpm.grantzou.com/bpm/s';

describe('shareMessage', () => {
  it('leaves a text that already carries the link alone', () => {
    expect(shareMessage({ text: `Sign up: ${URL}`, url: URL })).toBe(`Sign up: ${URL}`);
  });

  it('a text that IS the link is just the link, once', () => {
    expect(shareMessage({ text: URL, url: URL })).toBe(URL);
  });

  it('appends the link to a text that lacks it', () => {
    expect(shareMessage({ text: "You're on the list. Tap to sign in:", url: URL })).toBe(
      `You're on the list. Tap to sign in: ${URL}`,
    );
  });

  it('an empty text is the link', () => {
    expect(shareMessage({ text: '  ', url: URL })).toBe(URL);
  });
});

describe('shareTextOrCopy on the web', () => {
  const share = vi.fn();
  const writeText = vi.fn();

  beforeEach(() => {
    share.mockReset().mockResolvedValue(undefined);
    writeText.mockReset().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'share', { value: share, configurable: true });
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  });
  afterEach(() => {
    delete (navigator as unknown as Record<string, unknown>).share;
  });

  it('hands the sheet one message and no separate url', async () => {
    await shareTextOrCopy({ title: 'BPM Core', text: `Sign up: ${URL}`, url: URL });
    expect(share).toHaveBeenCalledTimes(1);
    const arg = share.mock.calls[0][0] as Record<string, string>;
    expect(arg.text).toBe(`Sign up: ${URL}`);
    expect(arg).not.toHaveProperty('url');
    expect(arg.text.split(URL).length - 1).toBe(1);
  });

  it('the copy fallback carries the link even when the text did not', async () => {
    delete (navigator as unknown as Record<string, unknown>).share;
    const outcome = await shareTextOrCopy({ title: 'Join', text: 'Tap to sign in:', url: URL });
    expect(outcome).toBe('copied');
    expect(writeText).toHaveBeenCalledWith(`Tap to sign in: ${URL}`);
  });
});
