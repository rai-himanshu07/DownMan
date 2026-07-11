#!/usr/bin/env bash
# Generate SHA256SUMS for the built release bundles so a download can be
# verified after transfer:  sha256sum -c SHA256SUMS
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BUNDLE_DIR="$ROOT/src-tauri/target/release/bundle"
VERSION="$(cd "$ROOT" && node -p "require('./package.json').version")"

if [[ ! -d "$BUNDLE_DIR" ]]; then
  echo "No bundle directory at $BUNDLE_DIR — run 'npm run app:build' first." >&2
  exit 1
fi

EXT_BUNDLE_DIR="$BUNDLE_DIR/extensions"
mkdir -p "$EXT_BUNDLE_DIR"
rm -f "$EXT_BUNDLE_DIR"/DownMan-*.zip "$EXT_BUNDLE_DIR"/DownMan-*.xpi
cp "$ROOT/extensions/DownMan.zip" "$EXT_BUNDLE_DIR/DownMan-Chromium-$VERSION.zip"
cp "$ROOT/extensions/DownMan.xpi" "$EXT_BUNDLE_DIR/DownMan-Firefox-$VERSION-unsigned.xpi"
if [[ -f "$ROOT/extensions/DownMan-signed.xpi" ]]; then
  cp "$ROOT/extensions/DownMan-signed.xpi" "$EXT_BUNDLE_DIR/DownMan-Firefox-$VERSION-signed.xpi"
fi

cd "$BUNDLE_DIR"
: > SHA256SUMS
found=0
while IFS= read -r -d '' f; do
  [[ "${f#./}" == *"$VERSION"* ]] || continue
  sha256sum "${f#./}" >> SHA256SUMS
  found=1
done < <(find . -mindepth 2 -maxdepth 2 -type f \( -name '*.deb' -o -name '*.AppImage' -o -name '*.rpm' -o -name '*.zip' -o -name '*.xpi' \) -print0 | sort -z)

if [[ "$found" -eq 0 ]]; then
  echo "No version $VERSION release artifacts found under $BUNDLE_DIR" >&2
  rm -f SHA256SUMS
  exit 1
fi

echo "Wrote $BUNDLE_DIR/SHA256SUMS:"
cat SHA256SUMS
