#!/usr/bin/env bash
#
# One-command local demo of the three skill follow-ups (gear, drills, kudos).
#
# Boots the offline mock store (no Cosmos) with a "just played" session so the
# post-session surfaces render, every feature flag on, and an admin seeded.
#
#   bash scripts/dev-demo.sh            # drills + kudos (give + received) + level
#   GEAR=1 bash scripts/dev-demo.sh     # the gear recommendation card
#   PORT=3105 bash scripts/dev-demo.sh  # use a different port
#
# Then open http://localhost:<PORT>/bpm, go to Profile, and sign in as
# Lin / 2468. Everything is private, so you MUST sign in to see the cards.
#
# Why two modes: the gear card is parked whenever the skill-assessment spine is
# on (deliberate). GEAR=1 flips the spine off so the gear card shows; the
# default leaves it on so the drills/kudos/level cards show.
set -euo pipefail

PORT="${PORT:-3100}"

# The gear card only renders with the assessment spine OFF; everything else
# needs it ON. Default = spine on (drills/kudos/level); GEAR=1 = spine off (gear).
if [[ "${GEAR:-}" == "1" ]]; then
  ASSESS=false
  echo "▶ GEAR mode: assessment spine OFF — the gear recommendation card will show."
else
  ASSESS=true
  echo "▶ Default mode: drills + kudos (give & received) + level will show."
  echo "  (run with GEAR=1 to see the gear card instead.)"
fi

echo "▶ http://localhost:${PORT}/bpm  →  Profile → sign in as Lin / 2468 → Stats"
echo ""

NEXT_PUBLIC_BASE_PATH=/bpm \
COSMOS_CONNECTION_STRING= \
SEED_DEV_SCENARIO=played-thursday \
SEED_DEV_ADMIN=Grant:1130 \
SESSION_SECRET="${SESSION_SECRET:-dev-demo-session-secret-not-for-production-32}" \
NEXT_PUBLIC_FLAG_VALUE_HUB_SLICE=true \
NEXT_PUBLIC_FLAG_SKILL_ASSESS="${ASSESS}" \
NEXT_PUBLIC_FLAG_SKILL_LEVEL=true \
NEXT_PUBLIC_FLAG_SKILL_CALIBRATION=true \
NEXT_PUBLIC_FLAG_SKILL_SMOOTHING=true \
NEXT_PUBLIC_FLAG_SKILL_DRILLS=true \
NEXT_PUBLIC_FLAG_KUDOS=true \
  npm run dev -- --port "${PORT}"
