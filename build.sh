#!/bin/bash
set -e

cd "$(dirname "$0")"

echo "Compiling Hone IDE..."
perry compile src/app.ts --output hone-ide

echo "Updating app bundle..."
cp hone-ide Hone-macOS.app/Contents/MacOS/Hone
cp Hone.icns Hone-macOS.app/Contents/Resources/Hone.icns
cp hone-icon.png Hone-macOS.app/Contents/MacOS/hone-icon.png

echo "Done. Run with: open Hone-macOS.app"
