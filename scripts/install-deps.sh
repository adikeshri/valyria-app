#!/usr/bin/env bash
# Install the Code-OSS dependency tree + the Valyria extension's deps, with the
# right Node on PATH. Run once after scripts/bootstrap.sh and after any
# build/VSCODE_REF bump.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [ ! -e vscode/package.json ]; then
  echo "vscode/ not bootstrapped — run scripts/bootstrap.sh first." >&2
  exit 1
fi

# shellcheck source=scripts/node-guard.sh
source scripts/node-guard.sh

echo "==> npm ci in vscode/  (this is the ~1GB, ~5-10 min step)"
( cd vscode && npm ci )

echo "==> npm ci for the extension"
( cd extension && npm ci )

echo "==> Done. Next: scripts/dev.sh"
