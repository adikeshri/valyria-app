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
#    A cross-compiled leg (e.g. x86_64-apple-darwin built on an arm64 runner —
#    release.yml) builds valyria-bridge-host itself with an explicit --target
#    and pre-stages it here; this script's own host-native `cargo build`
#    would target the wrong arch, so skip it when the binary already exists.
mkdir -p extension/bin
if [ -x extension/bin/valyria-bridge-host ] || [ -x extension/bin/valyria-bridge-host.exe ]; then
  echo "==> using already-staged valyria-bridge-host in extension/bin/"
else
  echo "==> cargo build --release -p valyria-bridge-host"
  cargo build --release -p valyria-bridge-host
  cp "target/release/valyria-bridge-host"* extension/bin/ 2>/dev/null || \
    cp "target/release/valyria-bridge-host" extension/bin/
fi

#   The Core binary is either already staged at extension/bin/valyria[.exe]
#   (release.yml downloads + checksum-verifies it from Core's GitHub Release
#   before calling this script — docs/RELEASING.md §Core binary), or supplied
#   locally via VALYRIA_CORE_BIN. It ships next to the app as an externalBin.
if [ -x extension/bin/valyria ] || [ -x extension/bin/valyria.exe ]; then
  echo "==> using already-staged Core binary in extension/bin/"
elif [ -n "${VALYRIA_CORE_BIN:-}" ] && [ -x "${VALYRIA_CORE_BIN:-}" ]; then
  echo "==> bundling Core binary: $VALYRIA_CORE_BIN"
  cp "$VALYRIA_CORE_BIN" extension/bin/valyria
else
  echo "==> WARNING: no Core binary (set VALYRIA_CORE_BIN, or pre-stage" \
       "extension/bin/valyria). The build will ship without a bundled Core;" \
       "users must supply one via valyria.core.binaryPath."
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
