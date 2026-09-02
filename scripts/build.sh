#!/usr/bin/env bash
# Produce branded Valyria installers + the bundled bridge-host sidecar.
# Run on each target OS (or in per-OS CI) — Code-OSS builds only its own
# platform's installers.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [ ! -e vscode/extensions/valyria ]; then
  echo "vscode/ not bootstrapped — run scripts/bootstrap.sh first." >&2
  exit 1
fi

# shellcheck source=scripts/node-guard.sh
source scripts/node-guard.sh

# 1. bridge-host sidecar for this host triple (release).
echo "==> cargo build --release -p valyria-bridge-host"
cargo build --release -p valyria-bridge-host
mkdir -p extension/bin
cp "target/release/valyria-bridge-host"* extension/bin/ 2>/dev/null || \
  cp "target/release/valyria-bridge-host" extension/bin/

# 2. Compile the extension.
echo "==> Compiling extension/"
npm --prefix extension ci
npm --prefix extension run compile

# 3. Code-OSS branded build.
#    (min build; swap for the per-OS gulp targets: vscode-darwin-arm64-min,
#     vscode-win32-x64, vscode-linux-x64-{deb,rpm}, etc.)
echo "==> Code-OSS gulp build"
pushd vscode > /dev/null
  npm ci
  case "$(uname -s)" in
    Darwin) npx gulp "vscode-darwin-$(uname -m | sed 's/x86_64/x64/;s/arm64/arm64/')-min" ;;
    Linux)  npx gulp "vscode-linux-x64-min" ;;
    *)      echo "Add a gulp target for $(uname -s)"; exit 1 ;;
  esac
popd > /dev/null

echo "==> Artifacts under VSCode-* next to vscode/  (see build/README.md for signing)"
