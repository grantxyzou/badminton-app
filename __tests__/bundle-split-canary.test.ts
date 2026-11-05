import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * The three tabs nobody has opened yet must stay OUT of the first payload.
 *
 * `HomeShell` mounts exactly one tab, but a static import ships them all: the
 * Stats tree alone reaches the register, every gear sheet and both catalog
 * pickers. A `dynamic()` here is invisible in every test that renders the
 * shell (they all pass either way), so this scan is the only thing that can
 * see it go back.
 *
 * HomeTab is deliberately NOT in this list: it renders the server-rendered
 * announcement, which is the LCP element and has to be in the first HTML.
 */
const LAZY = ['StringingTab', 'SkillsTab', 'ProfileTab', 'AdminTab'] as const;

describe('HomeShell keeps the unopened tabs out of the first payload', () => {
  const source = readFileSync(join(process.cwd(), 'components', 'HomeShell.tsx'), 'utf8');

  for (const tab of LAZY) {
    it(`${tab} is loaded with dynamic(), never imported statically`, () => {
      expect(source, `${tab} is statically imported — it ships to everyone who opens Home`)
        .not.toMatch(new RegExp(`^import ${tab} from`, 'm'));
      expect(source).toMatch(new RegExp(`const ${tab} = dynamic\\(`));
    });
  }

  it('HomeTab stays eager: it carries the server-rendered announcement (the LCP element)', () => {
    expect(source).toMatch(/^import HomeTab from/m);
  });
});

/**
 * The page sends ONE shell, so a visitor downloads one (audit, 2026-11-05).
 * A server component that imports both client shells lists both as client
 * modules, and every visitor's first load carried the other one: a member paid
 * for the sign-up forms on every cold start, a stranger for the whole app.
 */
describe('app/page.tsx loads each shell in its own chunk', () => {
  const page = readFileSync(join(process.cwd(), 'app', 'page.tsx'), 'utf8');
  const shells = readFileSync(join(process.cwd(), 'components', 'PageShells.tsx'), 'utf8');

  it('the page imports neither shell module directly', () => {
    expect(page).not.toMatch(/^import \w+ from '@\/components\/HomeShell'/m);
    expect(page).not.toMatch(/^import \w+ from '@\/components\/onboarding\/SignedOutShell'/m);
    expect(page).toMatch(/from '@\/components\/PageShells'/);
  });

  it('PageShells makes both dynamic()', () => {
    expect(shells).toMatch(/export const HomeShell = dynamic\(\(\) => import\('@\/components\/HomeShell'\)\)/);
    expect(shells).toMatch(/export const SignedOutShell = dynamic\(\(\) => import\('@\/components\/onboarding\/SignedOutShell'\)\)/);
  });
});
