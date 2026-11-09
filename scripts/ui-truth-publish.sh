#!/usr/bin/env bash
# Publish ui-truth screenshots so a GitHub issue can show them.
#
#   scripts/ui-truth-publish.sh <slug> <image.png>...
#
# Copies the images to <date>/<slug>/ on the orphan branch `ui-truth-shots`
# (no shared history with main, never merged, never deployed), pushes, and
# prints a Markdown image line per file to paste into the issue.
# The repo is public, so raw.githubusercontent.com serves them to anyone.
set -euo pipefail

slug="${1:?usage: ui-truth-publish.sh <slug> <image.png>...}"
shift
[ "$#" -gt 0 ] || { echo "no images given" >&2; exit 1; }

BRANCH=ui-truth-shots
repo_root="$(git rev-parse --show-toplevel)"
remote_url="$(git -C "$repo_root" remote get-url origin)"
owner_repo="$(printf '%s' "$remote_url" | sed -E 's#(git@github.com:|https://github.com/)##; s#\.git$##')"
day="$(date +%Y-%m-%d)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

if git -C "$repo_root" ls-remote --exit-code --heads origin "$BRANCH" >/dev/null 2>&1; then
  git clone --quiet --depth 1 --branch "$BRANCH" "$remote_url" "$work/shots"
else
  git init --quiet "$work/shots"
  git -C "$work/shots" checkout --quiet --orphan "$BRANCH"
  printf '# ui-truth screenshots\n\nImages for `ui-proposal` issues. Never merged into main.\n' > "$work/shots/README.md"
  git -C "$work/shots" remote add origin "$remote_url"
fi

dest="$work/shots/$day/$slug"
mkdir -p "$dest"
for f in "$@"; do cp "$f" "$dest/"; done

git -C "$work/shots" add -A
# Re-publishing the same image for the same day and slug changes nothing, and
# `git commit` exits 1 on an empty commit, which `set -e` turned into a stop
# before the URLs below were printed. The images are already up; print them.
if git -C "$work/shots" diff --cached --quiet; then
  echo "unchanged — already published" >&2
else
  git -C "$work/shots" commit --quiet -m "ui-truth: $day $slug"
  git -C "$work/shots" push --quiet origin "$BRANCH"
fi

for f in "$@"; do
  name="$(basename "$f")"
  echo "![${name%.*}](https://raw.githubusercontent.com/$owner_repo/$BRANCH/$day/$slug/$name)"
done
