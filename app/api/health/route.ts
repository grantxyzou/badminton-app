import { NextResponse } from 'next/server';

/**
 * GET /api/health — App Service's health-check probe (portal: Diagnose and
 * solve problems → Health check, path `/bpm/api/health`).
 *
 * A LIVENESS answer only: the Node process is up and Next is routing. It
 * reads nothing. Azure acts on a failing probe by pulling the instance out of
 * the load balancer and, after an hour, replacing it — which cures a stuck
 * process and does nothing for a database outage. A probe that read Cosmos
 * would recycle a healthy server every time Cosmos blinked, so the database
 * is `scripts/smoke-prod.mjs`'s job (it reads `/api/releases`), not this one.
 *
 * Public, unthrottled and stateless on purpose: Azure calls it about once a
 * minute from an internal address, and a 401 or 429 would read as "down".
 * The build id it returns is already in every page's `bpm-build` meta tag.
 */
export const dynamic = 'force-dynamic';

export function GET() {
  return NextResponse.json(
    { ok: true, build: process.env.NEXT_PUBLIC_GIT_SHA ?? 'dev' },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
