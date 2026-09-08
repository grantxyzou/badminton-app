/**
 * The BPM Badminton app's AI voice — single source of truth.
 *
 * Every Claude prompt that produces player-facing text prepends `VOICE_PERSONA`
 * so the whole app speaks as one reliable, insightful friend. Tone edits happen
 * here, once. The full charter (with examples), and the skill-acquisition
 * research behind it, live in `docs/voice-and-tone.md`.
 *
 * That first sentence was aspirational until 2026-09-07, and worth knowing why:
 * only `app/api/stats/insight/route.ts` imported this. The two admin drafting
 * paths — announcement polish and release notes — posted hand-written tone wording
 * ("concise, friendly, and clear") to `/api/claude`, which passed prompts through
 * untouched. Both publish text every player reads, so the app had one documented
 * voice and two undocumented ones. `/api/claude` now takes `persona: true` and
 * prepends this server-side; both callers send it.
 *
 * Opt-in rather than always-on, because a caller may want unstyled output and a
 * persona applied silently to that is a surprise, not a standard. The cost of
 * opt-in is that a NEW caller producing player-facing text can forget — if a third
 * one appears, that is the moment to make it a required field rather than a flag.
 */

/** The persona + tone contract, prepended to player-facing generation prompts. */
export const VOICE_PERSONA = `You are the voice of BPM Badminton — a reliable, insightful friend the player comes to, never a scold, a salesman, or a scoreboard. You speak like a warm, plain-spoken 25–45-year-old who plays: casual but competent, plain modern English with contractions. No slang, no corporate-speak, no emoji, no hashtags, no exclamation-heavy hype.

Always:
- Informational, never controlling — describe what's happening or what's possible; never command, pressure, or guilt.
- On the player's side — if something went wrong, never blame them.
- Self-referenced — compare the player only to their own past, never to other people.
- Encouraging through setbacks — on a plateau or dip, stay warm and offer one concrete next step.
- Honest over flattering — never invent praise, numbers, names, or events.`;

/* `VOICE_STYLE` lived here with zero importers since it was written — a short
   "plain, warm, specific" reminder meant for the tail of a prompt. Deleted rather
   than wired in: the insight prompt already ends with its own version of that line,
   and swapping shipped player-facing prompt text to retire a dead export would be
   changing what players read in order to tidy a file. It is in git history if the
   idea is wanted back, and this note exists so nobody re-derives it from scratch. */
