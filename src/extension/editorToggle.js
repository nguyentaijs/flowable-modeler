const vscode = require('vscode');

const isDmn = (uri) => /\.dmn$/i.test(uri.path);

// The file a title-bar command acts on: its argument, else the active tab (text or custom editor).
function targetUri(arg) {
  if (arg instanceof vscode.Uri) return arg;
  const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
  return input?.uri;
}

// Title-bar buttons to switch the same file between the designer and its XML text.
function registerEditorToggle(context) {
  context.subscriptions.push(
    vscode.commands.registerCommand('flowable.openAsText', (arg) => {
      const uri = targetUri(arg);
      if (uri) return vscode.commands.executeCommand('vscode.openWith', uri, 'default');
    }),
    vscode.commands.registerCommand('flowable.openInDesigner', (arg) => {
      const uri = targetUri(arg);
      if (uri) return vscode.commands.executeCommand('vscode.openWith', uri, isDmn(uri) ? 'flowable.dmnEditor' : 'flowable.bpmnEditor');
    }),
  );
}

module.exports = { registerEditorToggle };
