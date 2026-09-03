#!/usr/bin/env node
// Remove the bundled-Copilot build wiring from vscode/package.json.
//
// scripts/bootstrap.sh step 3b deletes vscode/extensions/copilot, but Code-OSS
// 1.135's root package.json hard-wires that directory into the aggregate build
// scripts:
//
//   "compile":        "npm-run-all2 -lp compile-client compile-copilot"
//   "watch":          "... watch-extensions watch-copilot"
//   "watch-transpile": "... watch-extensions watch-copilot"
//   "compile-copilot": "npm --prefix extensions/copilot run compile"
//   "watch-copilot":   "npm --prefix extensions/copilot run watch"
//
// With the directory gone those npm --prefix calls fail with ENOENT and take the
// whole `npm run compile` / `npm run watch` down with them (preLaunch.ts runs
// `npm run compile`). This rewrites the scripts block to drop every copilot leg.
// The vscode/ tree is reset every bootstrap run, so this is a clean overlay-style
// edit, not a tracked modification.
//
// The @github/copilot* dependencies in package.json are left alone — they are
// inert without the extension and pulling them would desync package-lock.json.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const pkgPath = join(root, 'vscode', 'package.json');

const raw = readFileSync(pkgPath, 'utf8');
const pkg = JSON.parse(raw);
const scripts = pkg.scripts ?? {};

// npm-run-all2 legs are space-separated task names; drop the copilot ones.
const COPILOT_LEG = /^(compile|watch)-copilot$/;
// Whole script entries that only exist to drive the copilot extension.
const COPILOT_ENTRY = /^(compile-copilot|watch-copilot|watch-copilotd|kill-watch-copilotd|copilot:.+)$/;

let changed = 0;

for (const [name, body] of Object.entries(scripts)) {
	if (COPILOT_ENTRY.test(name)) {
		delete scripts[name];
		changed++;
		continue;
	}
	if (typeof body === 'string' && body.includes('-copilot')) {
		const rewritten = body
			.split(' ')
			.filter(tok => !COPILOT_LEG.test(tok))
			.join(' ')
			.replace(/\s+/g, ' ')
			.trim();
		if (rewritten !== body) {
			scripts[name] = rewritten;
			changed++;
		}
	}
}

if (changed === 0) {
	console.log('strip-copilot-refs: nothing to strip (already clean)');
	process.exit(0);
}

pkg.scripts = scripts;
// Code-OSS's package.json is 2-space indented with a trailing newline.
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
console.log(`strip-copilot-refs: rewrote ${changed} script entr${changed === 1 ? 'y' : 'ies'} in vscode/package.json`);
