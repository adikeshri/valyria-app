#!/usr/bin/env node
// Deep-merge build/product.overlay.json over vscode/product.json, in place.
// Overlay keys win. Arrays are replaced wholesale (not concatenated).
// Keys whose name starts with "$" are treated as comments and dropped.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const basePath = join(root, "vscode", "product.json");
const overlayPath = join(root, "build", "product.overlay.json");

const stripComments = (v) => {
  if (Array.isArray(v)) return v.map(stripComments);
  if (v && typeof v === "object") {
    const out = {};
    for (const [k, val] of Object.entries(v)) {
      if (k.startsWith("$")) continue;
      out[k] = stripComments(val);
    }
    return out;
  }
  return v;
};

const deepMerge = (base, overlay) => {
  if (Array.isArray(overlay)) return overlay.slice();
  if (overlay && typeof overlay === "object") {
    const out = base && typeof base === "object" && !Array.isArray(base) ? { ...base } : {};
    for (const [k, val] of Object.entries(overlay)) {
      out[k] = deepMerge(out[k], val);
    }
    return out;
  }
  return overlay;
};

const base = JSON.parse(readFileSync(basePath, "utf8"));
const overlay = stripComments(JSON.parse(readFileSync(overlayPath, "utf8")));
const merged = deepMerge(base, overlay);

writeFileSync(basePath, JSON.stringify(merged, null, "\t") + "\n");
console.log(`merged ${Object.keys(overlay).length} overlay keys into vscode/product.json`);
