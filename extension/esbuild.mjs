// Bundle the extension host entry (and its `@valyria/*` deps + zod) into one
// CommonJS file VS Code loads as `main`. Webview bundles are added in Phase 2.
import * as esbuild from "esbuild";

const watch = process.argv.includes("--watch");

/** @type {import('esbuild').BuildOptions} */
const opts = {
  entryPoints: ["src/extension.ts"],
  outfile: "out/extension.js",
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20", // Electron 42 ships Node 24; node20 is a safe floor
  sourcemap: true,
  minify: false,
  // `vscode` is provided by the extension host at runtime, never bundled.
  external: ["vscode"],
  logLevel: "info",
  // esbuild substitutes .ts for .js in import paths, so @valyria/* ESM sources
  // (which import "./foo.js" meaning "./foo.ts") resolve correctly.
};

if (watch) {
  const ctx = await esbuild.context(opts);
  await ctx.watch();
  console.log("esbuild: watching…");
} else {
  await esbuild.build(opts);
}
