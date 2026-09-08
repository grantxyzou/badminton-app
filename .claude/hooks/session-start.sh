#!/bin/bash
# SessionStart hook for the badminton-app.
#
# Surfaces the per-project state worth announcing before the first edit. Two
# checks, and they are the same idea pointed at different things: something was
# promised for a date, and the date has passed.
#
#   - `scripts/check-flag-sync.mjs`     — flags past their removal date, plus
#                                         flag/workflow drift.
#   - `scripts/check-plan-reviews.mjs`  — plan docs past their `Review on:` date.
#
# Both print nothing when there is nothing to say, so a clean repo starts a
# silent session. The second exists because a kill criterion with no scheduled
# read is a note rather than a gate — `docs/plans/value-hub-slice-0.md` carried
# an honest one and went unread for nine weeks.
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
node "$REPO_ROOT/scripts/check-plan-reviews.mjs" 2>&1 || true
