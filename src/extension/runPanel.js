const vscode = require('vscode');
const { webviewHtml } = require('./webviewHtml.js');

const BODY = '<div id="run-layout"><aside id="run-tree"></aside><main><div id="run-banner"></div><div id="error" hidden></div><div id="canvas"></div></main><div id="run-splitter" title="Drag to resize, double-click to reset" hidden></div><aside id="run-detail" hidden></aside></div>';

// One webview showing a process run: the instance tree, the diagram of the chosen instance with the run drawn over it.
class RunPanel {
  constructor(context, log) {
    this.context = context;
    this.log = log;
  }

  open(data) {
    const dist = vscode.Uri.joinPath(this.context.extensionUri, 'dist');
    const panel = vscode.window.createWebviewPanel('flowable.run', `Run ${data.rootInstanceId.slice(0, 8)}`, vscode.ViewColumn.Beside, {
      enableScripts: true,
      retainContextWhenHidden: true, // keep the chosen instance and detail panel when the tab is hidden
      localResourceRoots: [dist],
    });
    panel.webview.html = webviewHtml(panel.webview, dist, 'run-webview', BODY);
    panel.webview.onDidReceiveMessage(async (msg) => {
      if (msg.type === 'ready') panel.webview.postMessage({ type: 'run', data });
      else if (msg.type === 'openFile' && msg.uri) vscode.commands.executeCommand('vscode.openWith', vscode.Uri.parse(msg.uri), 'flowable.bpmnEditor');
    });
  }
}

module.exports = { RunPanel };
