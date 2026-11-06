const crypto = require('crypto');
const vscode = require('vscode');

// Page shell of a bundled webview: strict CSP (script by nonce only), stylesheet and script from dist/<name>.{css,js}.
function webviewHtml(webview, dist, name, bodyHtml) {
  const uri = (f) => webview.asWebviewUri(vscode.Uri.joinPath(dist, f));
  const nonce = crypto.randomBytes(16).toString('base64');
  const csp = [
    "default-src 'none'",
    `script-src 'nonce-${nonce}'`,
    `style-src ${webview.cspSource} 'unsafe-inline'`,
    `font-src ${webview.cspSource} data:`,
    `img-src ${webview.cspSource} data:`,
  ].join('; ');
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<link rel="stylesheet" href="${uri(name + '.css')}">
</head><body>
${bodyHtml}
<script nonce="${nonce}" src="${uri(name + '.js')}"></script>
</body></html>`;
}

module.exports = { webviewHtml };
