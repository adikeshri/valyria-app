#!/usr/bin/env node
// Write one version into every version field a release depends on. This is
// the only thing that should ever change these fields — see
// `xtask check-versions` (crates/xtask/src/main.rs), which asserts they stay
// in lockstep on every PR. Never hand-edit them individually.
//
// Usage: node scripts/sync-version.mjs 0.2.0
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const version = process.argv[2];
if (!version || !/^\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$/.test(version)) {
  console.error("usage: node scripts/sync-version.mjs <X.Y.Z[-suffix]>");
  process.exit(2);
}

// Never touches vscode/ (submodule, tracks upstream Code-OSS's own version)
// or node_modules/.
const PACKAGE_JSONS = [
  "package.json",
  "extension/package.json",
  "chrome/package.json",
  "theme/package.json",
  "packages/protocol/package.json",
  "packages/state/package.json",
];

for (const rel of PACKAGE_JSONS) {
  const path = join(root, rel);
  const pkg = JSON.parse(readFileSync(path, "utf8"));
  pkg.version = version;
  writeFileSync(path, JSON.stringify(pkg, null, 2) + "\n");
  console.log(`  ${rel} -> ${version}`);
}

// Cargo.toml: only the `version` key inside `[workspace.package]` — the
// pinned Core crates' git `rev` values live in a different table
// ([workspace.dependencies]) and must not be touched.
const cargoPath = join(root, "Cargo.toml");
const cargoText = readFileSync(cargoPath, "utf8");
const sectionStart = cargoText.indexOf("[workspace.package]");
if (sectionStart === -1) {
  console.error("Cargo.toml: no [workspace.package] section found");
  process.exit(1);
}
const nextSection = cargoText.indexOf("\n[", sectionStart + 1);
const sectionEnd = nextSection === -1 ? cargoText.length : nextSection;
const section = cargoText.slice(sectionStart, sectionEnd);
const versionLine = /^version\s*=\s*"[^"]*"/m;
if (!versionLine.test(section)) {
  console.error("Cargo.toml: [workspace.package] has no `version = \"...\"` line to replace");
  process.exit(1);
}
const patchedSection = section.replace(versionLine, `version = "${version}"`);
writeFileSync(
  cargoPath,
  cargoText.slice(0, sectionStart) + patchedSection + cargoText.slice(sectionEnd),
);
console.log(`  Cargo.toml [workspace.package] -> ${version}`);

console.log(`synced ${PACKAGE_JSONS.length + 1} version fields to ${version}`);
