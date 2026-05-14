#!/bin/bash
# SessionStart hook for the badminton-app.
#
# Surfaces two pieces of per-project state to Claude:
#   1. `.claude/soak.local.md` — what's soaking on bpm-next
#   2. `.claude/bpm-confirm.local.md` — list of high-risk ops requiring
#      explicit user confirmation before execution
#
# Both files use the plugin-settings pattern (YAML frontmatter + body) and
# are gitignored per-machine state.
#
# Quietly exits 0 when neither file exists.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SOAK_FILE="$REPO_ROOT/.claude/soak.local.md"
CONFIRM_FILE="$REPO_ROOT/.claude/bpm-confirm.local.md"

today_epoch="$(date -j -f "%Y-%m-%d" "$(date +%Y-%m-%d)" "+%s")"

extract_field() {
  # extract_field <file> <field-name> -> first scalar match in frontmatter
  awk -v key="$2" '
    /^---$/ { in_fm = !in_fm; next }
    in_fm && $0 ~ "^"key": " {
      sub("^"key": *", "")
      print
      exit
    }
  ' "$1"
}

print_soak() {
  [[ -f "$SOAK_FILE" ]] || return 0
  local enabled
  enabled="$(extract_field "$SOAK_FILE" enabled)"
  [[ "$enabled" == "false" ]] && return 0

  # Parse simple YAML list (release/pushed/soak_until lines). Not a real
  # YAML parser; matches the format documented in soak.local.md.
  local out=""
  local release="" soak_until="" notes=""
  while IFS= read -r line; do
    if [[ "$line" =~ ^[[:space:]]+-[[:space:]]release:[[:space:]](.+)$ ]]; then
      if [[ -n "$release" ]]; then
        out+="$(format_entry "$release" "$soak_until" "$notes")"
        out+=$'\n'
      fi
      release="${BASH_REMATCH[1]}"
      soak_until=""
      notes=""
    elif [[ "$line" =~ ^[[:space:]]+soak_until:[[:space:]](.+)$ ]]; then
      soak_until="${BASH_REMATCH[1]}"
    elif [[ "$line" =~ ^[[:space:]]+notes:[[:space:]](.+)$ ]]; then
      notes="${BASH_REMATCH[1]}"
    fi
  done < <(awk '/^---$/ {fm++; next} fm == 1' "$SOAK_FILE")
  if [[ -n "$release" ]]; then
    out+="$(format_entry "$release" "$soak_until" "$notes")"
    out+=$'\n'
  fi

  [[ -z "$out" ]] && return 0
  printf '\n📦 Currently soaking on bpm-next:\n%s\n' "$out"
}

format_entry() {
  local release="$1" soak_until="$2" notes="$3"
  if [[ -n "$soak_until" ]]; then
    local until_epoch
    until_epoch="$(date -j -f "%Y-%m-%d" "$soak_until" "+%s" 2>/dev/null || echo 0)"
    if [[ "$until_epoch" != "0" ]]; then
      local days_left=$(( (until_epoch - today_epoch) / 86400 ))
      if (( days_left < 0 )); then
        printf '  • %s — soak expired %d days ago. Promote or extend.\n' "$release" "$(( -days_left ))"
      elif (( days_left == 0 )); then
        printf '  • %s — soak expires today. Decide today.\n' "$release"
      else
        printf '  • %s — %d days left (until %s). %s\n' "$release" "$days_left" "$soak_until" "${notes:-}"
      fi
      return
    fi
  fi
  printf '  • %s — (no soak_until set). %s\n' "$release" "${notes:-}"
}

print_confirm() {
  [[ -f "$CONFIRM_FILE" ]] || return 0
  local enabled
  enabled="$(extract_field "$CONFIRM_FILE" enabled)"
  [[ "$enabled" == "false" ]] && return 0

  printf '\n🔐 High-risk ops requiring `bpm confirm` before execution:\n'
  awk '/^---$/ {fm++; next} fm == 1 && /^[[:space:]]+- / {
    sub(/^[[:space:]]+- /, "")
    print "  • " $0
  }' "$CONFIRM_FILE"
}

print_soak
print_confirm
