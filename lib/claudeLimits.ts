/**
 * Limits for the admin drafting route (`POST /api/claude`), shared with the
 * callers so a form can say "too long" before it asks.
 *
 * Sized for the release-note draft, the longest caller: it sends the CHANGELOG
 * `Unreleased` section, which ran to ~12,000 characters by September 2026. The
 * old 4,000 cap rejected that with "Prompt too long", which is why no release
 * note was drafted after v1.7. The route is admin-only and rate-limited, so the
 * cap bounds a mistake, not an attacker.
 */
export const MAX_PROMPT_CHARS = 24_000;

/**
 * Room for a title and a bullet list in BOTH English and Chinese, as JSON —
 * AFTER the model's thinking, which counts against the same budget. At 2,048 a
 * release-note draft spent 1,798 tokens thinking and stopped before its answer.
 */
export const MAX_OUTPUT_TOKENS = 8192;
