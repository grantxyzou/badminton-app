#!/usr/bin/env bash
# Launch + drive the BPM Badminton app offline (mock store), end-to-end.
# Zero install: dev server + curl + headless Chrome (already on the machine).
#
# What it proves, in order:
#   1. Dev server boots in MOCK-STORE mode (no Cosmos, no prod data touched).
#   2. The seeded session is reachable through the /bpm basePath.
#   3. A member (Lin) signs in, signs up, and shows up in the roster.
#   4. The admin (Grant) signs in and passes an admin-only read that Lin is refused.
#   5. The signed-out Welcome page renders (headless screenshot to disk).
#
# Members only: every club read and every sign-up needs a signed-in member, so
# each step carries its own cookie jar. The seeds are fresh-thursday's Lin
# (PIN 2468, a plain member) and SEED_DEV_ADMIN's Grant (PIN 1130).
#
# Usage:   bash .claude/skills/run-badminton-app/smoke.sh
# Env:     PORT (default 3100)   KEEP=1 to leave the server running
#
# Run from the repo root. Paths below are relative to it.
set -euo pipefail

PORT="${PORT:-3100}"
BASE="http://localhost:${PORT}/bpm"
OUT="${OUT:-/tmp/bpm-shots}"
mkdir -p "$OUT"
LOG="$(mktemp)"
LIN_JAR="$(mktemp)"
ADMIN_JAR="$(mktemp)"

# Headless Chrome lives in different places per OS — take the first that exists.
CHROME=""
for c in \
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  "$(command -v google-chrome || true)" \
  "$(command -v chromium || true)" \
  "$(command -v chromium-browser || true)"; do
  [ -n "$c" ] && [ -x "$c" ] && { CHROME="$c"; break; }
done

# CRITICAL: NEXT_PUBLIC_BASE_PATH must equal next.config's basePath (/bpm) or
# every CLIENT fetch hits /api/* (no prefix) -> 404 -> the app shows "You're
# offline / Couldn't load" even though the server is fine. next.config does not
# export it and this script reads no .env.local, so it is passed explicitly.
# COSMOS_CONNECTION_STRING= (empty) forces the in-memory mock store.
# SEED_DEV_SCENARIO seeds a populated, signup-open session offline.
# A server already on this port would answer every check below with ITS data,
# not this run's — refuse rather than test the wrong server.
if curl -s -o /dev/null "http://localhost:${PORT}"; then
  echo "FAIL: something is already listening on :$PORT — stop it or set PORT"; exit 1
fi
echo "==> launching dev server on :$PORT (mock store)…"
NEXT_PUBLIC_BASE_PATH=/bpm \
COSMOS_CONNECTION_STRING= \
SEED_DEV_SCENARIO=fresh-thursday \
SEED_DEV_ADMIN=Grant:1130 \
  npm run dev -- --port "$PORT" >"$LOG" 2>&1 &
SERVER_PID=$!

cleanup() {
  if [ "${KEEP:-0}" != "1" ]; then
    kill "$SERVER_PID" 2>/dev/null || true
    # `npm run dev` forks the Next server; killing npm alone leaves it holding
    # the port, and the next run then tests that stale server.
    PIDS=$(lsof -ti "tcp:$PORT" 2>/dev/null || true)
    [ -n "$PIDS" ] && kill $PIDS 2>/dev/null || true
    rm -f "$LIN_JAR" "$ADMIN_JAR"
    echo "==> server stopped (pid $SERVER_PID)"
  else
    echo "==> server LEFT RUNNING: pid $SERVER_PID  url $BASE  (kill $SERVER_PID when done)"
  fi
}
trap cleanup EXIT

echo "==> waiting for readiness…"
for i in $(seq 1 40); do
  curl -sf -o /dev/null "$BASE" && break
  sleep 1
  [ "$i" = 40 ] && { echo "FAIL: server never came up"; tail -20 "$LOG"; exit 1; }
done

