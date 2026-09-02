#!/usr/bin/env bash
#
# One-command local demo of the skill follow-ups (drills, kudos, level).
#
# Boots the offline mock store (no Cosmos) with a "just played" session so the
# post-session surfaces render, every feature flag on, and an admin seeded.
#
#   bash scripts/dev-demo.sh            # drills + kudos (give + received) + level
#   PORT=3105 bash scripts/dev-demo.sh  # use a different port
#
# Then open http://localhost:<PORT>/bpm, go to Profile, and sign in as
# Lin / 2468. Everything is private, so you MUST sign in to see the cards.
#
# There used to be a GEAR=1 mode that switched the assessment spine OFF to
# surface the gear card instead; the spine's flags retired in 2026-09, so it is
# always on and that mode is gone.
set -euo pipefail

PORT="${PORT:-3100}"

echo "▶ Drills + kudos (give & received) + level will show."

echo "▶ http://localhost:${PORT}/bpm  →  Profile → sign in as Lin / 2468 → Stats"
echo ""

NEXT_PUBLIC_BASE_PATH=/bpm \
COSMOS_CONNECTION_STRING= \
SEED_DEV_SCENARIO=played-thursday \
SEED_DEV_ADMIN=Grant:1130 \
SESSION_SECRET="${SESSION_SECRET:-dev-demo-session-secret-not-for-production-32}" \
NEXT_PUBLIC_FLAG_VALUE_HUB_SLICE=true \
NEXT_PUBLIC_FLAG_KUDOS=true \
  npm run dev -- --port "${PORT}"
