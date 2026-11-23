#!/usr/bin/env bash
# One GitHub issue per failing target (docs/plans/e2e-test-club.md, step 5).
#
#   bash e2e/issue.sh <mock|prod> <failure|success>
#
# failure: open "E2E tour failing (<target>)" with the run's summary, or, when
#          one is already open, add the new run to it as a comment — one issue
#          per stretch of red, not one per run.
# success: close that issue, if open, saying which run passed.
#
# Runs in GitHub Actions with GH_TOKEN (issues: write). The body is
# e2e/summary.mjs's output: labels, screens and paths only, never a password,
# an address or a query string (e2e/capture.ts).
set -euo pipefail

target="${1:?target: mock or prod}"
outcome="${2:?outcome: failure or success}"
label="e2e-failure"
title="E2E tour failing (${target})"
run_url="${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}"

open_issue=$(gh issue list --label "$label" --state open --json number,title \
  --jq ".[] | select(.title == \"${title}\") | .number" | head -n 1)

if [ "$outcome" = "failure" ]; then
  body=$(mktemp)
  {
    echo "**Run:** ${run_url}"
    echo
    node e2e/summary.mjs
  } > "$body"
  gh label create "$label" --color B60205 --description "The E2E tour is failing" --force > /dev/null
  if [ -n "$open_issue" ]; then
    gh issue comment "$open_issue" --body-file "$body"
  else
    gh issue create --title "$title" --label "$label" --body-file "$body"
  fi
elif [ -n "$open_issue" ]; then
  gh issue close "$open_issue" --comment "Passing again: ${run_url}"
fi
