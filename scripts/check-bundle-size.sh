#!/usr/bin/env bash
# Bundle-size budget for the Valyria extension (PLAN.md §7 CI bullet).
# The ext-host bundle carries @valyria/state + @valyria/protocol + zod; each
# webview is tiny. Fail the build if anything balloons.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT/extension"

[ -f out/extension.js ] || { echo "run 'npm run compile' first"; exit 1; }

HOST_BUDGET_KB=600
WEBVIEW_BUDGET_KB=40
fail=0

kb() { echo $(( ( $(wc -c < "$1") + 1023 ) / 1024 )); }

h=$(kb out/extension.js)
if [ "$h" -gt "$HOST_BUDGET_KB" ]; then
  echo "  ✗ out/extension.js is ${h}KB (budget ${HOST_BUDGET_KB}KB)"; fail=1
else
  echo "  ✓ out/extension.js ${h}KB / ${HOST_BUDGET_KB}KB"
fi

for f in out/webviews/*.js; do
  [ -e "$f" ] || continue
  w=$(kb "$f")
  if [ "$w" -gt "$WEBVIEW_BUDGET_KB" ]; then
    echo "  ✗ $f is ${w}KB (budget ${WEBVIEW_BUDGET_KB}KB)"; fail=1
  fi
done
[ "$fail" -eq 0 ] && echo "  ✓ every webview bundle under ${WEBVIEW_BUDGET_KB}KB"

exit "$fail"
