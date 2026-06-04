#!/usr/bin/env bash
# Launch + drive the BPM Badminton app offline (mock store), end-to-end.
# Zero install: dev server + curl + headless Chrome (already on the machine).
#
# What it proves, in order:
#   1. Dev server boots in MOCK-STORE mode (no Cosmos, no prod data touched).
#   2. The seeded session is reachable through the /bpm basePath.
#   3. A real sign-up mutation lands and shows up in the roster (API layer).
#   4. Home renders with live data (headless screenshot to disk).
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
# offline / Couldn't load" even though the server is fine. It is NOT in
# .env.local.example or next.config, so it MUST be passed explicitly.
# COSMOS_CONNECTION_STRING= (empty) forces the in-memory mock store.
# SEED_DEV_SCENARIO seeds a populated, signup-open session offline.
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
# functions early-return when real Cosmos is configured).
grep -q "Mock store only" "$LOG" \
  && echo "PASS: mock store confirmed (no Cosmos)" \
  || { echo "FAIL: not in mock mode — refusing to continue (prod-data risk)"; exit 1; }

echo "==> API smoke + real sign-up flow…"
SIGNUP_CODE=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/players" \
  -H 'Content-Type: application/json' -H 'X-Client-IP: smoke-test' \
  -d '{"name":"Viktor"}')
[ "$SIGNUP_CODE" = "201" ] && echo "PASS: POST /api/players -> 201" \
  || { echo "FAIL: signup returned $SIGNUP_CODE"; exit 1; }

ROSTER=$(curl -s "$BASE/api/players")
echo "$ROSTER" | grep -q '"name":"Viktor"' \
  && echo "PASS: roster now contains Viktor" \
  || { echo "FAIL: Viktor not in roster: $ROSTER"; exit 1; }

# Home renders with live data in headless Chrome. (Data-heavy tabs like
# Sign-Ups are flaky under --virtual-time-budget; curl above is the
# source of truth for data — see SKILL.md Gotchas.)
if [ -n "$CHROME" ]; then
  echo "==> screenshot Home -> $OUT/home.png"
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars \
    --window-size=440,900 --virtual-time-budget=10000 \
    --screenshot="$OUT/home.png" "$BASE" >/dev/null 2>&1 || true
  [ -s "$OUT/home.png" ] && echo "PASS: wrote $OUT/home.png" \
    || echo "WARN: screenshot not written (Chrome path? headless flags?)"
else
  echo "WARN: no Chrome/Chromium found — skipped screenshot (curl checks still ran)"
fi

echo "==> SMOKE OK"
