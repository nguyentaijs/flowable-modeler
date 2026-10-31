const vscode = require('vscode');
const { decisionEntries, referenceKeys } = require('../core/dmnValidators.mjs');

const isDmn = (uri) => /\.dmn$/i.test(uri.path);
const isBpmn = (uri) => /\.bpmn(20\.xml)?$/i.test(uri.path);

// Index of the workspace's decisions and of who uses them:
//   - decisions: which .dmn file defines which decision id, and where
//   - usages:    which DMN tasks of which .bpmn files name which decision id (decisionTableReferenceKey)
// It is kept current from open (possibly unsaved) documents and from file watchers. Until the first scan finishes
// `ready` is false and the answers are unknown, so nothing should be reported as missing.
class DecisionIndex {
  constructor(context) {
    this.files = new Map(); // .dmn uri string -> [{id, start}]
    this.usages = new Map(); // .bpmn uri string -> [{key, taskId, taskName, taskStart}]
    this.ready = false;
    this._changed = new vscode.EventEmitter();
    this.onDidChange = this._changed.event;

    const watchers = ['**/*.dmn', '**/*.bpmn', '**/*.bpmn20.xml'].map((glob) => vscode.workspace.createFileSystemWatcher(glob));
    for (const w of watchers) {
      context.subscriptions.push(
        w,
        w.onDidCreate((uri) => this.update(uri)),
        w.onDidChange((uri) => this.update(uri)),
        w.onDidDelete((uri) => {
          this.files.delete(uri.toString());
          this.usages.delete(uri.toString());
          this._changed.fire();
        }),
      );
    }
    context.subscriptions.push(this._changed);
    Promise.all(['**/*.dmn', '**/*.bpmn', '**/*.bpmn20.xml'].map((glob) => vscode.workspace.findFiles(glob, '**/node_modules/**')))
      .then(async (lists) => {
        await Promise.all(lists.flat().map((u) => this.read(u)));
        this.ready = true;
        this._changed.fire();
      });
  }

  async read(uri) {
    try {
      const open = vscode.workspace.textDocuments.find((d) => d.uri.toString() === uri.toString());
      const text = open ? open.getText() : Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8');
      this.index(uri, text);
    } catch {
      this.files.delete(uri.toString());
      this.usages.delete(uri.toString());
    }
  }

  index(uri, text) {
    if (isDmn(uri)) this.files.set(uri.toString(), decisionEntries(text));
    else if (isBpmn(uri)) this.usages.set(uri.toString(), referenceKeys(text).map(({ key, taskId, taskName, taskStart }) => ({ key, taskId, taskName, taskStart })));
  }

  async update(uri) {
    await this.read(uri);
    this._changed.fire();
  }

  // Index from live text, for a document being edited.
  setText(doc) {
    this.index(doc.uri, doc.getText());
  }

  // Tell listeners (diagnostics, the DMN editors' "used by") that the index changed.
  notify() {
    this._changed.fire();
  }

  // Every decision id of the workspace, or null while still unknown.
  keys() {
    return this.ready ? new Set([...this.files.values()].flat().map((d) => d.id)) : null;
  }

  // [{uri, start}] of the files that define this decision id.
  find(id) {
    return [...this.files].flatMap(([uri, list]) => list.filter((d) => d.id === id).map((d) => ({ uri: vscode.Uri.parse(uri), start: d.start })));
  }

  // [{uri, taskId, taskName, taskStart}] of the DMN tasks that refer to this decision id.
  usedBy(id) {
    return [...this.usages].flatMap(([uri, list]) => list.filter((u) => u.key === id).map((u) => ({ uri: vscode.Uri.parse(uri), ...u })));
  }
}

module.exports = { DecisionIndex };
