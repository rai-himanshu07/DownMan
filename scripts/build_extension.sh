#!/usr/bin/env bash
# Build the browser extension archives from a single source manifest:
#   DownMan.zip  — Chrome/Chromium (MV3 `background.service_worker`)
#   DownMan.xpi  — Firefox 140+ (MV3 event page via `background.scripts`)
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

FILES=(background.js media-resolver.js content.js options.html options.js popup.html popup.js
       icon16.png icon32.png icon48.png icon128.png)

cd "$EXT_DIR"
rm -f DownMan.zip DownMan.xpi

# Keep a signed Firefox package only when its version, Firefox background, and
# every packaged source file match. A content change requires a fresh signature
# even when the manifest version was not changed yet.
if [[ -f DownMan-signed.xpi ]]; then
  if ! python3 - "manifest.json" "DownMan-signed.xpi" "${FILES[@]}" <<'PY'
import json, pathlib, sys, zipfile

source_manifest = json.load(open(sys.argv[1]))
try:
    with zipfile.ZipFile(sys.argv[2]) as archive:
        signed_manifest = json.loads(archive.read("manifest.json"))
        expected_manifest = dict(source_manifest)
        expected_manifest.pop("key", None)
        expected_manifest["background"] = {"scripts": ["media-resolver.js", "background.js"]}
        expected_manifest["permissions"] = [p for p in expected_manifest.get("permissions", []) if p not in ("downloads.shelf", "downloads.ui")]
        if signed_manifest != expected_manifest:
          raise ValueError("manifest mismatch")
        for name in sys.argv[3:]:
            if archive.read(name) != pathlib.Path(name).read_bytes():
                raise ValueError(f"content mismatch: {name}")
except Exception as error:
    print(error, file=sys.stderr)
    raise SystemExit(1)
PY
  then
    echo "Removing stale DownMan-signed.xpi (version or packaged content changed)."
    rm -f DownMan-signed.xpi
  fi
fi

# Chrome/Chromium: source manifest as-is (service_worker background).
zip -q DownMan.zip manifest.json "${FILES[@]}"

# Firefox: same files, but rewrite the background to a scripts event page.
FF="$(mktemp -d)"
trap 'rm -rf "$FF"' EXIT
cp "${FILES[@]}" "$FF/"
python3 - "$EXT_DIR/manifest.json" "$FF/manifest.json" <<'PY'
import json, sys
m = json.load(open(sys.argv[1]))
m.pop("key", None)
m["background"] = {"scripts": ["media-resolver.js", "background.js"]}
m["permissions"] = [p for p in m.get("permissions", []) if p not in ("downloads.shelf", "downloads.ui")]
json.dump(m, open(sys.argv[2], "w"), indent=2)
PY
( cd "$FF" && zip -q "$EXT_DIR/DownMan.xpi" manifest.json "${FILES[@]}" )

echo "Built:"
ls -lh DownMan.zip DownMan.xpi
