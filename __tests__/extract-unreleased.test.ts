import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync, writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = join(__dirname, '..');
const SCRIPT = join(ROOT, 'scripts', 'extract-unreleased.mjs');
const OUT = join(ROOT, 'public', 'changelog-unreleased.json');

// Back-up + restore the real CHANGELOG so the test can install a fixture
const REAL_CHANGELOG = join(ROOT, 'CHANGELOG.md');
let backup = '';

function runExtract() {
  execFileSync('node', [SCRIPT], { cwd: ROOT, stdio: 'pipe' });
}
function readOutput(): { suggestedVersion: string; text: string; generatedAt: string } {
  return JSON.parse(readFileSync(OUT, 'utf8'));
}

describe('scripts/extract-unreleased.mjs', () => {
  beforeAll(() => {
    backup = readFileSync(REAL_CHANGELOG, 'utf8');
  });

  afterAll(() => {
    writeFileSync(REAL_CHANGELOG, backup);
    // Re-run once so the repo's public/changelog-unreleased.json is back to
    // representing the real CHANGELOG, not the test fixture.
    runExtract();
  });

  it('extracts bullets from the Unreleased section', () => {
    writeFileSync(
      REAL_CHANGELOG,
      [
        '# Changelog',
        '',
        '---',
        '',
        '## v1.0 — baseline (2026-04-18)',
        '',
        '### Highlights',
        '- v1 thing',
        '',
        '---',
        '',
        '## Unreleased — `bpm-next` only',
        '',
        '*Items here live on main.*',
        '',
        '### Added',
        '',
        '- **Feature A** — thing',
        '- **Feature B** — other thing',
        '',
        '### Perf',
        '',
        '- Optimization C',
        '',
      ].join('\n'),
    );
    runExtract();

    const out = readOutput();
    expect(out.text).toContain('Feature A');
    expect(out.text).toContain('Feature B');
    expect(out.text).toContain('Optimization C');
    expect(out.text).toContain('### Added');
    expect(out.text).toContain('### Perf');
    // Editorial italic blurb should be stripped
    expect(out.text).not.toContain('Items here live on main');
    // Must NOT pick up content from a previous released section
    expect(out.text).not.toContain('v1 thing');
  });

  it('suggests next minor version based on the highest existing tag', () => {
    writeFileSync(
      REAL_CHANGELOG,
      [
        '# Changelog',
        '## v1.0 — baseline',
        '- thing',
        '## v1.0.1 — hotfix',
        '- hotfix',
        '## Unreleased',
        '- new stuff',
      ].join('\n'),
    );
    runExtract();

    const out = readOutput();
    // Highest seen is v1.0.1; bump minor → v1.1
    expect(out.suggestedVersion).toBe('v1.1');
  });

  it('handles a CHANGELOG with no Unreleased section gracefully', () => {
    writeFileSync(
      REAL_CHANGELOG,
      [
        '# Changelog',
        '## v1.0 — baseline',
        '- thing',
      ].join('\n'),
    );
    runExtract();

    const out = readOutput();
    expect(out.text).toBe('');
    expect(out.suggestedVersion).toBe('v1.1');
  });

  it('records a timestamp', () => {
    writeFileSync(REAL_CHANGELOG, '# Changelog\n## Unreleased\n- x\n');
    runExtract();
    const out = readOutput();
    expect(new Date(out.generatedAt).toString()).not.toBe('Invalid Date');
  });

  it('writes to public/changelog-unreleased.json', () => {
    if (existsSync(OUT)) unlinkSync(OUT);
    writeFileSync(REAL_CHANGELOG, '# Changelog\n## Unreleased\n- x\n');
    runExtract();
    expect(existsSync(OUT)).toBe(true);
  });
});
