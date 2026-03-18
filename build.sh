#!/bin/bash
set -e

cd "$(dirname "$0")"

# Extract version from source
VERSION=$(grep "HONE_VERSION" src/workbench/version.ts | sed "s/.*'\(.*\)'.*/\1/")
echo "Building Hone IDE v${VERSION}..."

echo "Compiling Hone IDE..."
perry compile src/app.ts --output hone-ide

echo "Updating app bundle..."
cp hone-ide Hone-macOS.app/Contents/MacOS/Hone
cp Hone.icns Hone-macOS.app/Contents/Resources/Hone.icns
cp hone-icon.png Hone-macOS.app/Contents/MacOS/hone-icon.png

# Stamp version into Info.plist
if [ -f Hone-macOS.app/Contents/Info.plist ]; then
  /usr/libexec/PlistBuddy -c "Set :CFBundleShortVersionString $VERSION" Hone-macOS.app/Contents/Info.plist 2>/dev/null || true
  /usr/libexec/PlistBuddy -c "Set :CFBundleVersion $VERSION" Hone-macOS.app/Contents/Info.plist 2>/dev/null || true
fi

echo "Done. Run with: open Hone-macOS.app"

# Create distributable artifact
if [ "${1}" = "--dist" ]; then
  ARCH=$(uname -m)
  ARTIFACT="Hone-macOS-${ARCH}-${VERSION}.tar.gz"
  echo "Creating distributable: ${ARTIFACT}"
  tar czf "${ARTIFACT}" Hone-macOS.app/
  echo "SHA-256:"
  shasum -a 256 "${ARTIFACT}"
fi
