/**
 * The webview HTML shell's security boundary (ARCHITECTURE-VSCODE.md standing
 * gates): a strict CSP, a nonce that gates the only <script>, and every
 * resource served from `webview.cspSource`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { webviewHtml } from "../src/views/webviewHtml.ts";

const shell = webviewHtml({
  nonce: "NONCE123",
  cspSource: "vscode-webview://abc",
  title: "valyria.activity",
  tokensUri: "vscode-webview://abc/out/webviews/tokens.css",
  viewCssUri: "vscode-webview://abc/out/webviews/activity.css",
  scriptUri: "vscode-webview://abc/out/webviews/activity.js",
});

test("default-src is 'none'", () => {
  assert.match(shell, /Content-Security-Policy[^>]*default-src 'none'/);
});

test("scripts are gated by the nonce and nothing else", () => {
  assert.match(shell, /script-src 'nonce-NONCE123'/);
  assert.doesNotMatch(shell, /script-src[^;"]*'unsafe-inline'/);
  // the one script tag carries the nonce
  const scripts = [...shell.matchAll(/<script\b[^>]*>/g)];
  assert.equal(scripts.length, 1);
  assert.match(scripts[0]![0], /nonce="NONCE123"/);
});

test("styles and fonts are limited to the webview origin", () => {
  assert.match(shell, /style-src vscode-webview:\/\/abc 'unsafe-inline'/);
  assert.match(shell, /font-src vscode-webview:\/\/abc/);
});

test("every linked resource is under cspSource", () => {
  const hrefs = [...shell.matchAll(/(?:href|src)="([^"]+)"/g)].map((m) => m[1]!);
  assert.ok(hrefs.length >= 3);
  for (const h of hrefs) {
    assert.ok(h.startsWith("vscode-webview://abc/"), `resource escapes cspSource: ${h}`);
  }
});

test("there is a mount point", () => {
  assert.match(shell, /<div id="root">/);
});
