#!/usr/bin/env bash
# Force macOS to forget the cached Dock/Finder icon for the dev Valyria.app.
#
# Why this is needed: the dev Electron bundle
# (vscode/.build/electron/Valyria.app) is re-created at the same path on every
# build, and its Contents/Info.plist carries a frozen 1980 mtime — which is the
# timestamp Launch Services keys its per-bundle icon cache on. So it keeps
# serving whatever icon it first indexed there (the stock Code-OSS icon, if the
# bundle predates the rebrand). `scripts/dev.sh` does the no-sudo part on every
# launch; run THIS when the system icon-bitmap cache also needs clearing.
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

if pgrep -qf "$APP/Contents/MacOS/"; then
  echo "!! Valyria is running — quit it (Cmd-Q) before running this, or its"
  echo "   launch-time Dock tile will survive the flush." >&2
fi

LSREGISTER=/System/Library/Frameworks/CoreServices.framework/Versions/A/Frameworks/LaunchServices.framework/Versions/A/Support/lsregister

echo "==> touch Info.plist + re-seal + re-register $APP"
touch "$APP" "$APP/Contents/Info.plist" "$APP"/Contents/Resources/*.icns
codesign --force --sign - "$APP" >/dev/null 2>&1 || true
"$LSREGISTER" -u "$APP" >/dev/null 2>&1 || true
"$LSREGISTER" -f "$APP"

echo "==> clearing icon caches (sudo)"
sudo rm -rf /Library/Caches/com.apple.iconservices.store || true
find "$(getconf DARWIN_USER_CACHE_DIR)/com.apple.iconservices"* -maxdepth 0 -exec rm -rf {} + 2>/dev/null || true

echo "==> restarting icon services + Dock + Finder"
killall iconservicesagent 2>/dev/null || true
killall iconservicesd 2>/dev/null || true
killall Dock || true
killall Finder || true

cat <<EOF

Done. If Valyria is currently running, quit it and re-launch (scripts/dev.sh) —
a running app's Dock icon is fixed at launch time.
EOF
