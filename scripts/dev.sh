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

# Prepare the Electron app bundle up front (normally done by code.sh's
# preLaunch), so we can refresh its icon registration before it launches.
if [ -z "${VSCODE_SKIP_PRELAUNCH:-}" ]; then
  echo "==> preparing Electron + built-ins (preLaunch)"
  ( cd vscode && node build/lib/preLaunch.ts )
  export VSCODE_SKIP_PRELAUNCH=1
fi

# macOS caches app icons by bundle path, and the dev .app carries a frozen 1980
# mtime so Launch Services never notices a rebrand. Bump the mtime and re-register
# so the new Valyria icon is picked up. (`killall Dock` may still be needed once
# on an existing checkout; scripts/refresh-macos-icon.sh does the full flush.)
if [[ "$OSTYPE" == darwin* ]]; then
  APP="$(/bin/ls -d vscode/.build/electron/*.app 2>/dev/null | head -1 || true)"
  if [ -n "$APP" ]; then
    touch "$APP"
    LSREGISTER=/System/Library/Frameworks/CoreServices.framework/Versions/A/Frameworks/LaunchServices.framework/Versions/A/Support/lsregister
    [ -x "$LSREGISTER" ] && "$LSREGISTER" -f "$ROOT/$APP" >/dev/null 2>&1 || true
  fi
fi

echo "==> launching Valyria (Code-OSS dev build)"
exec ./vscode/scripts/code.sh "$@"
