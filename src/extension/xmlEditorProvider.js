const vscode = require('vscode');
const { diffXml } = require('../core/differ.mjs');
const { parseXml, canon, rootElement, firstDifference } = require('../core/xml.mjs');
const { applyEdits } = require('../core/differ.mjs');
const { webviewHtml } = require('./webviewHtml.js');
const { toProblemItems } = require('../core/problems.mjs');

// Custom text editor whose webview edits an XML document. The document text stays the source of truth: the webview
// sends the whole serialized XML after each change and the host writes only the diff (see core/differ.mjs).
//
// A subclass sets
//   static viewType     the customEditors viewType from package.json
//   webviewName         file stem of the bundles in dist/ (<stem>.js and <stem>.css)
//   bodyHtml            markup of the webview body
// and may pass a shared output channel to the constructor.
class XmlEditorProvider {
  webviewName = 'webview';
  bodyHtml = '';

  constructor(context, log) {
    this.context = context;
    this.log = log ?? vscode.window.createOutputChannel('Flowable Community Modeler');
    if (!log) context.subscriptions.push(this.log);
  }

  resolveCustomTextEditor(document, panel) {
    const dist = vscode.Uri.joinPath(this.context.extensionUri, 'dist');
    panel.webview.options = { enableScripts: true, localResourceRoots: [dist] };
    panel.webview.html = this.html(panel.webview, dist);

    // The webview already shows this text (it produced it, or we sent it); never reload it with the same text.
    let shownText = null;
    let applying = false;
    let queue = Promise.resolve();
    const log = (m) => this.log.appendLine(`[${new Date().toISOString()}] ${m}`);

    const send = async () => {
      // An empty file cannot be opened as a model: start it with the subclass's template (one undoable edit).
      const starter = document.getText().trim() === '' ? this.emptyTemplate?.(document) : null;
      if (starter) {
        const we = new vscode.WorkspaceEdit();
        we.replace(document.uri, new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)), starter);
        applying = true;
        const ok = await vscode.workspace.applyEdit(we);
        applying = false;
        log(`empty file: inserted the starting model -> ${ok}`);
      }
      shownText = document.getText();
      log(`load -> webview (${shownText.length} chars)`);
      return panel.webview.postMessage({ type: 'load', xml: shownText });
    };

    const onWebviewChanged = async (xml) => {
      const original = document.getText();
      let edits;
      try {
        edits = diffXml(original, xml);
        log(`changed <- webview: ${edits.length} edit(s)`);
        if (!edits.length) return;
        const patched = applyEdits(original, edits);
        const a = rootElement(parseXml(patched));
        const b = rootElement(parseXml(xml));
        if (canon(a) !== canon(b)) {
          const where = firstDifference(a, b);
          this.log.appendLine(`[${new Date().toISOString()}] patch mismatch in ${document.uri.fsPath}
${where}
`);
          this.log.show(true);
          throw new Error('patched text does not match the modeler output (see output channel "Flowable Community Modeler")');
        }
        const we = new vscode.WorkspaceEdit();
        for (const e of edits) {
          we.replace(document.uri, new vscode.Range(document.positionAt(e.start), document.positionAt(e.end)), e.text);
        }
        applying = true;
        shownText = patched;
        const ok = await vscode.workspace.applyEdit(we);
        applying = false;
        log(`applyEdit -> ${ok}; document is now ${document.getText() === patched ? 'as patched' : 'DIFFERENT from patched'}`);
        if (!ok) shownText = null;
      } catch (err) {
        applying = false;
        shownText = null;
        log('error: ' + err.stack);
        vscode.window.showErrorMessage('Flowable Community Modeler could not apply the change: ' + err.message);
      }
    };

    const sub = vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document.uri.toString() !== document.uri.toString()) return;
      log(`document event: ${e.contentChanges.length} change(s), reason=${e.reason ?? '-'}, applying=${applying}`);
      if (applying || e.contentChanges.length === 0) return; // our own edit, or a dirty/save notification
      if (document.getText() === shownText) return; // the webview already has this text
      send(); // external change, undo/redo, or git checkout
    });
    panel.onDidDispose(() => sub.dispose());

    // The validators' diagnostics of this file, shown by the webview's problems bar (a click in the Problems panel opens this
    // editor, which cannot show a text selection, so the bar lists them and links to the XML line).
    const pushProblems = () => panel.webview.postMessage({ type: 'problems', items: toProblemItems(vscode.languages.getDiagnostics(document.uri)) });
    const problemsSub = vscode.languages.onDidChangeDiagnostics((e) => {
      if (e.uris.some((u) => u.toString() === document.uri.toString())) pushProblems();
    });
    panel.onDidDispose(() => problemsSub.dispose());

    panel.webview.onDidReceiveMessage((msg) => {
      if (this.onWebviewMessage?.(msg, document, panel)) return; // subclass-specific messages (return true when handled)
      if (msg.type === 'log') log('webview: ' + msg.text);
      else if (msg.type === 'ready') {
        send();
        pushProblems();
      } else if (msg.type === 'changed') queue = queue.then(() => onWebviewChanged(msg.xml));
      else if (msg.type === 'showText') {
        const selection = new vscode.Range(msg.line, msg.character, msg.endLine, msg.endCharacter);
        vscode.commands.executeCommand('vscode.openWith', document.uri, 'default', { selection });
      }
    });
  }

  html(webview, dist) {
    return webviewHtml(webview, dist, this.webviewName, this.bodyHtml);
  }
}

module.exports = { XmlEditorProvider };
