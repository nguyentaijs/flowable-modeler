const vscode = require('vscode');
const { XmlEditorProvider } = require('./xmlEditorProvider.js');
const { decisionKeys } = require('../core/dmnValidators.mjs');
const { newDmn } = require('../core/templates.mjs');

class DmnEditorProvider extends XmlEditorProvider {
  static viewType = 'flowable.dmnEditor';
  webviewName = 'dmn-webview';
  bodyHtml = '<div id="error" hidden></div><div id="app"></div><a id="author-link" href="https://www.linkedin.com/in/nguyentaijs" title="Opens LinkedIn">Contact</a>';

  constructor(context, log, index) {
    super(context, log);
    this.index = index;
  }

  emptyTemplate(document) {
    return newDmn(document.uri.path);
  }

  // "Used by": the DMN tasks of the workspace's .bpmn files that refer to each decision of this document.
  // Sent when the webview is ready and again whenever the workspace index changes.
  onWebviewMessage(msg, document, panel) {
    if (msg.type === 'ready') {
      const send = () => panel.webview.postMessage({ type: 'usedBy', usages: this.usagesFor(document) });
      send();
      const sub = this.index.onDidChange(send);
      panel.onDidDispose(() => sub.dispose());
      return false; // the base class still loads the document
    }
    if (msg.type === 'openUsage') {
      vscode.commands.executeCommand('vscode.openWith', vscode.Uri.parse(msg.uri), 'flowable.bpmnEditor');
      return true;
    }
    return false;
  }

  usagesFor(document) {
    const usages = {};
    for (const id of decisionKeys(document.getText())) {
      usages[id] = this.index.usedBy(id, document.uri).map((u) => ({ uri: u.uri.toString(), file: vscode.workspace.asRelativePath(u.uri), task: u.taskName || u.taskId }));
    }
    return { ready: this.index.ready, byDecision: usages, scope: this.index.describeScope(document.uri) };
  }
}

module.exports = { DmnEditorProvider };
