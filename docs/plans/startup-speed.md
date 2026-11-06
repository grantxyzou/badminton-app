# Startup speed: ask once, pictures with their tab, grouped deploys

**Track:** North Star — the app members open every week; a slow open is paid on every visit.
**Status:** shipped 2026-11-05 (waiting on the launch screen's short finish, below)
**Review on:** 2026-11-19 — has Grant (or a member) said opening, coming back or switching tabs feels faster; and has any merge needed "Run workflow" because three deploys a day were too slow?

## Problem

Grant, 2026-11-05: "this app is getting really slow. And I'm wondering if there's any ways that we can optimize end-to-end", then which kind: "Opening the app, Sometimes switching Apps and switching tabs, waiting on loading placeholder … It takes a split second to load out the string aset like the renders".

## Kill criterion

A refetch after a write shows the answer from before it (the one thing the reuse below must never do), or a fix waits on a deploy long enough that someone notices. Either undoes its half.

## Non-goals

- The launch screen's hold. Measured below; changing it reverses Grant's call of 2026-10-21 ("let the full animation play end to end at least once"), so it waits on his answer.
- Scroll smoothness ("that's fine").
- Server-side reads: the full audit (#801) took the big one (Home's full scan of `players`).

## What was measured

A production build of the app on the mock store, played as a mid-range phone: 4× slowed CPU, 150 ms round trips, about 1.6 Mbit/s. Real numbers are worse, since the mock store answers in milliseconds and Azure does not.

| | Before | After |
|---|---|---|
| Requests to open the app | 35 (about 10 asked twice) | 27 |
| Home ready behind the launch screen | 1.2 s | 1.1–1.3 s |
| Launch screen gone | 2.1 s | 2.0–2.2 s (the hold, unchanged) |
| Code re-downloaded by a deploy that changes no code | 179 KB (54 KB compressed) | 0 KB |
| Equipment, first tap on a second open of the app | (gear read + picture download each time) | 0.3 s |
| Equipment, tapped again | remount: skeleton and a round trip | 0.17 s |
| First open after an update (cold cache) | 4.7 s, 783 KB | 4.5 s, 711 KB (with #801) |

## Decisions

- **Reuse a landed answer only while nothing was written.** `sharedFetch` had no tail on purpose: a refetch after a write must reach the server. The tail added here (8 s) is void the moment the page sends any non-GET request (`watchWrites`), except the usage beacons, which append to a log nothing reads back. The first cut counted the beacons and saved nothing — they fire on every open.
- **Pictures load with their tab.** `loading="lazy"` inside a tab opened hidden waits for the tap; packets load eagerly, list rows at low priority. The member's own head and packet are fetched while the other tabs open, from addresses the Equipment card remembers on the phone (catalog paths only; forgotten at sign-out).
- **The bag is kept for the page load**, so the register switch's remount draws at once and re-reads behind it.
- **Deploys three times a day, off-peak**, skipped when only notes changed; "Run workflow" ships at once. Every deploy restarts the server (its caches empty) and renamed the code files it touched, which every phone downloads again; the commit was inlined into two large chunks, so even a docs merge cost every phone 54 KB. The commit is now read from the page's `bpm-build` tag at run time.

## The short finish (not built)

The launch screen holds about 0.9 s after Home is ready, finishing its shot. A short finish would land the shuttle in about 0.4 s and fade in 0.15 s when Home is already ready — saving roughly half a second on every open and every return after iOS drops the app.

## Shape

| Piece | File |
|---|---|
| Write-aware reuse | `lib/sharedRead.ts` (`watchWrites`, `SETTLED_SHARE_MS`), installed in `components/HomeShell.tsx` |
| Pictures with their tab | `components/stringing/StringPackImage.tsx`, `lib/warmPictures.ts`, `components/stats/GearSetupCard.tsx`, `lib/clearDeviceTraces.ts` |
| The bag across remounts | `components/stats/gearMemory.ts`, `components/stats/useGear.ts` |
| Build tag at run time | `lib/buildSha.ts` (Profile, the preview banner) |
| Grouped deploys | `.github/workflows/deploy-next.yml` (`decide` job) |
| Tests | `__tests__/shared-read-settled.test.ts`, `__tests__/warm-pictures.test.ts`, `__tests__/components/useGear.test.tsx`, `__tests__/setup/reset-page-memory.ts` |
