import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

/**
 * "Do the invite surfaces exist?" has ONE definition, `lib/invitesOn.ts`.
 *
 * It used to have two: the server's (`lib/groupRoutes.ts`, multi-group OR
 * members-only) and the client hook's (`lib/useInviteLink.ts`, multi-group
 * alone). Every test passed, because each side was consistent with itself.
 * Production turned members-only on with multi-group off on 2026-10-03, the
 * server answered invites, nobody asked for them, and a new person following
 * the shared sign-up link was asked for an invite code nobody could give them.
 *
 * So: no file outside the definition may spell the rule by hand, and the
 * hook and the server must both import it.
 */
const ROOT = process.cwd();

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

describe('invitesOn has one definition', () => {
  it('no hand copy of the rule outside lib/invitesOn.ts', () => {
    const offenders: string[] = [];
    for (const dir of ['app', 'components', 'lib']) {
      for (const file of walk(join(ROOT, dir))) {
        const rel = file.slice(ROOT.length + 1);
        if (rel === 'lib/invitesOn.ts') continue;
        const src = readFileSync(file, 'utf8');
        // The rule's shape: both flags named in one expression.
        if (/MULTI_GROUP'\)\s*\|\|\s*isFlagOn\('NEXT_PUBLIC_FLAG_MEMBERS_ONLY|groupsOn(\(\))?\s*\|\|\s*isFlagOn\('NEXT_PUBLIC_FLAG_MEMBERS_ONLY/.test(src)) {
          offenders.push(rel);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('the hook and the server both import it', () => {
    for (const rel of ['lib/useInvites.ts', 'lib/groupRoutes.ts', 'components/admin/CommandCenter/CommandCenter.tsx']) {
      const src = readFileSync(join(ROOT, rel), 'utf8');
      expect(src, rel).toMatch(/from '@\/lib\/invitesOn'/);
    }
  });
});
