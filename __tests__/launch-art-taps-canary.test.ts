import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * The launch lockup never takes a tap (2026-11-22).
 *
 * `.launch-canvas` is a positioned 360 x 740 box, far bigger than the logo it
 * draws. On the sign-in pages (`AuthStage`'s `.auth-logo`) it hangs over the
 * fields and buttons below the logo, and without `pointer-events: none` it took
 * every tap meant for the email, name and PIN boxes: nobody could type, so every
 * button stayed disabled. It shipped to production that way, because the walks
 * filled the fields with Playwright's `fill()`, which never asks what is on top.
 *
 * jsdom has no layout, so this is a source check on the rule itself.
 */
describe('launch art taps', () => {
  it('.launch-canvas lets taps pass through', () => {
    const css = readFileSync(join(process.cwd(), 'app/globals.css'), 'utf8');
    const block = css.match(/\n\.launch-canvas \{([^}]*)\}/);
    expect(block, '.launch-canvas rule not found').not.toBeNull();
    expect(block![1]).toMatch(/pointer-events:\s*none/);
  });
});
