#!/usr/bin/env node
/**
 * Validate the generated Valyria icon assets (chrome/dist/*).
 *
 * `chrome/tools/build_icons.py` produces these and they are committed; this is
 * the gate that they stay coherent:
 *   - product icon theme — codepoints unique + well-formed, the WOFF parses;
 *   - file icon theme — it is stock Seti (383 defs) + injected Valyria folder
 *     icons that resolve, and `seti.woff` shipped alongside.
 * Runs in CI (see .github/workflows/ci.yml) and from bootstrap.sh. Needs only
 * the committed chrome/dist/ — not the vscode/ submodule.
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "chrome", "dist");
const problems = [];
const fail = (m) => problems.push(m);

// --- product icon theme -------------------------------------------------
const prodPath = join(dist, "valyria-product-icons.json");
if (!existsSync(prodPath)) {
  fail(`missing ${prodPath} — run: python3 chrome/tools/build_icons.py`);
} else {
  const prod = JSON.parse(readFileSync(prodPath, "utf8"));
  const font = prod.fonts?.[0];
  const src = font?.src?.[0]?.path;
  if (!src) fail("product theme: no fonts[0].src[0].path");
  else {
    const fontFile = join(dist, src.replace(/^\.\//, ""));
    if (!existsSync(fontFile)) fail(`product theme: font file ${src} does not exist`);
    else {
      const buf = readFileSync(fontFile);
      if (buf.length < 500 || buf.toString("latin1", 0, 4) !== "wOFF") {
        fail(`product theme: ${src} is not a WOFF (magic ${JSON.stringify(buf.toString("latin1", 0, 4))})`);
      }
    }
  }
  const defs = prod.iconDefinitions ?? {};
  const seen = new Map();
  let count = 0;
  for (const [id, def] of Object.entries(defs)) {
    count++;
    const fc = def.fontCharacter;
    if (typeof fc !== "string" || !/^\\[0-9A-Fa-f]{4,6}$/.test(fc)) {
      fail(`product theme: ${id} has a malformed fontCharacter ${JSON.stringify(fc)}`);
      continue;
    }
    if (seen.has(fc)) fail(`product theme: ${id} and ${seen.get(fc)} share codepoint ${fc}`);
    seen.set(fc, id);
  }
  if (count < 30) fail(`product theme: only ${count} glyphs — expected the full chrome set`);
  else console.log(`  ✓ product icon theme: ${count} glyphs, unique codepoints, WOFF ok`);
}

// --- file icon theme (stock Seti + Valyria folders) ------------------
const filePath = join(dist, "valyria-file-icons.json");
if (!existsSync(filePath)) {
  fail(`missing ${filePath} — run: python3 chrome/tools/build_icons.py`);
} else {
  const theme = JSON.parse(readFileSync(filePath, "utf8"));
  const defs = theme.iconDefinitions ?? {};

  // Seti's file-type icons must still be here (its own theme has ~383 defs).
  const n = Object.keys(defs).length;
  if (n < 300) fail(`file theme: only ${n} iconDefinitions — the Seti merge looks broken`);

  // Seti's font must be shipped next to the theme.
  const fontRel = theme.fonts?.[0]?.src?.[0]?.path;
  if (fontRel !== "./seti.woff") fail(`file theme: fonts[0].src[0].path is ${JSON.stringify(fontRel)}, expected "./seti.woff"`);
  else {
    const fontFile = join(dist, "seti.woff");
    if (!existsSync(fontFile) || readFileSync(fontFile).toString("latin1", 0, 4) !== "wOFF") {
      fail("file theme: chrome/dist/seti.woff is missing or not a WOFF");
    }
  }

  // The Valyria folder icons must be wired and resolve.
  for (const k of ["folder", "folderExpanded", "rootFolder", "rootFolderExpanded"]) {
    const ref = theme[k];
    if (!ref) { fail(`file theme: ${k} is not set — the Valyria folder icon is missing`); continue; }
    const p = defs[ref]?.iconPath;
    if (typeof p !== "string" || !existsSync(join(dist, p.replace(/^\.\//, "")))) {
      fail(`file theme: ${k} -> ${ref} -> ${p} does not resolve`);
    }
  }
  if (problems.length === 0) {
    console.log(`  ✓ file icon theme: ${n} defs (stock Seti), Valyria folder icons wired, seti.woff present`);
  }
}

if (problems.length) {
  console.error("\nchrome icon check FAILED:");
  for (const p of problems) console.error(`  ✗ ${p}`);
  process.exit(1);
}
console.log("  ✓ chrome/dist is coherent");
