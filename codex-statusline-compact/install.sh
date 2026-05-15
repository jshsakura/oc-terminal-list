#!/usr/bin/env sh
set -eu

CODEX_HOME="${CODEX_HOME:-$HOME/.codex}"
CONFIG="$CODEX_HOME/config.toml"
BACKUP="$CONFIG.bak.$(date +%Y%m%d%H%M%S)"

mkdir -p "$CODEX_HOME"
[ -f "$CONFIG" ] && cp "$CONFIG" "$BACKUP" || : > "$CONFIG"

tmp="$(mktemp)"
awk '
BEGIN { in_tui = 0; skipping = 0; saw_tui = 0; wrote_status = 0; wrote_colors = 0 }
function write_status() {
  if (!wrote_status) {
    print "status_line = ["
    print "  \"model-with-reasoning\","
    print "  \"project\","
    print "  \"git-branch\","
    print "  \"context-used\","
    print "  \"total-input-tokens\","
    print "  \"total-output-tokens\","
    print "  \"five-hour-limit\","
    print "  \"weekly-limit\","
    print "]"
    print "status_line_use_colors = true"
    wrote_status = 1
    wrote_colors = 1
  }
}
/^\[tui\]$/ {
  if (in_tui) write_status()
  in_tui = 1
  saw_tui = 1
  print
  next
}
/^\[/ {
  if (in_tui) write_status()
  in_tui = 0
  skipping = 0
  print
  next
}
in_tui && /^status_line[[:space:]]*=/ {
  skipping = ($0 ~ /\]/) ? 0 : 1
  next
}
skipping {
  if ($0 ~ /^[[:space:]]*\]/) skipping = 0
  next
}
in_tui && /^status_line_use_colors[[:space:]]*=/ { next }
{ print }
END {
  if (in_tui) write_status()
  if (!saw_tui) {
    print ""
    print "[tui]"
    write_status()
  }
}
' "$CONFIG" > "$tmp"

mv "$tmp" "$CONFIG"
echo "Installed compact Codex status line: $CONFIG"
[ -f "$BACKUP" ] && echo "Backup: $BACKUP"
