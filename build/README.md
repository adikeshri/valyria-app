# `build/` — the Code‑OSS overlay

`vscode/` is an unmodified upstream submodule. Everything that makes it *Valyria*
lives here and is applied by [`scripts/bootstrap.sh`](../scripts/bootstrap.sh).

| File | Role |
|---|---|
| `VSCODE_REF` | The pinned upstream tag. `bootstrap.sh` checks the submodule out to this. Bump = the whole upgrade. |
| `product.overlay.json` | Deep‑merged over `vscode/product.json`. Branding, gallery, telemetry‑off, update feed. Keep minimal. |
| `patches/*.patch` | Unified diffs applied to `vscode/` with `git apply` after checkout. Ordered by filename. Aim for **zero**. |
| `icons/` | App icons per platform, copied into `vscode/resources/` during bootstrap. |

## Adding a patch

Only when something genuinely cannot be done from the extension API:

```bash
cd vscode
# make your edit
git diff > ../build/patches/NN-short-description.patch
git checkout .            # leave the submodule clean
```

`bootstrap.sh` re‑applies all patches from a clean checkout every run, so the
submodule working tree is disposable.

## Upgrading Code‑OSS

1. `echo <new-tag> > build/VSCODE_REF`
2. `scripts/bootstrap.sh` — it will report any patch that no longer applies
3. Refresh broken patches against the new tree, re‑run
4. `scripts/build.sh` and smoke‑test
