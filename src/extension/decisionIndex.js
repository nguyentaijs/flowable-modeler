const vscode = require('vscode');
const { decisionEntries, referenceKeys } = require('../core/dmnValidators.mjs');
const { inScope, describeScope } = require('../core/decisionScope.mjs');

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

  // The scope setting that applies to a .bpmn file (see core/decisionScope.mjs).
  scopeOf(bpmnUri) {
    const config = vscode.workspace.getConfiguration('flowableModeler', bpmnUri);
    return { scope: config.get('decisionScope', 'workspace'), path: config.get('decisionPath', '.'), ignoreCase: process.platform === 'win32' };
  }

  // Can the .bpmn file refer to decisions of this .dmn file? Without a .bpmn (null): everything.
  // `scope` is the already read setting of the .bpmn file; pass it when checking many files, reading it is not free.
  visible(bpmnUri, dmnUri, scope = bpmnUri && this.scopeOf(bpmnUri)) {
    return !bpmnUri || inScope(scope, bpmnUri.path, dmnUri.path);
  }

  describeScope(bpmnUri) {
    return describeScope(bpmnUri ? this.scopeOf(bpmnUri) : { scope: 'workspace' });
  }

  // The decision ids a .bpmn file can see (those of the .dmn files in its scope), or null while still unknown.
  keys(bpmnUri) {
    if (!this.ready) return null;
    const scope = bpmnUri && this.scopeOf(bpmnUri);
    return new Set([...this.files].filter(([uri]) => this.visible(bpmnUri, vscode.Uri.parse(uri), scope)).flatMap(([, list]) => list.map((d) => d.id)));
  }

  // [{uri, start}] of the .dmn files that define this decision id and are in the scope of the .bpmn file.
  find(id, bpmnUri) {
    const scope = bpmnUri && this.scopeOf(bpmnUri);
    return [...this.files].flatMap(([uri, list]) => list.filter((d) => d.id === id).map((d) => ({ uri: vscode.Uri.parse(uri), start: d.start })))
      .filter((f) => this.visible(bpmnUri, f.uri, scope));
  }

  // [{uri, taskId, taskName, taskStart}] of the DMN tasks that refer to this decision id, in the .bpmn files that can see `dmnUri`.
  usedBy(id, dmnUri) {
    const scopes = new Map(); // one read of the setting per .bpmn file, however many tasks it has
    return [...this.usages].flatMap(([uri, list]) => list.filter((u) => u.key === id).map((u) => ({ uri: vscode.Uri.parse(uri), ...u })))
      .filter((u) => {
        const key = u.uri.toString();
        if (!scopes.has(key)) scopes.set(key, this.scopeOf(u.uri));
        return this.visible(u.uri, dmnUri, scopes.get(key));
      });
  }
}

module.exports = { DecisionIndex };
