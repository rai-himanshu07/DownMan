#!/usr/bin/env bash
# Sign the DownMan browser extension via Mozilla AMO for self-distribution
# (unlisted channel) and place the signed .xpi at extensions/DownMan-signed.xpi.
#
# Credentials are read from the environment and are NEVER printed or committed.
# web-ext reads these two standard variables directly:
#   WEB_EXT_API_KEY     <- mozilla_usercode  (AMO API key / JWT issuer, e.g. user:12345:67)
#   WEB_EXT_API_SECRET  <- mozilla_secret    (AMO API secret)
#
# Usage (from a shell where the vars are exported):
#   npm run sign:ext
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
EXT_DIR="$ROOT/extensions"
ART_DIR="$ROOT/.web-ext-artifacts"

if [[ -z "${mozilla_usercode:-}" || -z "${mozilla_secret:-}" ]]; then
  echo "ERROR: mozilla_usercode and/or mozilla_secret are not set in this shell." >&2
  echo "Export them first (values are never logged), then re-run:" >&2
  echo "  export mozilla_usercode='user:XXXXX:YY'" >&2
  echo "  export mozilla_secret='<your-amo-secret>'" >&2
  exit 1
fi

# Pass credentials to web-ext via its native env vars (keeps them out of the process args / ps).
export WEB_EXT_API_KEY="$mozilla_usercode"
export WEB_EXT_API_SECRET="$mozilla_secret"

rm -rf "$ART_DIR"

# Stage a Firefox package with an event-page (background.scripts) manifest — the
# source manifest is Chrome-native (service_worker), which Firefox won't accept.
FILES=(background.js media-resolver.js content.js options.html options.js popup.html popup.js
       icon16.png icon32.png icon48.png icon128.png)
FF="$(mktemp -d)"
trap 'rm -rf "$FF"' EXIT
cp "${FILES[@]/#/$EXT_DIR/}" "$FF/"
python3 - "$EXT_DIR/manifest.json" "$FF/manifest.json" <<'PY'
import json, sys
m = json.load(open(sys.argv[1]))
m.pop("key", None)
m["background"] = {"scripts": ["media-resolver.js", "background.js"]}
m["permissions"] = [p for p in m.get("permissions", []) if p not in ("downloads.shelf", "downloads.ui")]
json.dump(m, open(sys.argv[2], "w"), indent=2)
PY

# Sign for self-distribution (unlisted channel).
npx --yes web-ext sign \
  --source-dir="$FF" \
  --artifacts-dir="$ART_DIR" \
  --channel=unlisted

signed="$(find "$ART_DIR" -name '*.xpi' -print -quit)"
if [[ -z "$signed" ]]; then
  echo "ERROR: no signed .xpi was produced — check the web-ext output above." >&2
  exit 1
fi

cp "$signed" "$EXT_DIR/DownMan-signed.xpi"
echo "✓ Signed extension ready: $EXT_DIR/DownMan-signed.xpi"
echo "  Open it in Firefox to install permanently."
