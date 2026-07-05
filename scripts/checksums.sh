#!/usr/bin/env bash
# Generate SHA256SUMS for the built release bundles so a download can be
# verified after transfer:  sha256sum -c SHA256SUMS
set -euo pipefail

BUNDLE_DIR="$(cd "$(dirname "$0")/.." && pwd)/src-tauri/target/release/bundle"

if [[ ! -d "$BUNDLE_DIR" ]]; then
  echo "No bundle directory at $BUNDLE_DIR — run 'npm run app:build' first." >&2
  exit 1
fi

cd "$BUNDLE_DIR"
: > SHA256SUMS
found=0
while IFS= read -r -d '' f; do
  sha256sum "${f#./}" >> SHA256SUMS
  found=1
done < <(find . -type f \( -name '*.deb' -o -name '*.AppImage' -o -name '*.rpm' \) -print0 | sort -z)

if [[ "$found" -eq 0 ]]; then
  echo "No .deb/.AppImage/.rpm bundles found under $BUNDLE_DIR" >&2
  rm -f SHA256SUMS
  exit 1
fi

echo "Wrote $BUNDLE_DIR/SHA256SUMS:"
cat SHA256SUMS
