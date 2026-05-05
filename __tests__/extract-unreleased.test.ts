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
function readOutput(): {
  suggestedVersion: string;
  text: string;
  generatedAt: string;
  source?: 'unreleased' | 'published-fallback' | 'empty';
} {
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

  it('falls back to the most recent published version when Unreleased is missing', () => {
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
    // Fallback: pre-fill from the only published version we have
    expect(out.text).toContain('- thing');
    expect(out.suggestedVersion).toBe('v1.0');
    expect(out.source).toBe('published-fallback');
  });

  it('falls back to the highest semver published when Unreleased is empty', () => {
    // CHANGELOG.md is intentionally NOT chronologically ordered (per project memory:
    // v1.1 sits below v1.2 by design). Fallback must pick by semver, not file order.
    writeFileSync(
      REAL_CHANGELOG,
      [
        '# Changelog',
        '## v1.0 — baseline',
        '- v1 stuff',
        '## Unreleased',
        '*Items here live on main.*',
        '## v1.3 — newest',
        '- newest stuff',
        '## v1.2 — middle',
        '- middle stuff',
        '## v1.1 — oldest non-baseline',
        '- v1.1 stuff',
      ].join('\n'),
    );
    runExtract();

    const out = readOutput();
    expect(out.suggestedVersion).toBe('v1.3');
    expect(out.text).toContain('newest stuff');
    expect(out.text).not.toContain('middle stuff');
    expect(out.text).not.toContain('v1 stuff');
    expect(out.source).toBe('published-fallback');
  });

  it('uses Unreleased content (not fallback) when bullets are present', () => {
    writeFileSync(
      REAL_CHANGELOG,
      [
        '# Changelog',
        '## Unreleased',
        '*Items here live on main.*',
        '- new bullet',
        '## v1.3 — old',
        '- old bullet',
      ].join('\n'),
    );
    runExtract();

    const out = readOutput();
    expect(out.text).toContain('new bullet');
    expect(out.text).not.toContain('old bullet');
    expect(out.suggestedVersion).toBe('v1.4');
    expect(out.source).toBe('unreleased');
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
