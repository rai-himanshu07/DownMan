#!/usr/bin/env bash
# Prepare Tauri externalBin inputs. Tauri expects external binaries to exist with
# the target triple suffix at build time, even though they are installed without it.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BIN_DIR="$ROOT/src-tauri/binaries"
TARGET_TRIPLE="${TARGET_TRIPLE:-$(rustc -vV | awk '/^host:/ { print $2 }')}"

if [[ ! -x "$BIN_DIR/yt-dlp" ]]; then
  echo "Missing executable $BIN_DIR/yt-dlp" >&2
  exit 1
fi

DST="$BIN_DIR/downman-ytdlp-$TARGET_TRIPLE"
if [[ ! -f "$DST" || "$BIN_DIR/yt-dlp" -nt "$DST" ]]; then
  cp "$BIN_DIR/yt-dlp" "$DST"
  chmod +x "$DST"
fi

echo "Prepared external binaries for $TARGET_TRIPLE"
