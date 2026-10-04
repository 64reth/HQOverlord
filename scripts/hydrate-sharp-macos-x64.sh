#!/usr/bin/env bash
# Hydrate the Intel Sharp packages pinned by package-lock for an x64 build on an ARM macOS runner.
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT"
: "${RUNNER_TEMP:?RUNNER_TEMP is required}"

hydrate_locked_package() {
  local key="$1" dest="$2" version expected spec tgz actual
  version=$(node -p "require('./package-lock.json').packages[process.argv[1]].version" "$key")
  expected=$(node -p "require('./package-lock.json').packages[process.argv[1]].integrity" "$key")
  spec="${key#node_modules/}"
  tgz=$(npm pack "$spec@$version" --pack-destination "$RUNNER_TEMP" --silent)
  actual="sha512-$(openssl dgst -sha512 -binary "$RUNNER_TEMP/$tgz" | openssl base64 -A)"
  if [ "$actual" != "$expected" ]; then
    echo "::error::lockfile integrity mismatch while hydrating $spec@$version"
    exit 1
  fi
  mkdir -p "$dest"
  tar -xzf "$RUNNER_TEMP/$tgz" -C "$dest" --strip-components=1
}

hydrate_locked_package node_modules/@img/sharp-darwin-x64 node_modules/@img/sharp-darwin-x64
hydrate_locked_package node_modules/@img/sharp-libvips-darwin-x64 node_modules/@img/sharp-libvips-darwin-x64
node -e "for (const n of ['sharp-darwin-x64','sharp-libvips-darwin-x64']) require('./node_modules/@img/'+n+'/package.json')"
git diff --exit-code -- package.json package-lock.json
