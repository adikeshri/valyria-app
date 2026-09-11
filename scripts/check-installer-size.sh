#!/usr/bin/env bash
# Packaged-installer size budget for release.yml (docs/RELEASING.md §Packaging).
# Distinct from check-bundle-size.sh, which budgets the extension's JS bundle —
# a much smaller number. This checks the final .dmg/.zip/.exe/.deb/.rpm/.tar.gz
# artifacts release.yml produces.
#
# 120MB is a placeholder carried over from the old Tauri-era pipeline (a thin
# wrapper + ~15MB Core sidecar). A full Electron/Code-OSS bundle plus the
# bundled `valyria` binary is very likely heavier — validate this against the
# first real release.yml dry run (docs/RELEASING.md rollout order) and adjust
# the constant below if it's unrealistic. Don't treat 120 as load-bearing
# until that's been checked against a real artifact.
set -euo pipefail

BUDGET_MB="${INSTALLER_SIZE_BUDGET_MB:-120}"
fail=0

if [ "$#" -eq 0 ]; then
  echo "usage: $0 <artifact...>" >&2
  exit 2
fi

for f in "$@"; do
  [ -e "$f" ] || { echo "  ✗ $f: not found"; fail=1; continue; }
  size_mb=$(( ( $(wc -c < "$f") + 1048575 ) / 1048576 ))
  if [ "$size_mb" -gt "$BUDGET_MB" ]; then
    echo "  ✗ $f is ${size_mb}MB (budget ${BUDGET_MB}MB)"
    fail=1
  else
    echo "  ✓ $f ${size_mb}MB / ${BUDGET_MB}MB"
  fi
done

exit "$fail"
