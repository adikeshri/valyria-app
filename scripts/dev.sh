#!/usr/bin/env bash
# Watch + launch the branded Valyria editor from source.
#
#   - builds valyria-bridge-host (debug) and stages it where the extension
#     resolves it (extension/bin/)
#   - compiles the extension once, then watches it (tsc -w)
#   - launches ./vscode/scripts/code.sh
#
# The Valyria extension is a *built-in* (symlinked into vscode/extensions/valyria
# by scripts/bootstrap.sh), so it loads automatically — no
# --extensionDevelopmentPath.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [ ! -e vscode/extensions/valyria ]; then
  echo "vscode/ not bootstrapped — run scripts/bootstrap.sh first." >&2
  exit 1
fi
if [ ! -d vscode/node_modules ]; then
  echo "Code-OSS deps missing — run scripts/install-deps.sh first." >&2
  exit 1
fi

# shellcheck source=scripts/node-guard.sh
source scripts/node-guard.sh

echo "==> valyria-bridge-host (debug) -> extension/bin/"
cargo build -p valyria-bridge-host
mkdir -p extension/bin
cp "target/debug/valyria-bridge-host" extension/bin/

echo "==> extension: install (if needed) + compile"
[ -d extension/node_modules ] || npm --prefix extension ci
npm --prefix extension run compile

echo "==> watching extension/ (tsc -w) in the background"
npm --prefix extension run watch &
WATCH_PID=$!
trap 'kill $WATCH_PID 2>/dev/null || true' EXIT

echo "==> launching Valyria (Code-OSS dev build)"
exec ./vscode/scripts/code.sh "$@"
