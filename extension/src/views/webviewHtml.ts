/**
 * The webview HTML shell — extracted vcode-free so the security boundary
 * (CSP + nonce + resource URIs) is unit-testable.
 */
export interface ShellParams {
  nonce: string;
  /** `webview.cspSource` — the only origin allowed for styles/img/font. */
  cspSource: string;
  title: string;
  tokensUri: string;
  viewCssUri: string;
  scriptUri: string;
}

export function webviewHtml(p: ShellParams): string {
  const csp = [
    `default-src 'none'`,
    `img-src ${p.cspSource} data:`,
    `style-src ${p.cspSource} 'unsafe-inline'`,
    `font-src ${p.cspSource}`,
    `script-src 'nonce-${p.nonce}'`,
  ].join("; ");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link rel="stylesheet" href="${p.tokensUri}" />
  <link rel="stylesheet" href="${p.viewCssUri}" />
  <title>${p.title}</title>
</head>
<body>
  <div id="root"></div>
  <script nonce="${p.nonce}" src="${p.scriptUri}"></script>
</body>
</html>`;
}
