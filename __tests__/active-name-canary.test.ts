import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Active-name canary — the identity chain has exactly ONE owner.
 *
 * `lib/useActiveName.ts` resolves `badminton_identity` → the stats
 * preview-name → null, and subscribes to BOTH `IDENTITY_EVENT` (same tab) and
 * `storage` (other tabs). That chain had been copy-pasted into five other
 * modules, and the copies drifted: `SkillTrendCard`, `KudosReceivedCard` and
 * `GiveKudosCard` subscribed to neither event and `lib/useInsight` to only one,
 * so after a name-to-name sign-in those cards kept rendering the PREVIOUS
 * member's trend, kudos and AI insight beside the new member's other cards —
 * two people's data on one screen, with no visual cue.
 *
 * A copy is invisible in a snapshot test (it renders identically until an
 * identity change), so this canary pins the structure instead: the storage key
 * and the resolver may exist in one client module only. If a new Stats surface
 * needs the active name, it calls `useActiveName()` — it does not re-derive it.
 */

const PREVIEW_KEY = 'badminton_stats_preview_name';

/** The one client module allowed to name the key or define the resolver. */
const OWNER = join('lib', 'useActiveName.ts');

/**
 * Server-side allowlist. API routes cannot call a React hook, and this route
 * only names the key as a string — it does not re-implement the chain.
 */
const SERVER_ALLOWED = [join('app', 'api', 'events', 'route.ts')];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next' || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

const roots = ['app', 'components', 'lib'];
const files = roots.flatMap((r) => walk(join(process.cwd(), r)));

describe('active-name canary', () => {
  it('names the preview-name key in exactly one client module', () => {
    const offenders = files
      .map((f) => [f.replace(process.cwd() + '/', ''), readFileSync(f, 'utf8')] as const)
      .filter(([rel, src]) => src.includes(PREVIEW_KEY) && rel !== OWNER && !SERVER_ALLOWED.includes(rel))
      .map(([rel]) => rel);

    expect(
      offenders,
      `The identity chain must live only in ${OWNER}. These re-derive it:\n  ${offenders.join('\n  ')}\n` +
        'Call useActiveName() instead — a private copy silently stops reacting to sign-in.',
    ).toEqual([]);
  });

  it('keeps both subscriptions on the owning module', () => {
    const src = readFileSync(join(process.cwd(), OWNER), 'utf8');
    // Same-tab reactivity: the browser's own `storage` event fires only in
    // OTHER tabs, so IDENTITY_EVENT is what updates this one. Both are needed;
    // dropping either reintroduces half the bug.
    expect(src).toContain('IDENTITY_EVENT');
    expect(src).toContain("addEventListener('storage'");
  });

  it('has every Stats consumer going through the hook', () => {
    const consumers = [
      join('components', 'SkillsTab.tsx'),
      join('components', 'stats', 'SkillTrendCard.tsx'),
      join('components', 'stats', 'KudosReceivedCard.tsx'),
      join('components', 'stats', 'GiveKudosCard.tsx'),
      join('lib', 'useInsight.ts'),
    ];
    for (const rel of consumers) {
      const src = readFileSync(join(process.cwd(), rel), 'utf8');
      expect(src, `${rel} should resolve the active name via useActiveName()`).toContain('useActiveName');
    }
  });
});
