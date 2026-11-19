# Branded emails

**Track:** North Star pillar 4 (equipment service): the stringing emails a player reads, beside `docs/plans/stringing-invoice.md` and `docs/plans/stringing-walk-ups.md`. The account emails follow in the same frame.
**Status:** in-flight
**Review on:** 2026-12-03 — has a player replied to, or asked about, a stringing email since the redesign shipped, and did any mail app show it broken (no racket picture, no logo)?

## Problem

Grant, 2026-11-18, after seeing every email BPM sends laid out side by side: "Visual design for the email using our branding". Six of the eight kinds were plain text. The two with HTML (walk-up, invoice) each carried their own copy of the same grey box and escaping, and neither looked like the app.

Then, on the design canvas: "make the racket take up more space then the total cost show up 2 times rethink the layout"; the racket tracker was "not to spec" (three made-up steps, where the app's track has five); "include the racket render"; and for a racket the catalog does not know, "show an all black matte high fidelity render".

## Kill criterion

If a stringing email reaches a real inbox and the racket card does not render (a broken image, the table collapsed, the cost missing) in Gmail or Apple Mail, the HTML half is wrong and goes back to plain text until it is fixed. The plain-text half is unchanged on purpose, so falling back costs nothing.

## Non-goals

- Translating the emails. They stay English for the reason `lib/stringingNotifyEmail.ts` gives (the request that sends one is the stringer's, and no member's language is stored).
- Dark mode inside the mail itself. Mail apps re-tint unevenly; the frame is light with a dark header, which reads in both.
- PNG copies of every racket render. Gmail and Apple Mail show WebP; Outlook desktop does not, and it gets the alt text.
- The "Payment received" email (it needs the card webhook) and the account emails. Same frame, later steps.

## Decisions

- **One template, `lib/emailLayout.ts`.** The header (the app icon's mark and "BPM / MOTIONCRAFT STUDIO"), the footer, the racket card, the stage tracker and the button live there once. The three stringing senders build on it, and their own copies of the HTML and `escapeHtml` are deleted (CLAUDE.md, "Replace in place").
- **The cost appears once in the HTML**, at the bottom of the racket card. The invoice's button says "Pay now", not the amount again.
- **Strings are drawn as M and C**, each with its colour and tension, read by `jobSides` (`lib/stringingSides.ts`), the reader the bench uses. A custom tension, two strings, a two-colour set and the player's own string each get a tag beside the "Strings" label.
- **The racket picture is found the bench's way**: the job's label matched against the catalog (`racketIdForLabel`). A racket with a render shows it; anything else shows `_unknown.webp`, the same 3D model in matte black, so the email never shows a colourway the racket does not have. A failed catalog read shows no picture.
- **The member's tracker is the app's five-step player track** (`PLAYER_TRACK`), with the stage labels the status screen uses.
- **The plain text is unchanged.** Every existing wording test still holds, and a mail app that shows no HTML loses nothing.
