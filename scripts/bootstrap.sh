#!/usr/bin/env bash
# Bring vscode/ from a clean upstream checkout to a branded Valyria tree.
# Idempotent: safe to run repeatedly. The vscode/ working tree is disposable —
# this script resets it every run.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

REF="$(cat build/VSCODE_REF | tr -d '[:space:]')"
echo "==> Code-OSS ref: $REF"

# 1. Ensure the submodule exists and is at REF.
if [ ! -e vscode/package.json ]; then
  echo "==> Initialising vscode/ submodule (shallow)"
  git submodule update --init --depth 1 vscode
fi

echo "==> Checking out $REF in vscode/"
git -C vscode fetch --depth 1 origin "tag" "$REF" 2>/dev/null || git -C vscode fetch --depth 1 origin "$REF"
git -C vscode checkout --force --detach "$REF"
git -C vscode clean -fdx -e node_modules -e .build
git -C vscode reset --hard "$REF"

# 2. Apply patches in filename order.
shopt -s nullglob
patches=(build/patches/*.patch)
if [ ${#patches[@]} -gt 0 ]; then
  echo "==> Applying ${#patches[@]} patch(es)"
  for p in "${patches[@]}"; do
    echo "    - $(basename "$p")"
    git -C vscode apply --index "../$p"
  done
else
  echo "==> No patches"
fi

# 3. Merge the product overlay.
echo "==> Merging build/product.overlay.json -> vscode/product.json"
node scripts/merge-product.mjs

# 4. Copy branding assets if present.
if compgen -G "build/icons/*" > /dev/null; then
  echo "==> Copying build/icons/* -> vscode/resources/"
  mkdir -p vscode/resources/valyria
  cp -R build/icons/* vscode/resources/valyria/
fi

# 5. Link the Valyria extension into the Code-OSS build as a compiled-in
#    built-in extension. The vscode gulp build compiles every directory under
#    extensions/.
if [ ! -e vscode/extensions/valyria ]; then
  echo "==> Linking extension/ -> vscode/extensions/valyria"
  ln -s ../../extension vscode/extensions/valyria
fi

# 6. Check the Node toolchain now that vscode/.nvmrc exists.
echo "==> Checking Node toolchain against vscode/.nvmrc"
# shellcheck source=scripts/node-guard.sh
if source scripts/node-guard.sh; then
  echo "    node: $(node --version)  npm: $(npm --version)"
else
  echo "    (fix Node before running 'cd vscode && npm ci')"
fi

cat <<'EOF'

==> Bootstrap complete.

Next:
  scripts/install-deps.sh    # ~5-10 min, ~1GB — Code-OSS + extension deps
  scripts/dev.sh             # watch + launch the branded editor

EOF
