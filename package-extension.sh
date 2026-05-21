#!/bin/bash
# Creates a clean Firefox extension zip without macOS resource fork junk.
# Usage: ./package-extension.sh
# Output: instagram-collector.zip (in the same directory)

set -euo pipefail

OUTFILE="instagram-collector.zip"

# Remove any previous build
rm -f "$OUTFILE"

# COPYFILE_DISABLE=1 tells macOS's zip to skip ._* resource forks and __MACOSX entries.
# List files explicitly so .DS_Store, .git, and other clutter are never included.
COPYFILE_DISABLE=1 zip "$OUTFILE" \
  manifest.json \
  background.js \
  capture-instagram.js \
  popup.html \
  popup.js \
  PRIVACY.md \
  icon-park--collect-picture.svg \
  icon-park-outline--collect-picture.svg

echo "✓ Built $OUTFILE"
unzip -l "$OUTFILE"
