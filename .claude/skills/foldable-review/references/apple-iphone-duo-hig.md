# Apple — Designing for iPhone Duo (Human Interface Guidelines)

Source: https://developer.apple.com/design/human-interface-guidelines/designing-for-iphone-duo
Change log: "September 9, 2026 — New page. Introduces the fundamental concepts
of designing for iPhone Duo, including device poses, dynamic layouts across
dual displays, and toolbars and tab bars on the vertical axis."

Fetched 2026-11-04 from Apple's documentation JSON. Quotes are Apple's words;
the headings and the notes marked *BPM* are ours. Re-fetch if the change log
has moved on.

## Contents

- The device (anatomy, poses)
- Best practices (the six rules)
- Dynamic layouts and reserved regions
- Split views and arrangement views
- Vertical controls
- What the web sees (WebKit, Safari 27.1)
- The developer API we use

## The device

"iPhone Duo has two displays, each with its own front-facing camera. A hinge
in the center lets people open and close the device, and supports a variety of
ways to hold and position it."

"People interact with the outer display when the device is closed, and the
system places toolbars and tab bars on the side to maximize the vertical space
for content. The controls remain on the side when the device opens in
landscape."

"The outer front-facing camera is in the corner and is always visible,
vertically aligned with controls on the side. The inner camera is behind the
display and stays hidden until the camera is active."

Poses: "partially folded like a book, placed down on a surface, or standing on
its edges."

"Supporting the device's various poses doesn't mean designing a custom layout
for each one: instead, use size classes so your app adapts naturally as it
changes size. A compact width layout for the outer display and a regular width
layout for the inner display give you the fundamentals for every pose. Don't
reinvent your app when it resizes; allow the existing layout to expand based
on the available space instead."

*BPM:* our two "size classes" are the one column (every phone) and the two
panes (the CSS pane query). Folding is a resize the layout follows.

## Best practices

1. **Build your app to resize.** "Use size classes, layout margins, and safe
   area insets to lay out controls and content. Avoid fixed widths and
   display-specific dependencies."
2. **Create a consistent experience across displays.** "Keep functionality and
   the state of elements the same between displays. Maintain your app's
   information hierarchy, but show an additional level of hierarchy on the
   larger inner display if it makes sense for your content. Mail, for
   example, shows either a list of emails (primary) or an email (secondary)
   when the device is closed. When it's open, it shows both side by side."
   *BPM:* Mail's primary is on the LEFT. Ours is on the right by the owner's
   decision (the page that opens); the "one more level side by side" idea is
   what the two panes are.
3. **Maintain the same functionality across device poses.** "Provide access to
   the same controls and content regardless of how someone holds or views the
   device."
4. **Follow the system's vertical layout for toolbars, tab bars, and
   navigation controls.** "Because the outer display is wider and shorter than
   the display on other iPhone devices, the system moves controls to the side
   to preserve vertical space for content and reflect the asymmetry of the
   display. On the inner display, controls remain on the side in landscape to
   preserve a continuous experience at the same vertical height."
5. **Make your game playable in every device pose** (games; not ours).
6. (Under reserved regions) **Avoid extreme layout changes as people fold the
   device.** "Move only what's necessary to keep elements visible and easy to
   tap. Controls that disappear or shift dramatically are harder to find and
   track, so favor small adjustments over rearrangement."

## Dynamic layouts and reserved regions

"Reserved regions ... represent areas within the display that content avoids
covering, or that components adapt to accommodate."

The three regions:
- "The outer front-facing camera. This region is always present, and expands
  into the Dynamic Island for Live Activities."
- "The inner front-facing camera. This region is only present when the camera
  is active."
- "The folding region. This region is conditional based on how a person uses
  the device. When the device is partially open, the folding region divides
  the inner display into multiple usable regions, excluding the region at the
  center as the display folds."

"Many system components automatically adapt to reserved regions. Components
like alerts, context menus, and sheets automatically move to account for the
fold."

"Adapt your layout when the device folds. Prefer a layout container that
adapts automatically ... In a grid-style layout, prefer an even number of
columns so content divides cleanly."

