#!/usr/bin/env node
/**
 * Refuse a headless-Chrome screenshot of a `?tab=` URL.
 *
 * WHY THIS IS WORTH BLOCKING RATHER THAN DOCUMENTING
 * --------------------------------------------------
 * This app reads `?tab=` in a post-mount `useEffect` (HomeShell), so the tab
 * switch happens AFTER hydration. `--virtual-time-budget` advances past `load`
 * and then stops, which means a headless screenshot of `?tab=profile`
 * reliably captures **Home**.
 *
 * The failure mode is what makes it dangerous: you get a real, plausible,
 * correctly-rendered PNG of the wrong screen. Nothing errors. It has already
 * been presented as evidence in this repo more than once — CLAUDE.md documents
 * it, and it happened again on 2026-08-27, where a shot meant to show the
 * signed-out Profile card showed Home instead.
 *
 * A comment cannot stop that, because the person taking the shot is usually
 * confident. A refusal can.
 *
 * `--virtual-time-budget` is flagged the same way even without `?tab=`: it
 * terminates in-flight fetches, so data-heavy tabs render the app's offline
 * banner and the image "proves" a bug that does not exist.
 *
 * Wired as a PreToolUse hook on Bash — see .claude/settings.json.
 *
 * Exit codes:
 *   0 — allowed (silent)
 *   2 — blocked, with the reason and the alternative
 */
import { readFileSync } from 'node:fs';

function readStdin() {
  try {
    return readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

const raw = readStdin();
if (!raw.trim()) process.exit(0);

let command = '';
try {
  command = JSON.parse(raw)?.tool_input?.command ?? '';
} catch {
  // An unrecognised payload is not grounds to block a command.
  process.exit(0);
}
if (!command) process.exit(0);

const isScreenshot = /--screenshot|--headless/.test(command);
if (!isScreenshot) process.exit(0);

const reasons = [];
if (/[?&]tab=/.test(command)) {
  reasons.push(
    'The URL carries `?tab=`, which this app applies in a post-mount effect. ' +
      'A headless shot captures Home instead — a real, plausible image of the WRONG screen.',
  );
}
if (/--virtual-time-budget/.test(command)) {
  reasons.push(
    '`--virtual-time-budget` terminates in-flight fetches, so data tabs render ' +
      "the offline banner and the image 'proves' a bug that is not there.",
  );
}
if (reasons.length === 0) process.exit(0);

console.error('\nBlocked: this screenshot would be misleading, not wrong-looking.\n');
for (const r of reasons) console.error('  - ' + r);
console.error(
  '\nUse the `verify-ui` skill instead: it drives the playwright-isolated MCP,\n' +
    'navigates by CLICKING the bottom-nav tab, and waits for the network.\n' +
    'If you genuinely want the Home tab, drop `?tab=` from the URL and this passes.\n',
);
process.exit(2);
