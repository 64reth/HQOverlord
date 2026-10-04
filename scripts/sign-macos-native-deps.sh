#!/usr/bin/env bash
# Prune staged Sharp packages to the matrix architecture and Developer-ID-sign every nested Mach-O resource.
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT"
: "${RUNNER_TEMP:?RUNNER_TEMP is required}"
: "${APPLE_CERTIFICATE:?APPLE_CERTIFICATE is required}"
: "${APPLE_CERTIFICATE_PASSWORD:?APPLE_CERTIFICATE_PASSWORD is required}"
: "${APPLE_SIGNING_IDENTITY:?APPLE_SIGNING_IDENTITY is required}"
: "${TARGET:?TARGET is required}"

cert="$RUNNER_TEMP/starnet-developer-id.p12"
keychain="$RUNNER_TEMP/starnet-native-signing.keychain-db"
keychain_password=$(openssl rand -hex 24)
printf '%s' "$APPLE_CERTIFICATE" | openssl base64 -d -A -out "$cert"
security create-keychain -p "$keychain_password" "$keychain"
security set-keychain-settings -lut 21600 "$keychain"
security unlock-keychain -p "$keychain_password" "$keychain"
security import "$cert" -P "$APPLE_CERTIFICATE_PASSWORD" -A -t cert -f pkcs12 -k "$keychain"
security set-key-partition-list -S apple-tool:,apple: -s -k "$keychain_password" "$keychain"
security list-keychains -d user -s "$keychain"
security find-identity -v -p codesigning "$keychain" | grep -F "$APPLE_SIGNING_IDENTITY" >/dev/null || {
  echo "::error::[$TARGET] Developer ID identity was not imported into the native-dependency signing keychain."
  exit 1
}

img="src-tauri/voice-deps/node_modules/@img"
case "$TARGET" in
  darwin-arm64) sharp="sharp-darwin-arm64"; vips="sharp-libvips-darwin-arm64" ;;
  darwin-x64)   sharp="sharp-darwin-x64";   vips="sharp-libvips-darwin-x64" ;;
  *) echo "::error::unsupported macOS target $TARGET"; exit 1 ;;
esac
find "$img" -mindepth 1 -maxdepth 1 -type d -name 'sharp-*' \
  ! -name "$sharp" ! -name "$vips" -print -exec rm -rf '{}' +
[ -d "$img/$sharp" ] || { echo "::error::[$TARGET] target Sharp native package $sharp is missing."; exit 1; }

signed=0
while IFS= read -r -d '' native; do
  if file -b "$native" | grep -q 'Mach-O'; then
    codesign --force --options runtime --timestamp --sign "$APPLE_SIGNING_IDENTITY" "$native"
    codesign --verify --strict --verbose=2 "$native"
    signed=$((signed+1))
  fi
done < <(find src-tauri/voice-deps/node_modules -type f -print0)
if [ "$signed" -eq 0 ]; then
  echo "::error::[$TARGET] no staged Mach-O dependencies were found to sign."
  exit 1
fi
echo "::notice::[$TARGET] Developer ID signed + timestamped $signed staged native dependencies."
