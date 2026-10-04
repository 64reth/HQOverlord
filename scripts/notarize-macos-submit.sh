#!/usr/bin/env bash
# Submit an already-signed DMG without blocking the build runner on Apple's queue.
# The resulting JSON is uploaded beside the DMG so a separate, retryable job can
# resume polling the same submission instead of rebuilding and resubmitting it.
set -euo pipefail

dmg=${1:?usage: notarize-macos-submit.sh <dmg> [submission-json]}
submission_json=${2:-notary-submission.json}
required=${NOTARIZATION_REQUIRED:-false}

missing=""
for name in APPLE_ID APPLE_PASSWORD APPLE_TEAM_ID; do
  if [ -z "${!name:-}" ]; then missing="$missing $name"; fi
done

if [ -n "$missing" ]; then
  if [ "$required" = "true" ]; then
    echo "::error::notarization submission is required but credentials are missing:$missing"
    exit 1
  fi
  echo "::warning::notarization credentials are incomplete ($missing) — leaving the signed DMG unstapled for internal testing"
  exit 0
fi

if [ ! -f "$dmg" ]; then
  echo "::error::DMG to notarize does not exist: $dmg"
  exit 1
fi

tmp="$submission_json.tmp"
rm -f "$tmp" "$submission_json"
xcrun notarytool submit "$dmg" \
  --apple-id "$APPLE_ID" \
  --password "$APPLE_PASSWORD" \
  --team-id "$APPLE_TEAM_ID" \
  --output-format json > "$tmp"

if ! jq -e '.id | type == "string" and length > 0' "$tmp" >/dev/null; then
  echo "::error::Apple accepted the upload command but returned no notarization submission id"
  cat "$tmp"
  exit 1
fi

mv "$tmp" "$submission_json"
submission_id=$(jq -r '.id' "$submission_json")
echo "::notice::notarization submitted asynchronously: $submission_id"

