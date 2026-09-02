#!/bin/bash
# SessionStart hook for the badminton-app.
#
# Surfaces the one piece of per-project state still worth announcing before
# the first edit: feature flags past their removal date, plus any flag /
# workflow drift — by running the same check the PostToolUse hook runs,
# `scripts/check-flag-sync.mjs`. That script prints nothing when there is
# nothing to say, so a clean repo starts a silent session.
#
# It used to surface two other things: releases "soaking on bpm-next" and the
# `bpm confirm` high-risk-ops list. Both concepts were retired in August 2026
# (one deployment since 2026-08-25; the confirm gate removed 2026-08-21) and
# the hook kept announcing them for weeks. If you add a surface here, give it a
# retirement condition.
#
# Never blocks: check-flag-sync exits 1 on drift, but a session should still
# start — the PostToolUse copy of the same check fails the edit that matters.
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
node "$REPO_ROOT/scripts/check-flag-sync.mjs" 2>&1 || true
