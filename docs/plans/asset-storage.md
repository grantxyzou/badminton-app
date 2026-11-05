# Racket and string pictures in Blob Storage

**Track:** none, and deliberately so: it moves already-shipped images (the racket pictures, `docs/plans/racket-fidelity.md`, and the string packets, `docs/plans/string-packets.md`) out of the repository; nothing a member sees changes.
**Status:** in-flight
**Review on:** 2026-12-03 — is production loading pictures from the storage account (the Network tab names its host), and have they left git?

## Problem

Grant, 2026-11-05, on the Set-up card's close-ups adding about 6 MB to the repository ("Does size matter?" … "I'm down to use blob storage … do it with CLI"). The pictures are generated, not written: every redraw of the rackets re-renders up to 154 + 154 files, and git keeps every old copy forever. Members only ever download a few of them.

## Kill criterion

A picture that loads today fails to load once the pictures come from storage: a broken racket on a card, a blank packet, a share card exported without its racket.

## Non-goals

- A CDN. One storage account in Canada Central, with each picture cached by the phone for a day, is enough for a club app; Azure Front Door's base fee would cost more than the whole App Service plan.
- Moving `brand/`, `icons/` or anything the app cannot run without.
- Shrinking the repository's history. Removing the files stops the growth; the old copies stay in git.

## Decisions

- **One switch, read at build time**: `NEXT_PUBLIC_ASSET_BASE` (e.g. `https://<account>.blob.core.windows.net/public`). `lib/assetUrl.ts` is the only reader; `racketSrc`, `racketHeadSrc` and `stringPackSrc` go through it. Unset, every picture is served by the app itself, exactly as before, so the change ships dark and rolling back is unsetting it.
- **The CSP follows the switch**: `img-src` gains that one origin when it is set, and nothing else.
- **The share card asks for the racket picture with CORS** (`crossOrigin = 'anonymous'`), because a canvas that draws a cross-origin picture without it can no longer be exported. The container's CORS rule allows GET from the production hosts and localhost.
- **The Azure CLI does the infrastructure**, from the owner's machine or Cloud Shell, because this repository holds no Azure credentials (deploys use a publish profile): `scripts/assets/storage-setup.sh` once, `scripts/assets/upload.sh` after every render. Blobs carry the same `Cache-Control` the app sends for `public/rackets` (a day, a week stale).

## Shape

| Step | Who | What |
|---|---|---|
| 1 | Claude, this PR | `lib/assetUrl.ts`, the CSP, CORS on the share card, the two scripts, these docs. Ships with the switch unset. |
| 2 | Grant | `az login`, then `scripts/assets/storage-setup.sh` and `scripts/assets/upload.sh`; send back the base URL it prints. |
| 3 | Claude | Set `NEXT_PUBLIC_ASSET_BASE` in `deploy-next.yml`'s build env; check production loads from storage. |
| 4 | Claude | Remove `public/rackets` and `public/strings` from git; the coverage tests read a committed manifest instead of the folder. |
