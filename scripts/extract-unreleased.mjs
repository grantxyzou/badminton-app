#!/usr/bin/env node
/**
 * Extract the `## Unreleased` section from CHANGELOG.md and write it as
 * a JSON asset that the admin Release Form can fetch + pre-fill.
 *
 * Runs as a `prebuild` step so every production build bakes in the latest
 * unreleased bullets. Also callable directly:
 *
 *   node scripts/extract-unreleased.mjs
 *
 * Output: public/changelog-unreleased.json
 * Shape:  { suggestedVersion, generatedAt, text, source }
 *
 * `source` is one of:
 *   - "unreleased"          — Unreleased section had bullets; using them
 *   - "published-fallback"  — Unreleased was empty; pre-filled from the most
 *                              recently published version (handy right after
 *                              cutting a tag, when admin still needs to
 *                              publish release notes for the just-shipped
 *                              version)
 *   - "empty"               — neither has content; form will start blank
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, '..');

function extractUnreleasedSection(markdown) {
  const lines = markdown.split('\n');
  let start = -1;
  let end = lines.length;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (start === -1) {
      if (/^##\s+Unreleased\b/i.test(line)) {
        start = i + 1;
        continue;
      }
    } else {
      if (/^##\s+/.test(line)) {
        end = i;
        break;
      }
    }
  }

  if (start === -1) {
    // No Unreleased section — still compute the suggested version from the
    // highest tag so the admin UI can pre-fill version even if raw notes
    // are empty.
    return { text: '', suggestedVersion: suggestNextVersion(markdown) };
  }

  const body = lines.slice(start, end);
  const cleaned = body
    .map((line) => line.replace(/\r$/, ''))
    .filter((line, idx, arr) => {
      const trimmed = line.trim();
      // Drop editorial italic-only blurbs like
      //   *Items here live on main. They ship to stable when the next tag is cut.*
      if (/^\*[^*]+\*$/.test(trimmed)) return false;
      // Trim leading/trailing blank runs
      const before = arr.slice(0, idx).some((l) => l.trim().length > 0);
      const after = arr.slice(idx + 1).some((l) => l.trim().length > 0);
      if (!before || !after) return trimmed.length > 0;
      return true;
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return { text: cleaned, suggestedVersion: suggestNextVersion(markdown) };
}

/**
 * Find the highest-semver published version section in the changelog and
 * return its body + version. CHANGELOG.md is NOT in chronological order
 * (per memory: v1.1 sits below v1.2 by design), so we can't just grab the
 * first `## vX.Y` header — we have to scan all of them and pick the one
 * with the highest semver.
 */
function extractMostRecentPublished(markdown) {
  const lines = markdown.split('\n');
  const headerPattern = /^##\s+(v(\d+)\.(\d+)(?:\.(\d+))?)\b/;

  // Collect all version headers with their line numbers and parsed semver.
  const headers = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(headerPattern);
    if (m) {
      headers.push({
        line: i,
        version: m[1],
        major: parseInt(m[2], 10),
        minor: parseInt(m[3], 10),
        patch: m[4] ? parseInt(m[4], 10) : 0,
      });
    }
  }

  if (headers.length === 0) return null;

  // Pick the highest semver.
  const top = headers.reduce((best, h) => {
    if (h.major !== best.major) return h.major > best.major ? h : best;
    if (h.minor !== best.minor) return h.minor > best.minor ? h : best;
    if (h.patch !== best.patch) return h.patch > best.patch ? h : best;
    return best;
  });

  // Body runs from the line after the header to the next `## ` (any depth-2
  // heading, including Unreleased or another version).
  const start = top.line + 1;
  let end = lines.length;
  for (let i = start; i < lines.length; i++) {
    if (/^##\s+/.test(lines[i])) {
      end = i;
      break;
    }
  }

  const body = lines.slice(start, end);
  const cleaned = body
    .map((line) => line.replace(/\r$/, ''))
    .filter((line, idx, arr) => {
      const before = arr.slice(0, idx).some((l) => l.trim().length > 0);
      const after = arr.slice(idx + 1).some((l) => l.trim().length > 0);
      if (!before || !after) return line.trim().length > 0;
      return true;
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return { text: cleaned, version: top.version };
}

function suggestNextVersion(markdown) {
  const tagPattern = /^##\s+v(\d+)\.(\d+)(?:\.(\d+))?\b/gm;
  let highest = { major: 0, minor: 0, patch: 0 };
  let match;
  while ((match = tagPattern.exec(markdown)) !== null) {
    const [, maj, min, patch] = match;
    const parsed = {
      major: parseInt(maj, 10),
      minor: parseInt(min, 10),
      patch: patch ? parseInt(patch, 10) : 0,
    };
    if (
      parsed.major > highest.major ||
      (parsed.major === highest.major && parsed.minor > highest.minor) ||
      (parsed.major === highest.major && parsed.minor === highest.minor && parsed.patch > highest.patch)
    ) {
      highest = parsed;
    }
  }
  return `v${highest.major}.${highest.minor + 1}`;
}

function main() {
  const changelogPath = join(ROOT, 'CHANGELOG.md');
  let markdown;
  try {
    markdown = readFileSync(changelogPath, 'utf8');
  } catch (err) {
    console.error(`[extract-unreleased] could not read ${changelogPath}:`, err.message);
    process.exit(1);
  }

  const unreleased = extractUnreleasedSection(markdown);

  // Detect "Unreleased has actual bullets" vs "scaffolding only / empty".
  // A bullet line starts with `- ` or `* ` (markdown list item).
  const hasBullets = /^\s*[-*]\s/m.test(unreleased.text);

  let payloadText = unreleased.text;
  let payloadVersion = unreleased.suggestedVersion;
  let source = hasBullets ? 'unreleased' : 'empty';

  if (!hasBullets) {
    const recent = extractMostRecentPublished(markdown);
    if (recent) {
      payloadText = recent.text;
      payloadVersion = recent.version;
      source = 'published-fallback';
    }
  }

  const payload = {
    suggestedVersion: payloadVersion,
    generatedAt: new Date().toISOString(),
    text: payloadText,
    source,
  };

  const outDir = join(ROOT, 'public');
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, 'changelog-unreleased.json');
  writeFileSync(outPath, JSON.stringify(payload, null, 2) + '\n');

  const lineCount = payloadText.split('\n').filter((l) => l.trim().length > 0).length;
  console.log(
    `[extract-unreleased] wrote ${outPath} - ${lineCount} non-blank lines, suggestedVersion=${payloadVersion}, source=${source}`,
  );
}

main();
