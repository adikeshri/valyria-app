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
# Keep the expensive-to-rebuild trees: deps, electron, and the compiled
# workbench/extensions. With near-zero patches these stay valid across a
# re-bootstrap; run `(cd vscode && npm run compile)` after a REF bump.
git -C vscode clean -fdx -e node_modules -e .build -e out -e out-build -e out-vscode
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

# 4. Branding assets. Copy build/icons/* into the resource tree, and — when the
#    tooling is available — rasterise valyria.svg into the platform icon set
#    (.icns / .ico / PNGs) the bundler expects. Missing tooling is a warning,
#    not a failure: Code-OSS falls back to its own icons for a dev build.
if compgen -G "build/icons/*" > /dev/null; then
  echo "==> Copying build/icons/* -> vscode/resources/valyria/"
  mkdir -p vscode/resources/valyria
  cp -R build/icons/* vscode/resources/valyria/

  SVG=build/icons/valyria.svg
  if [ -f "$SVG" ]; then
    RES=vscode/resources
    if command -v rsvg-convert >/dev/null 2>&1; then
      for s in 16 32 64 128 256 512 1024; do
        rsvg-convert -w $s -h $s "$SVG" -o "$RES/valyria/icon-$s.png" || true
      done
      cp "$RES/valyria/icon-512.png" "$RES/linux/code.png" 2>/dev/null || true
    else
      echo "    (rsvg-convert not found — skipping PNG rasterisation; dev build uses stock icons)"
    fi
    if command -v iconutil >/dev/null 2>&1 && [ -f "$RES/valyria/icon-1024.png" ]; then
      ICONSET="$(mktemp -d)/valyria.iconset"; mkdir -p "$ICONSET"
      for s in 16 32 128 256 512; do
        cp "$RES/valyria/icon-$s.png" "$ICONSET/icon_${s}x${s}.png" 2>/dev/null || true
      done
      cp "$RES/valyria/icon-1024.png" "$ICONSET/icon_512x512@2x.png" 2>/dev/null || true
      iconutil -c icns "$ICONSET" -o "$RES/darwin/code.icns" 2>/dev/null \
        && echo "    darwin/code.icns generated" || true
    fi
  fi
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