*BPM:* two panes is the even number of columns; the gap in the exact centre is
how a web page keeps the folding region empty without being told where it is.

## Split views and arrangement views

"On iPhone Duo, a split view expands on the inner display and collapses to a
single pane on the outer display."

"An arrangement view is a layout container that holds two views inside it — a
primary view and a secondary view — and dynamically organizes them based on
display size, orientation, and reserved regions." Two kinds: a **split**
arrangement ("splits horizontally when the arrangement is wider than it is
tall, and splits vertically when the arrangement is taller than it is wide")
and an **overlay** arrangement ("When the display is partially folded, the
views move to occupy each side; otherwise the primary view moves atop the
secondary view").

"Keep navigation outside of arrangement views."

*BPM:* the courtside scoreboard is a split arrangement drawn by hand: board on
one side of the fold, buttons on the other, axis from the fold's shape.

## Vertical controls

"On iPhone Duo, toolbars, tab bars, and navigation controls that are typically
at the top and bottom of the display move to the side, preserving vertical
space for content and keeping controls within easy reach. The exception is the
inner display in portrait, which has enough vertical space to keep standard
horizontal bars."

"Controls on the side include both system and app elements: the Dynamic
Island, the status bar, the toolbar (including navigation buttons), and the
tab bar."

"Account for asymmetry in your layouts. Because controls sit along one edge,
the space for content is asymmetrical. Use safe areas to make sure controls
don't cover your content."

"Keep controls consistent across device poses ... keep controls' relative
positions as similar as possible so people don't have to relearn where
actions live as they change between poses."

"Follow the standard placement order for toolbar items. Reserve the top of the
vertical axis for primary navigation controls, like Back or Close, followed by
prominent actions, like Done."

"In general, don't override the default bar placement. The position of
controls on the vertical axis is one of the core patterns of iPhone Duo."

"Keep text-based buttons to a minimum. Labels that include text stay in a
horizontal bar, so prefer a symbol wherever one works."

*BPM:* our side tab bar keeps the four tabs in their bottom-bar order, top to
bottom, with the round buttons stacked above — relative positions kept. Left
padding mirrors the strip so the panes' gap stays on the hinge.

## What the web sees (WebKit, Safari 27.1)

From https://webkit.org/blog/18486/webkit-features-for-safari-27-1/ (read the
same day):

- Viewport sizes in CSS px: outer portrait **382** wide (580–618 tall); outer
  landscape **594** × 368–406; inner portrait **669** × 867–902; inner
  landscape **951** × 585–620; two windows side by side **385** wide.
- The Device Posture API (`navigator.devicePosture.type`: `folded` /
  `continuous`, a `change` event) and the Viewport Segments API
  (`window.viewport.segments`, the `horizontal-viewport-segments` /
  `vertical-viewport-segments` media features, the `viewport-segment-*`
  env variables) are a developer PREVIEW behind Settings → Apps → Safari →
  Advanced → Feature Flags. Ordinary users do not have them.
- "Safari 27.1 does not yet let web content fill the space behind the outer
  display's side controls"; the page's background colour is extended there.
- Chrome on Android foldables ships both APIs (Device Posture since Chrome
  132, Viewport Segments since Chrome 138).

*BPM:* this is why `lib/fold.ts` has three sources and why "unknown is not
flat". On an iPhone the web app will usually not know; the store app's plugin
is the only reliable source there.

## The developer API we use

`UIView.reservedRegions(kind:options:)` (iOS 27): "A division region is an
area that splits your view into separate parts, such as the fold of iPhone
Duo. A division is active only when the device is partially open or closed.
When iPhone Duo is fully open, the division is inactive." Its `frame` is in
the view's own coordinates, "and the values are in points"; it "already
includes the region's margins".

*BPM:* read off the WebView, points are the page's CSS pixels, which is what
`BpmFoldPlugin.swift` hands to `lib/fold.ts`. The HIG mentions "a hinge API"
for the angle; its name is not on the pages fetched and nothing here needs it.
