#!/usr/bin/env bash
# Produce branded Valyria installers + the bundled sidecars.
#
# Run on each target OS (or in per-OS CI) — Code-OSS builds only its own
# platform's installers. Signing / notarization hooks are marked below; they
# need credentials this script does not carry (see docs/PACKAGING.md).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [ ! -e vscode/extensions/valyria ]; then
  echo "vscode/ not bootstrapped — run scripts/bootstrap.sh first." >&2
  exit 1
fi

# shellcheck source=scripts/node-guard.sh
source scripts/node-guard.sh

TARGET="${1:-}"
HOST_OS="$(uname -s)"
HOST_ARCH="$(uname -m | sed 's/x86_64/x64/')"

# 1. Sidecars for this host triple.
echo "==> cargo build --release -p valyria-bridge-host"
cargo build --release -p valyria-bridge-host
mkdir -p extension/bin
cp "target/release/valyria-bridge-host"* extension/bin/ 2>/dev/null || \
  cp "target/release/valyria-bridge-host" extension/bin/

#   The Core binary is built from the core.lock.json rev for this triple, or
#   supplied by the packager. It ships next to the app as an externalBin.
CORE_BIN="${VALYRIA_CORE_BIN:-}"
if [ -n "$CORE_BIN" ] && [ -x "$CORE_BIN" ]; then
  echo "==> bundling Core binary: $CORE_BIN"
  cp "$CORE_BIN" extension/bin/valyria
else
  echo "==> WARNING: no Core binary (set VALYRIA_CORE_BIN). The build will ship" \
       "without a bundled Core; users must supply one via valyria.core.binaryPath."
fi

# 2. Extension.
echo "==> compiling extension/"
( cd extension && npm ci && npm run compile )

# 3. Code-OSS branded build.
echo "==> Code-OSS gulp build"
pushd vscode > /dev/null
  npm ci
  if [ -n "$TARGET" ]; then
    npx gulp "$TARGET"
  else
    case "$HOST_OS" in
      Darwin) npx gulp "vscode-darwin-${HOST_ARCH}-min" ;;
      Linux)  npx gulp "vscode-linux-${HOST_ARCH}-min" \
                && npx gulp "vscode-linux-${HOST_ARCH}-build-deb" || true ;;
      MINGW*|MSYS*|CYGWIN*) npx gulp "vscode-win32-x64-min" ;;
      *) echo "unknown host $HOST_OS — pass an explicit gulp target as \$1"; exit 1 ;;
    esac
  fi
popd > /dev/null

# 4. Signing (hooks — need credentials; no-op without them).
case "$HOST_OS" in
  Darwin)
    if [ -n "${MACOS_SIGN_IDENTITY:-}" ]; then
      echo "==> codesign + notarize (docs/PACKAGING.md)"
      # codesign --deep --force --options runtime --sign "$MACOS_SIGN_IDENTITY" "VSCode-darwin-*/Valyria.app"
      # xcrun notarytool submit ... --wait ; xcrun stapler staple ...
    else
      echo "==> (unsigned — set MACOS_SIGN_IDENTITY / notary creds to sign)"
    fi ;;
  MINGW*|MSYS*|CYGWIN*)
    [ -n "${WINDOWS_SIGN_PFX:-}" ] && echo "==> signtool (docs/PACKAGING.md)" \
      || echo "==> (unsigned — set WINDOWS_SIGN_PFX to sign)" ;;
esac

echo "==> Artifacts under VSCode-*/ next to vscode/  (see docs/PACKAGING.md)"
