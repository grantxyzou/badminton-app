# The page scrolls, not the body

**Track:** the native shell (`docs/plans/native-shell.md`): a defect on the App Store app, reported by its owner.
**Status:** shipped 2026-11-14 (#925; the swipe follow-ups #926 and #927 on 2026-11-15, confirmed on the App Store app by Grant)
**Review on:** 2026-11-29 — since this shipped, has the blank band above the Admin console's first card come back on the App Store app, and has any sheet opened or closed with the page jumping?

## Problem

Grant, 2026-11-15, on the App Store app, with a screenshot: "Scrolling issue". The Admin console opened with about a screen of empty space between the "‹ Admin" bar and "At a glance", the scroll bar at the top. It had been scrolling normally before, and the gap went away as soon as he scrolled. It did not reproduce in Chromium at any width.

## Kill criterion

If the gap is seen again on the App Store app after this ships, the body scroller was not the cause: revert this, and capture a screen recording before guessing again.

## Non-goals

- Changing how anything scrolls INSIDE the page (sheets, the string shelf, the filter row).
- The swipe back that went to Profile (#923); this waits until Grant has confirmed that fix on his phone, so the two are not confused.

## Decisions

- **The document scrolls, as on almost every web page.** `html, body { height: 100%; overflow-x: hidden }` made `<body>` a scroll box the size of the screen, with the page scrolling inside it. Safari's own scrolling, the one it optimises and repaints most carefully, is the page's; a body that scrolls is the less-travelled path, and the symptom (a stale band that a scroll repaints) is what a missed repaint looks like. Rejected: a targeted repaint nudge on the Admin console. It would hide one instance and leave the cause for the next screen.
- **`overflow-x: clip`, not `hidden`.** `hidden` on the body is exactly what made it a scroll box (one axis hidden forces the other to `auto`). `clip` cuts off sideways overflow without making a scroll box. `hidden` stays first in each rule as the fallback for a browser older than `clip` (Safari before 16), which keeps the old behaviour there.
- **`min-height`, not `height`.** The root used to be pinned to the screen so the body could scroll inside it. Now it only has to be at least the screen. The iOS home-screen fix keeps its `100lvh`, as a minimum.
- **Each Admin level keeps its own place** (Grant, 2026-11-15: "Remember position"). The console stays mounted, hidden, under each page, but the page is one scroller, so a page opened from far down the console opened part-way down itself, and Back showed the console at the page's height. `useTrailScroll` (`lib/trailScroll.ts`) notes the level's scroll just before a page is pushed, opens the new page at its top, and gives a level its own place back on Back, all before paint. It is used by the console's trail and the Stringing bench's, on one screen only (on two pages the list keeps its side). A first measure came back 26px short; that was Playwright's own click scrolling the button into view, and a click from inside the page returned exactly (400 → Roster → Back → 400, the Roster row at the same height on screen).
- **The helpers already read both.** `lib/pageScroll.ts`, `useScrollCondensed`, `PullToRefresh`'s top check and the sheet lock were written to work whether the window or the body scrolls, so they change in their comments, not their code. The sheet lock is now the textbook case: it pins the body at `-scrollY` and scrolls back on release.

## Shape

| Piece | File |
| --- | --- |
| The root rules | `app/globals.css` (Base resets) |
| Page scroll helpers (comments) | `lib/pageScroll.ts`, `components/primitives/useScrollCondensed.ts`, `components/BottomSheet/useBodyScrollLock.ts`, `components/PullToRefresh.tsx` |
| Each level's place | `lib/trailScroll.ts`, used in `components/admin/AdminDashboard.tsx` and `components/admin/CommandCenter/StringingPage.tsx` |
| The rule | `.claude/rules/app-shell.md` (Tabs are KEPT) |
