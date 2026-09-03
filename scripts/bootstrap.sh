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
# Keep the expensive-to-rebuild trees: deps and the downloaded toolchains under
# .build. The compiled workbench (out*) is NOT kept — we carry source patches
# (build/patches/), and a preserved out* would mask them until the next manual
# `npm run compile`. preLaunch.ts recompiles out* on demand when it is missing.
git -C vscode clean -fdx -e node_modules -e .build
git -C vscode reset --hard "$REF"
# The Electron app bundle is re-branded (icon + Info.plist) by `npm run electron`,
# which preLaunch.ts skips whenever .build/electron/version already matches. Wipe
# it so icon/name changes in this script actually reach the launched app.
rm -rf vscode/.build/electron

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

# 3b. Drop bundled extensions Valyria does not ship. Code-OSS 1.135 folder-scans
#     extensions/ at runtime, so removing the directory is the whole removal.
#     The vscode/ tree is reset every run, so this is a clean overlay-style
#     deletion, not an edit. (`defaultChatAgent` in product.json is left alone —
#     Code-OSS derefs it unguarded at startup, so nulling it white-screens the
#     window; with the extension gone its chat view provider never registers.)
#       - copilot: the built-in GitHub Copilot chat extension. Valyria has its own
#         agent; a second "Build with Agent / Sign in" surface is a fork tell
#         (docs/UX-DIFFERENTIATION.md).
for ext in copilot; do
  if [ -e "vscode/extensions/$ext" ]; then
    echo "==> Removing bundled extension: $ext"
    rm -rf "vscode/extensions/$ext"
  fi
done

# 4. Branding icons. scripts/gen-icons.py writes the whole platform icon set into
#    vscode/resources/ from build/icons/ (the app mark plus 55 re-badged document
#    icons). It needs Pillow; `.icns` output also needs macOS `iconutil`. It fails
#    loudly — no `|| true`, no `2>/dev/null` — so a broken icon build is visible.
echo "==> Generating branding icons (scripts/gen-icons.py)"
python3 scripts/gen-icons.py

# 5. Regenerate the Valyria workbench icon assets if font tooling is present.
#    chrome/dist/ is committed, so this is optional — CI and a fontTools-less
#    machine use the checked-in output. The check always runs.
echo "==> Valyria workbench icons (chrome/)"
if python3 -c "import fontTools" 2>/dev/null; then
  python3 chrome/tools/build_icons.py
else
  echo "    fontTools not installed — using committed chrome/dist/ (pip install fonttools to regenerate)"
fi
node scripts/check-chrome-icons.mjs

# 6. Link the Valyria built-in extensions into the Code-OSS tree. The gulp build
#    (and dev scanBuiltinExtensions) picks up every directory under extensions/.
#      - extension/  the agent UI (has a `main`; disabled in untrusted workspaces)
#      - theme/      the Valyria colour themes (code-free; ALWAYS enabled, which is
#                    why the default theme survives opening an untrusted repo)
#      - chrome/     product + file icon themes + chrome defaults (code-free, same
#                    reason: the identity holds in an untrusted workspace)
if [ ! -e vscode/extensions/valyria ]; then
  echo "==> Linking extension/ -> vscode/extensions/valyria"
  ln -s ../../extension vscode/extensions/valyria
fi
if [ ! -e vscode/extensions/valyria-theme ]; then
  echo "==> Linking theme/ -> vscode/extensions/valyria-theme"
  ln -s ../../theme vscode/extensions/valyria-theme
fi
if [ ! -e vscode/extensions/valyria-chrome ]; then
  echo "==> Linking chrome/ -> vscode/extensions/valyria-chrome"
  ln -s ../../chrome vscode/extensions/valyria-chrome
fi

# 7. Check the Node toolchain now that vscode/.nvmrc exists.
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

If the macOS Dock still shows the old icon after a rebrand:
  scripts/refresh-macos-icon.sh   # flush Launch Services' icon cache, then relaunch

EOF
