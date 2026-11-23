/**
 * `e2e/issue.sh`: one GitHub issue per stretch of red (docs/plans/e2e-test-club.md).
 * Run against a fake `gh` that records its arguments, so the three branches —
 * open, add to, close — are proved without touching GitHub.
 */
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

let dir: string;
let log: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'e2e-issue-'));
  log = join(dir, 'gh.log');
  // `gh issue list ... --jq` answers with the open issue's number, as gh itself
  // would after applying the filter; every call is appended to the log.
  writeFileSync(
    join(dir, 'gh'),
    `#!/usr/bin/env bash\necho "$*" >> "${log}"\nif [ "$1 $2" = "issue list" ]; then echo "$FAKE_OPEN"; fi\n`,
  );
  chmodSync(join(dir, 'gh'), 0o755);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function run(target: string, outcome: string, open = '') {
  execFileSync('bash', ['e2e/issue.sh', target, outcome], {
    env: {
      ...process.env,
      PATH: `${dir}:${process.env.PATH}`,
      FAKE_OPEN: open,
      GITHUB_SERVER_URL: 'https://github.com',
      GITHUB_REPOSITORY: 'owner/repo',
      GITHUB_RUN_ID: '42',
    },
    cwd: process.cwd(),
  });
  return readFileSync(log, 'utf8').trim().split('\n');
}

describe('e2e/issue.sh', () => {
  it('opens one issue when nothing is open', () => {
    const calls = run('prod', 'failure');
    expect(calls.some((c) => c.startsWith('issue create --title E2E tour failing (prod) --label e2e-failure'))).toBe(true);
    expect(calls.some((c) => c.startsWith('issue comment'))).toBe(false);
  });

  it('adds the run to the open issue instead of opening another', () => {
    const calls = run('prod', 'failure', '17');
    expect(calls.some((c) => c.startsWith('issue comment 17 --body-file'))).toBe(true);
    expect(calls.some((c) => c.startsWith('issue create'))).toBe(false);
  });

  it('closes the open issue when the run passes, naming the run', () => {
    const calls = run('mock', 'success', '17');
    expect(calls).toContain('issue close 17 --comment Passing again: https://github.com/owner/repo/actions/runs/42');
  });

  it('does nothing on a pass with nothing open', () => {
    const calls = run('mock', 'success');
    expect(calls.filter((c) => !c.startsWith('issue list'))).toEqual([]);
  });
});
