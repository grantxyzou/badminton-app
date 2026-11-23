import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * The sign-in screens' quiet links have no underline (Grant, 2026-11-23):
 * every `.link-quiet` in these files carries `.link-quiet--plain`. A link added
 * to a sign-in screen without it would come back underlined, and jsdom applies
 * no stylesheet, so this reads the source. Links elsewhere keep the underline.
 */
const SIGN_IN_FILES = [
  'components/SignInForm.tsx',
  'components/auth/EmailSignInForm.tsx',
  'components/auth/KeepAccountPage.tsx',
  'components/auth/NewPhonePrompt.tsx',
  'components/onboarding/ClubLinkPage.tsx',
  'components/onboarding/CreateGroupPage.tsx',
  'components/onboarding/NameStep.tsx',
  'components/onboarding/QrScanSheet.tsx',
  'components/onboarding/SignInPieces.tsx',
  'components/onboarding/SignedOutShell.tsx',
  'components/onboarding/WaitingAsks.tsx',
];

describe('sign-in links carry no underline', () => {
  for (const file of SIGN_IN_FILES) {
    it(file, () => {
      const src = readFileSync(join(process.cwd(), file), 'utf8');
      const classNames = src.match(/className="[^"]*\blink-quiet\b[^"]*"/g) ?? [];
      expect(classNames.length, 'no quiet link found: drop the file from this list').toBeGreaterThan(0);
      for (const c of classNames) expect(c).toContain('link-quiet--plain');
    });
  }

  it('the plain modifier drops the underline', () => {
    const css = readFileSync(join(process.cwd(), 'app/globals.css'), 'utf8');
    expect(css).toMatch(/\.link-quiet--plain \{\s*text-decoration: none;/);
  });
});
