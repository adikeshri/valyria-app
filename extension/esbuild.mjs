// Two build graphs:
//   1. the extension host entry  -> out/extension.js   (CJS, node, vscode external)
//   2. one bundle per webview     -> out/webviews/<name>.{js,css}  (IIFE, browser)
// plus the shared design tokens copied to out/webviews/tokens.css.
import * as esbuild from "esbuild";
import { cpSync, readdirSync, existsSync } from "node:fs";

const watch = process.argv.includes("--watch");

/** @type {import('esbuild').BuildOptions} */
const hostOpts = {
  entryPoints: ["src/extension.ts"],
  outfile: "out/extension.js",
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20", // Electron 42 ships Node 24; node20 is a safe floor
  sourcemap: true,
  external: ["vscode"],
  logLevel: "info",
};

// Every dir under src/webviews/ with a main.ts is a webview entry.
const webviewsDir = "src/webviews";
const webviewEntries = Object.fromEntries(
  readdirSync(webviewsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(`${webviewsDir}/${d.name}/main.ts`))
    .map((d) => [d.name, `${webviewsDir}/${d.name}/main.ts`])
);

/** @type {import('esbuild').BuildOptions} */
const webviewOpts = {
  entryPoints: webviewEntries,
  outdir: "out/webviews",
  bundle: true,
  platform: "browser",
  format: "iife",
  target: "es2022",
  sourcemap: true,
  logLevel: "info",
};

function copyTokens() {
  cpSync(`${webviewsDir}/shared/tokens.css`, "out/webviews/tokens.css");
}

if (watch) {
  const host = await esbuild.context(hostOpts);
  const wv = await esbuild.context({
    ...webviewOpts,
    plugins: [
      {
        name: "copy-tokens",
        setup(b) {
          b.onEnd(() => copyTokens());
        },
      },
    ],
  });
  await Promise.all([host.watch(), wv.watch()]);
  console.log("esbuild: watching host + webviews…");
} else {
  await esbuild.build(hostOpts);
  await esbuild.build(webviewOpts);
  copyTokens();
}
