# Racket fidelity

**Track:** none, and deliberately so: it improves already-shipped images (the Equipment register's racket pictures and the 3D viewer, `components/stats/CLAUDE.md`) rather than starting anything.
**Status:** in-flight
**Review on:** 2026-12-02 — has anyone said a racket picture looks wrong (wrong colours, wrong racket)? Spot-check five members' rackets against a photo of the real one.

## Problem

Grant, on the design canvas (2026-11-04), about the Equipment page's racket image: "How can we improve the fidelity of these 3D renders without slowing down the app? I almost want like a realistic 1:1 replica." Then, after a prototype of one racket: "do the accurate version for all the rackets?"

Each racket was one 3D model in three colours (frame, accent, grip) with a shoulder band. A Halbertec 9000 is green on one half, violet on the other, with a black crown, black slashes and a white handle. It was drawn as a teal frame with a purple band, so it read as some racket, not that one.

## Kill criterion

A member's racket picture does not read as their racket at a glance. Check that the colour fields, the fades and the handle colour are in the right places when compared with a photo of the real one.

## Non-goals

- Logos and wordmarks. They are the maker's marks; a likeness does not need them.
- A scan or photo turntable of a real racket. That is the step after this, and it needs the racket in hand.
- Changing what the app downloads. The list images stay 240×624 WebP, rendered ahead of time. The live 3D view stays on the two big sheets.
- Typed-in rackets. They keep the three-colour model and the member's own choices.

## Decisions

- **A livery is data, painted as vertex colours** (`lib/racketLivery.ts`). It covers:
  - colour stops up the head;
  - a different left half;
  - bands and slashes at angles round the head;
  - the shaft's fade, and the cone, cap, trim, collar and grip;
  - a finish;
  - the head outline measured from a face-on photo.

  One spec drives both the pre-rendered images and the live viewer, so they cannot disagree. The table is imported only by `lib/racketModel.ts`, which is reached by a dynamic `import()`. The main bundle carries no paint, and the model is told the catalog id (`ModelLook.liveryId`), not the paint.
- **Every racket got the surface pass, livery or not.** The changes:
  - lacquered paint over a carbon weave;
  - a perforated, octagonal grip;
  - 22 mains with crosses woven over and under;
  - grommets nearly flush;
  - a softbox studio for reflections;
  - images drawn at 2× and scaled down.

  A livery racket also gets the slim 7.8 mm frame and 6.6 mm shaft measured on the Halbertec 9000. The three-colour look keeps Grant's 11 mm section.
- **Neutral tone mapping, not ACES filmic** (`lib/racketStage.ts`). Under ACES a Nanoflare 1000's lightning yellow came out mustard and a white frame grey, and the research agents were over-saturating specs to fight it. Khronos PBR Neutral keeps the highlight rolloff and renders a paint as its colour.
- **The research was eight parallel agents, one per batch of about 20 rackets** (2026-11-04). Each found photos, wrote a spec, rendered it beside the photo and adjusted it. Result:
  - 152 liveries;
  - 22 marked approximate, mostly because only angled photos existed, so no measured shape;
  - 5 rackets with no photo: Victor Arrow Speed 88, Brave Sword 1500 and NitroLite 80X, and Li-Ning Halberd 900 and G-Force Superlite.
- **The four fake rackets were deleted; the fifth was real** (Grant, 2026-11-04: "The 5 with no photo are fake ones. Delete them from the data base").
  - The Brave Sword 1500 is sold as the 1500P Green with Black (gamepointinc.com). It got its livery by hand from two angled photos, so it is approximate.
  - The other four were already withdrawn with `unlisted` as not models (2026-09-14) or not found (2026-10-20). They are gone from the seed JSON, both source files, `RACKET_LOOKS` and the images.
  - `REMOVED_CATALOG_IDS` in `lib/catalogSeed.ts` deletes them from Cosmos on the next seed, because seeding never deletes on its own. A bag already pointing at one keeps its label.
  - Totals now: 153 catalog rackets, all 153 with a livery, 23 of them approximate. Where the photos showed a different colourway from the one listed, the photos won and `RACKET_LOOKS`' colourway names were corrected (14).
- **Colours and outlines were taken from photos by eye and by pixel sampling, never traced.** Each entry records where its photos came from (`source`). A racket with no findable photo keeps its three-colour look; no livery was invented from a colour name.

## Shape

| Piece | File |
|---|---|
| The livery type, its maths and the table | `lib/racketLivery.ts` |
| Painting it, and the surface pass | `lib/racketModel.ts` |
| The studio | `lib/racketStage.ts` |
| The list images | `scripts/render-racket-images.mjs`, `app/design/racket-render/page.tsx`, `public/rackets/` |
| Tests | `__tests__/racket-livery.test.ts` |
