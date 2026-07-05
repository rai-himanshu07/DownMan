#!/usr/bin/env bash
# Build the browser extension archives from a single source manifest:
#   DownMan.zip  — Chrome/Chromium (MV3 `background.service_worker`)
#   DownMan.xpi  — Firefox (MV3 event page: `background.scripts`, required by Fx 115+)
# The source extensions/manifest.json is Chrome-native (service_worker only), so
# loading the unpacked folder in Chrome is warning-free. The Firefox package is
# generated with a background.scripts event page so Firefox has a working background.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
EXT_DIR="$ROOT/extensions"

if [[ ! -f "$EXT_DIR/manifest.json" ]]; then
  echo "extensions/manifest.json not found — run from the project root." >&2
  exit 1
fi

FILES=(background.js content.js options.html options.js popup.html popup.js
       icon16.png icon32.png icon48.png icon128.png)

cd "$EXT_DIR"
rm -f DownMan.zip DownMan.xpi

# Chrome/Chromium: source manifest as-is (service_worker background).
zip -q DownMan.zip manifest.json "${FILES[@]}"

# Firefox: same files, but rewrite the background to a scripts event page.
FF="$(mktemp -d)"
trap 'rm -rf "$FF"' EXIT
cp "${FILES[@]}" "$FF/"
python3 - "$EXT_DIR/manifest.json" "$FF/manifest.json" <<'PY'
import json, sys
m = json.load(open(sys.argv[1]))
m["background"] = {"scripts": ["background.js"]}
json.dump(m, open(sys.argv[2], "w"), indent=2)
PY
( cd "$FF" && zip -q "$EXT_DIR/DownMan.xpi" manifest.json "${FILES[@]}" )

echo "Built:"
ls -lh DownMan.zip DownMan.xpi
