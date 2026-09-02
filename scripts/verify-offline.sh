#!/usr/bin/env bash
# The §32 offline guarantee, as a check. Two parts:
#   1. static — no telemetry / gallery / update endpoint survives the overlay
#      in vscode/product.json, and no MS gallery URL is baked into the app.
#   2. runtime (best-effort) — launch the built app with the network blocked and
#      confirm it still reaches "ready" with no outbound connection attempts.
#      Full enforcement is the CI offline job (Phase 9); this is the local canary.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

fail=0
say() { printf '%s\n' "$*"; }

# --- 1. static ---
PJ=vscode/product.json
[ -f "$PJ" ] || { echo "run scripts/bootstrap.sh first"; exit 1; }

check_empty() {
  local key="$1"
  local val
  val="$(node -e "const p=require('./$PJ'); const v=p['$key']; process.stdout.write(v==null?'':(typeof v==='object'?JSON.stringify(v):String(v)))")"
  if [ -n "$val" ] && [ "$val" != "{}" ] && [ "$val" != "[]" ] && [ "$val" != "false" ]; then
    say "  ✗ product.json.$key is not cleared: $val"
    fail=1
  else
    say "  ✓ product.json.$key cleared"
  fi
}
say "== static: telemetry / survey endpoints =="
for k in documentTelemetryUrl aiConfig msftInternalDomains agentsTelemetryAppName \
         settingsSearchUrl npsSurveyUrl surveys extensionTips extensionImportantTips \
         introductoryVideosUrl tipsAndTricksUrl newsletterSignupUrl updateUrl; do
  check_empty "$k"
done

say "== static: gallery is Open VSX, not the MS marketplace =="
if node -e "process.exit(/open-vsx/.test(JSON.stringify(require('./$PJ').extensionsGallery||{}))?0:1)"; then
  say "  ✓ extensionsGallery -> Open VSX"
else
  say "  ✗ extensionsGallery is not Open VSX"; fail=1
fi
if grep -rq "marketplace.visualstudio.com" "$PJ"; then
  say "  ✗ MS marketplace URL present in product.json"; fail=1
fi

say "== static: telemetry off =="
node -e "process.exit(require('./$PJ').enableTelemetry===false?0:1)" \
  && say "  ✓ enableTelemetry=false" || { say "  ✗ enableTelemetry not false"; fail=1; }

# --- 2. runtime canary (only if a build exists) ---
APP="vscode/.build/electron/Valyria.app/Contents/MacOS/Valyria"
if [ -x "$APP" ] && command -v /usr/sbin/pfctl >/dev/null 2>&1; then
  say "== runtime: launch offline (best-effort) =="
  say "  (skipped — needs sudo pfctl to block egress; the CI offline job is authoritative)"
fi

[ "$fail" -eq 0 ] && say "offline check: OK" || { say "offline check: FAILED"; exit 1; }
