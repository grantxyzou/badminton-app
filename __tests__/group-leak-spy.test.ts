import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { allowGroupLeakLog, recordedGroupLeaks } from './setup/group-leak-spy';

/**
 * The suite-wide `[group-leak]` alarm (`__tests__/setup/group-leak-spy.ts`)
 * tested on itself. An alarm that never rings is indistinguishable from one
 * that is unplugged, so each way it could be unplugged is pinned here.
 */
const root = path.resolve(__dirname, '..');

describe('the [group-leak] alarm', () => {
  it('is registered for every test file', () => {
    const config = readFileSync(path.join(root, 'vitest.config.ts'), 'utf8');
    expect(config).toMatch(/setupFiles:\s*\[[^\]]*'\.\/__tests__\/setup\/group-leak-spy\.ts'/);
  });

  it('listens for the exact line groupScope emits', () => {
    // The alarm matches on the message PREFIX. If the producer's wording
    // drifted, every real leak would pass unheard.
    const source = readFileSync(path.join(root, 'lib/groupScope.ts'), 'utf8');
    expect(source).toContain("console.error('[group-leak] a row outside its group reached the accessor'");
  });

  it('records a [group-leak] line', () => {
    allowGroupLeakLog();
    console.error('[group-leak] a row outside its group reached the accessor', { container: 'players', groupId: 'a', id: 'x' });
    expect(recordedGroupLeaks()).toHaveLength(1);
  });

  it('ignores every other error', () => {
    console.error('an unrelated failure, not a leak');
    expect(recordedGroupLeaks()).toHaveLength(0);
  });
});
