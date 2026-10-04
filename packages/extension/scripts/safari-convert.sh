#!/usr/bin/env bash
#
# Turn the packaged extension into a Safari Web Extension app and upload it to
# App Store Connect.
#
#   ./scripts/safari-convert.sh            # convert + build + archive
#   ./scripts/safari-convert.sh --upload   # …and upload to App Store Connect
#
# THIS MUST RUN ON A MAC. Safari extensions are distributed as a containing
# macOS/iOS app, and the only supported way to produce one is Xcode's
# `safari-web-extension-converter`, which ships with Xcode and exists on no
# other platform. Everything upstream of this — the build, the manifest, the
# archive — is produced on any machine by `scripts/package.mjs`; this script is
# the one step that cannot be.
#
# Prerequisites on the Mac:
#   - Xcode 15+ with command line tools (`xcode-select -p` must resolve)
#   - Membership in the Apple Developer Program, signed in to Xcode
#   - An App Store Connect app record for the bundle id below, created once at
#     https://appstoreconnect.apple.com (Apple has no API to create it as part
#     of a first submission)
#   - APPLE_ID and APPLE_APP_SPECIFIC_PASSWORD in the environment for --upload
#     (both are in the logicsrc `pairux-com--prod` vault), plus APPLE_TEAM_ID
#
set -euo pipefail

PKG_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
UNPACKED="$PKG_ROOT/release/unpacked-safari"
PROJECT_DIR="$PKG_ROOT/release/safari"
APP_NAME="CoinPay Portal Wallet"
BUNDLE_ID="com.profullstack.coinpay-wallet"
VERSION="$(node -p "require('$PKG_ROOT/package.json').version")"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "error: Safari packaging requires macOS — this is $(uname -s)." >&2
  echo "       Run scripts/package.mjs anywhere, then this script on a Mac." >&2
  exit 2
fi

if [[ ! -d "$UNPACKED" ]]; then
  echo "error: $UNPACKED missing — run \`node scripts/package.mjs\` first." >&2
  exit 2
fi

echo "==> converting v$VERSION"
rm -rf "$PROJECT_DIR"
mkdir -p "$PROJECT_DIR"

# --macos-only: the wallet popup is a desktop interaction and iOS Safari
# extensions need their own App Store record and screenshots. Drop the flag to
# generate the iOS target too.
xcrun safari-web-extension-converter "$UNPACKED" \
  --project-location "$PROJECT_DIR" \
  --app-name "$APP_NAME" \
  --bundle-identifier "$BUNDLE_ID" \
  --swift \
  --macos-only \
  --no-open \
  --force

XCODEPROJ="$PROJECT_DIR/$APP_NAME/$APP_NAME.xcodeproj"
ARCHIVE="$PROJECT_DIR/$APP_NAME.xcarchive"

echo "==> archiving"
xcodebuild -project "$XCODEPROJ" \
  -scheme "$APP_NAME" \
  -configuration Release \
  -archivePath "$ARCHIVE" \
  MARKETING_VERSION="$VERSION" \
  ${APPLE_TEAM_ID:+DEVELOPMENT_TEAM="$APPLE_TEAM_ID"} \
  archive

if [[ "${1:-}" != "--upload" ]]; then
  echo "==> archived at $ARCHIVE"
  echo "    open it in Xcode's Organizer to distribute, or re-run with --upload"
  exit 0
fi

: "${APPLE_ID:?APPLE_ID must be set for --upload}"
: "${APPLE_APP_SPECIFIC_PASSWORD:?APPLE_APP_SPECIFIC_PASSWORD must be set for --upload}"

EXPORT_DIR="$PROJECT_DIR/export"
cat > "$PROJECT_DIR/ExportOptions.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>method</key><string>app-store-connect</string>
  <key>teamID</key><string>${APPLE_TEAM_ID:-}</string>
  <key>destination</key><string>export</string>
</dict>
</plist>
PLIST

echo "==> exporting"
rm -rf "$EXPORT_DIR"
xcodebuild -exportArchive \
  -archivePath "$ARCHIVE" \
  -exportPath "$EXPORT_DIR" \
  -exportOptionsPlist "$PROJECT_DIR/ExportOptions.plist"

PKG="$(find "$EXPORT_DIR" -name '*.pkg' -maxdepth 2 | head -1)"
[[ -n "$PKG" ]] || { echo "error: no .pkg produced by exportArchive" >&2; exit 1; }

echo "==> uploading $PKG"
xcrun altool --upload-app \
  --type macos \
  --file "$PKG" \
  --username "$APPLE_ID" \
  --password "$APPLE_APP_SPECIFIC_PASSWORD"

echo "==> uploaded — finish the submission at https://appstoreconnect.apple.com"
