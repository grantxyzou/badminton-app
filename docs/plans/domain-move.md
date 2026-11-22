# Move the app to motioncraft-bpm.com

**Track:** Stage-2 multi-group (`docs/plans/multi-group.md`): the store apps and every club reach the app through one address, and it should be the platform's, not a personal one.
**Status:** intent
**Review on:** 2026-12-20 — is BPM Core on payment forwarding with the script uninstalled (`docs/plans/payments-forwarding.md` phase 3)? This plan starts only after it.

## Problem

Grant, 2026-11-22: "If I need to switch domain from grantzou for the entire app to motioncraft?"

Motioncraft-BPM, Grant's sole proprietorship, is the platform that runs BPM for every club. The app lives on `bpm.grantzou.com`, a personal domain, so every club, both store apps and every link a member has saved point at Grant personally. Nothing is broken; the cost of moving grows with every club, every store build and every Gmail script pasted with the old address in it.

## Kill criterion

The move is done when `bpm.grantzou.com` has carried no traffic but redirects for 30 days. If, after the cut-over, sign-in fails on either store app or a club's payments stop arriving and the cause is the move, roll the DNS back to the old host the same day: both names keep serving until phase 4.

## Non-goals

- Changing the `/bpm` path, the app service, or anything in Azure but its host names.
- A marketing site at the new domain's root.
- Moving the forwarding mailbox. It is on `motioncraft-bpm.com` from day one so it never moves (`docs/plans/payments-forwarding.md`).

## What carries the domain today (inventory, 2026-11-22)

From `grep -rl grantzou.com` outside `docs/`, grouped by who has to act:

| Where | What changes | Who |
|---|---|---|
| Azure App Service | Add the new host name and a managed certificate | Grant, portal |
| DNS at Squarespace | A CNAME for the new host to `vnext-badminton-app` | Grant |
| `APP_ORIGIN`, `NEXT_PUBLIC_BASE_URL` (`.github/workflows/deploy-next.yml`) | The new origin; links in emails, invites, QR codes and calendar files follow it (`lib/appOrigin.ts`) | Build |
| `.github/workflows/tick.yml`, `deploy-next.yml`'s health check, `scripts/smoke-prod.mjs` | The URL they call | Build |
| `lib/calendarEvent.ts` | The calendar UID host. Changing it makes every member's calendar see NEW events, so keep the old host in the UID on purpose | Build: decide, don't follow |
| Apple and Google sign-in | Register the new redirect URLs in both consoles; keep the old ones until phase 4 | Grant, consoles |
| Stripe Connect webhook | Point it at the new URL | Grant, Stripe |
| `.well-known` files (`proxy.ts`: `APPLE_APP_SITE_ASSOCIATION`, `ANDROID_ASSET_LINKS`) | Served on the new domain too | App Settings |
| iOS: `ios/App/App/App.entitlements` (`applinks:`, `webcredentials:`), `capacitor.config.ts` (`server.url`), `components/NativeBridge.tsx` (`HOST`) | The new host, keeping the old one in the entitlements and the bridge until phase 4 | Store build |
| Android: `AndroidManifest.xml` App Links host, `capacitor.config.ts` | Same | Store build |
| Widgets: `BpmWidgetPlugin.swift` / `.java` allowed hosts | Already list `motioncraft-bpm.com`; add the exact new host if it is a subdomain | Store build |
| `native/www/index.html` | The fallback redirect | Store build |
| Blob storage CORS (`scripts/assets/storage-setup.sh`) | Add the new origin | Grant, one command |
| Gmail scripts still installed | `BPM_URL` names the old host in each club's copy | Every organiser still on the script; phase 3 of the forwarding plan exists so there are none |
| Members' sessions | Cookies are per host, so everyone signs in once on the new host | Members, once |

The store builds are the long pole: an app already installed keeps loading the URL baked into it until the member updates. The old host must therefore keep serving the app, not just redirect, until the update has been out long enough (phase 4).

## Steps

The two plans run as one workplan; the order is what makes each move cheap.

**Phase A — Forwarding pilot (`payments-forwarding.md` steps 0–2).** `pay@` as an alias on Grant's account, BPM Core only. No domain work.

**Phase B — Dedicated mailbox before a second club forwards.** The alias becomes its own `pay@` user. Same address, so no organiser changes anything.

**Phase C — Every club off the script.** After this, no copy of the app's URL lives anywhere the app cannot change.

**Phase D — The new host serves alongside the old (this plan, phase 1).**
1. Decide the host: `app.motioncraft-bpm.com` (recommended: the domain root stays free for Motioncraft's own page) or the root itself.
2. Azure host name and certificate; DNS; `.well-known` on both hosts; storage CORS; Apple, Google and Stripe gain the new URLs beside the old.
3. Both hosts serve the full app. Nothing redirects yet.

**Phase E — The new host becomes the address (phase 2).**
1. `APP_ORIGIN` and `NEXT_PUBLIC_BASE_URL` switch, so every new link, invite, QR code and email points at the new host. Deploy.
2. Ship store builds whose `server.url` is the new host, with both hosts in the app-link and credential entitlements.
3. The old host shows members a one-time "BPM has moved — sign in again here" page on the web, and keeps serving the installed store apps.

**Phase F — The old host only points onward (phase 3).** Once most store installs are on the new build (Play Console and App Store Connect show the version spread), the old host stops serving the app and serves one small page instead. It cannot be a plain server redirect: an installed app on an old build would follow it to a host outside its Capacitor config, and Capacitor opens that in the system browser, bouncing the member out to Safari. The shell sets no user agent of its own, so the page decides in the browser with `isNative()` (`lib/native.ts`): in a browser it moves on to the new host at once; in the app it says "Update BPM from the App Store / Google Play". API calls on the old host answer 410.

**Phase G — Clean-up (phase 4), 30 days after F.** Drop the old host from the consoles, Stripe, entitlements, CORS and Azure. Keep the DNS name pointing at a redirect for as long as the domain is owned.

## Decisions

- **2026-11-22 — Forwarding first, domain second.** Every club still on the Gmail script has the old URL pasted into it, which only that organiser can edit; forwarding carries no app URL at all. Moving clubs to forwarding first leaves nothing outside the app that names the old host except installed store apps, which phase E handles.

## Shape

Filled in as it is built.
