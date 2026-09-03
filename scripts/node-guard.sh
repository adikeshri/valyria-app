#!/usr/bin/env bash
# Source me. Ensures a Node that satisfies vscode/.nvmrc is first on PATH.
#
# Code-OSS's preinstall enforces: same major as .nvmrc, and >= its minor.patch.
# If the default `node` is too old we look for a keg-only Homebrew `node@<major>`
# (non-invasive — it never shadows the user's global node) and prepend it.
# Failing that, we stop with instructions rather than letting the build fail
# deep inside gulp.

# Every caller cd's to the repo root before sourcing this, so $PWD is it.
_ng_root="${VALYRIA_APP_ROOT:-$PWD}"
if [ -f "$_ng_root/vscode/.nvmrc" ]; then
  _ng_required="$(tr -d '[:space:]' < "$_ng_root/vscode/.nvmrc")"
else
  _ng_required="24.18.0"   # fallback if the submodule isn't bootstrapped yet
fi

_ng_req_major="${_ng_required%%.*}"
_ng_rest="${_ng_required#*.}"
_ng_req_minor="${_ng_rest%%.*}"
_ng_req_patch="${_ng_rest#*.}"

_ng_ok() {
  # $1 = a node binary
  local v; v="$("$1" --version 2>/dev/null)" || return 1
  v="${v#v}"
  local maj="${v%%.*}" rest="${v#*.}"; local min="${rest%%.*}" pat="${rest#*.}"
  [ "$maj" = "$_ng_req_major" ] || return 1
  [ "$min" -gt "$_ng_req_minor" ] && return 0
  [ "$min" -eq "$_ng_req_minor" ] && [ "$pat" -ge "$_ng_req_patch" ] && return 0
  return 1
}

if _ng_ok "$(command -v node 2>/dev/null)"; then
  :  # default node is fine
elif [ -x "/opt/homebrew/opt/node@${_ng_req_major}/bin/node" ] && _ng_ok "/opt/homebrew/opt/node@${_ng_req_major}/bin/node"; then
  export PATH="/opt/homebrew/opt/node@${_ng_req_major}/bin:$PATH"
  echo "node-guard: using keg-only node@${_ng_req_major} ($(node --version))"
elif [ -x "/usr/local/opt/node@${_ng_req_major}/bin/node" ] && _ng_ok "/usr/local/opt/node@${_ng_req_major}/bin/node"; then
  export PATH="/usr/local/opt/node@${_ng_req_major}/bin:$PATH"
  echo "node-guard: using keg-only node@${_ng_req_major} ($(node --version))"
else
  echo "node-guard: need Node ${_ng_required} (same major ${_ng_req_major}, >= ${_ng_req_minor}.${_ng_req_patch}); have $(node --version 2>/dev/null || echo none)." >&2
  echo "           brew install node@${_ng_req_major}   (keg-only, won't touch your global node)" >&2
  echo "           or install ${_ng_required}+ with nvm/fnm/volta." >&2
  return 1 2>/dev/null || exit 1
fi

unset _ng_root _ng_required _ng_req_major _ng_rest _ng_req_minor _ng_req_patch
unset -f _ng_ok 2>/dev/null || true
