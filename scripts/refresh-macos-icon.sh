#!/usr/bin/env bash
# Force macOS to forget the cached Dock/Finder icon for the dev Valyria.app.
#
# Why this is needed: the dev Electron bundle
# (vscode/.build/electron/Valyria.app) is re-created at the same path on every
# build and carries a frozen 1980 mtime, so Launch Services keeps serving
# whatever icon it first indexed there (the stock Code-OSS icon, if the bundle
# predates the rebrand). `scripts/dev.sh` does the cheap part (touch +
# `lsregister -f`) on every launch; run THIS when that isn't enough.
#
# The system-wide icon cache clear needs sudo — you will be prompted.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP="$ROOT/vscode/.build/electron/Valyria.app"

if [[ "$OSTYPE" != darwin* ]]; then
  echo "macOS only — nothing to do." >&2
  exit 0
fi
if [ ! -d "$APP" ]; then
  echo "No dev bundle at $APP — run scripts/dev.sh once first." >&2
  exit 1
fi

LSREGISTER=/System/Library/Frameworks/CoreServices.framework/Versions/A/Frameworks/LaunchServices.framework/Versions/A/Support/lsregister

echo "==> touch + re-register $APP"
touch "$APP"
"$LSREGISTER" -f "$APP"

echo "==> clearing icon caches (sudo)"
sudo rm -rf /Library/Caches/com.apple.iconservices.store || true
find "$(getconf DARWIN_USER_CACHE_DIR)/com.apple.iconservices"* -maxdepth 0 -exec rm -rf {} + 2>/dev/null || true

echo "==> restarting Dock + Finder"
killall Dock || true
killall Finder || true

cat <<EOF

Done. If Valyria is currently running, quit it and re-launch (scripts/dev.sh) —
a running app's Dock icon is fixed at launch time.
EOF
