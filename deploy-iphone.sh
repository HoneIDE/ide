#!/bin/bash
set -e

# Hone IDE — build, sign, and deploy to iPhone
# Usage: ./deploy-iphone.sh

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PERRY_DIR="$(cd "$SCRIPT_DIR/../../perry" && pwd)"
APP_TS="$SCRIPT_DIR/src/app.ts"
APP_BUNDLE="$SCRIPT_DIR/Hone.app"

# Signing config
SIGN_IDENTITY="Apple Development: Ralph Kuepper (372EYFG3C5)"
TEAM_ID="K6UW5YV9F7"
BUNDLE_ID="com.perry.Hone"
PROVISION_PROFILE="$HOME/Library/Developer/Xcode/DerivedData/HoneSigner-gwsadbjvejkvbcetbfuwksejbgav/Build/Products/Debug-iphoneos/Hone.app/embedded.mobileprovision"

# Find connected iPhone
DEVICE_ID=$(xcrun devicectl list devices 2>&1 | grep "iPhone" | grep "available" | head -1 | grep -oE '[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}')
if [ -z "$DEVICE_ID" ]; then
    echo "Error: No available iPhone found. Connect your device and try again."
    exit 1
fi
echo "==> iPhone: $DEVICE_ID"

# 1. Build Perry iOS device library
echo "==> Building Perry UI (iOS device)..."
cd "$PERRY_DIR"
CARGO_PROFILE_RELEASE_LTO=off cargo build --release -p perry-ui-ios --target aarch64-apple-ios 2>&1 | tail -1

# 2. Compile TypeScript → native iOS binary
echo "==> Compiling Hone IDE..."
./target/release/perry compile "$APP_TS" --target ios --output "$SCRIPT_DIR/Hone" 2>&1 | tail -1

# 3. Embed provisioning profile
if [ ! -f "$PROVISION_PROFILE" ]; then
    echo "Error: Provisioning profile not found at $PROVISION_PROFILE"
    echo "Run the HoneSigner Xcode project first (see README)."
    exit 1
fi
echo "==> Embedding provisioning profile..."
cp "$PROVISION_PROFILE" "$APP_BUNDLE/embedded.mobileprovision"

# 4. Code sign
echo "==> Signing..."
ENTITLEMENTS_FILE=$(mktemp /tmp/hone-entitlements.XXXXXX.plist)
cat > "$ENTITLEMENTS_FILE" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>application-identifier</key>
    <string>${TEAM_ID}.${BUNDLE_ID}</string>
    <key>com.apple.developer.team-identifier</key>
    <string>${TEAM_ID}</string>
    <key>get-task-allow</key>
    <true/>
</dict>
</plist>
PLIST

codesign --force --sign "$SIGN_IDENTITY" \
  --entitlements "$ENTITLEMENTS_FILE" \
  --timestamp=none "$APP_BUNDLE"
rm -f "$ENTITLEMENTS_FILE"

# 5. Install and launch
echo "==> Installing on iPhone..."
xcrun devicectl device install app --device "$DEVICE_ID" "$APP_BUNDLE" 2>&1 | tail -3

echo "==> Launching..."
xcrun devicectl device process launch --device "$DEVICE_ID" "$BUNDLE_ID" 2>&1 | tail -1

echo "==> Done!"
