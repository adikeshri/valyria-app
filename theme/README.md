# valyria-theme

The Valyria colour identity as a **code-free built-in extension**: Dark, Light,
High Contrast, and High Contrast Light.

## Why a separate extension

A theme contribution on the agent extension (`extension/`) disappears the moment
you open an untrusted folder — that extension declares
`capabilities.untrustedWorkspaces.supported: false`, so Code-OSS disables it
whole in restricted mode and its `contributes.themes` /
`contributes.configurationDefaults` go with it. The workbench then falls back to
a stock Microsoft theme.

An extension with **no `main`** is never disabled by workspace trust
(`extensionManifestPropertiesService`: `!manifest.main` ⇒ untrusted-supported).
So the themes live here, on their own, and hold across trusted and untrusted
workspaces alike. This is the same shape as upstream `theme-defaults`.

## How it becomes the default

Two layers, belt and braces:

1. `contributes.configurationDefaults` sets `workbench.colorTheme` and the four
   `workbench.preferred*ColorTheme` keys to the Valyria themes.
2. `build/patches/010-valyria-default-theme.patch` rewrites
   `ThemeSettingDefaults` in Code-OSS so the *schema* default is `Valyria Dark`
   even before any extension loads — closing the fresh-profile gap that (1)
   alone leaves open.

## Bundling

`scripts/bootstrap.sh` symlinks this directory to
`vscode/extensions/valyria-theme`; the gulp build compiles every directory under
`extensions/`.