# Mock-store proof: the seed log only fires when COSMOS is unset (the seed
# functions early-return when real Cosmos is configured). The seed runs on the
# first read of `sessions`/`members`/`memberships`/`groups`, and a signed-out
# page reads none of them (members only), so wake it with a READ-ONLY request
# that writes nothing even against a real database: the invite preview for a
# made-up token, which point-reads `groups` and answers 404.
curl -s -o /dev/null "$BASE/api/groups/preview?token=00000000000000000000000000000000"
sleep 1
grep -q "Mock store only" "$LOG" \
  && echo "PASS: mock store confirmed (no Cosmos)" \
  || { echo "FAIL: not in mock mode — refusing to continue (prod-data risk)"; exit 1; }

echo "==> member: Lin signs in, signs up, appears on the roster…"
JSON='Content-Type: application/json'
LOGIN_CODE=$(curl -s -o /dev/null -w '%{http_code}' -c "$LIN_JAR" -X POST "$BASE/api/players/recover" \
  -H "$JSON" -d '{"name":"Lin","pin":"2468"}')
[ "$LOGIN_CODE" = "200" ] && echo "PASS: Lin signs in -> 200" \
  || { echo "FAIL: Lin sign-in returned $LOGIN_CODE"; exit 1; }

# The server takes the name from Lin's account; the body's name is ignored.
SIGNUP_CODE=$(curl -s -o /dev/null -w '%{http_code}' -b "$LIN_JAR" -X POST "$BASE/api/players" \
  -H "$JSON" -d '{}')
[ "$SIGNUP_CODE" = "201" ] && echo "PASS: POST /api/players -> 201" \
  || { echo "FAIL: signup returned $SIGNUP_CODE"; exit 1; }

ROSTER=$(curl -s -b "$LIN_JAR" "$BASE/api/players")
echo "$ROSTER" | grep -q '"name":"Lin"' \
  && echo "PASS: roster now contains Lin" \
  || { echo "FAIL: Lin not in roster: $ROSTER"; exit 1; }

echo "==> admin: Grant signs in; the admin-only read lets him in and refuses Lin…"
ADMIN_CODE=$(curl -s -o /dev/null -w '%{http_code}' -c "$ADMIN_JAR" -X POST "$BASE/api/admin" \
  -H "$JSON" -d '{"name":"Grant","pin":"1130"}')
[ "$ADMIN_CODE" = "200" ] && echo "PASS: Grant admin sign-in -> 200" \
  || { echo "FAIL: admin sign-in returned $ADMIN_CODE"; exit 1; }

SETTINGS_ADMIN=$(curl -s -o /dev/null -w '%{http_code}' -b "$ADMIN_JAR" "$BASE/api/admin/settings")
SETTINGS_LIN=$(curl -s -o /dev/null -w '%{http_code}' -b "$LIN_JAR" "$BASE/api/admin/settings")
[ "$SETTINGS_ADMIN" = "200" ] && [ "$SETTINGS_LIN" = "401" ] \
  && echo "PASS: /api/admin/settings -> 200 for Grant, 401 for Lin" \
  || { echo "FAIL: admin settings gave Grant $SETTINGS_ADMIN and Lin $SETTINGS_LIN (want 200 / 401)"; exit 1; }

# The page renders in headless Chrome. Signed out, members-only serves the
# Welcome screen, so this proves the page builds and paints, not Home's data;
# the curl checks above are the source of truth for data. To look at a signed-in
# screen, use the verify-ui skill.
if [ -n "$CHROME" ]; then
  echo "==> screenshot the signed-out Welcome page -> $OUT/welcome.png"
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars \
    --window-size=440,900 --virtual-time-budget=10000 \
    --screenshot="$OUT/welcome.png" "$BASE" >/dev/null 2>&1 || true
  [ -s "$OUT/welcome.png" ] && echo "PASS: wrote $OUT/welcome.png" \
    || echo "WARN: screenshot not written (Chrome path? headless flags?)"
else
  echo "WARN: no Chrome/Chromium found — skipped screenshot (curl checks still ran)"
fi

echo "==> SMOKE OK"
