const vscode = require('vscode');
const { validate } = require('../core/validators.mjs');

const SEVERITY = {
  error: vscode.DiagnosticSeverity.Error,
  warning: vscode.DiagnosticSeverity.Warning,
  information: vscode.DiagnosticSeverity.Information,
};

const isBpmn = (doc) => /\.bpmn(20\.xml)?$/i.test(doc.fileName);
const isDmn = (doc) => /\.dmn$/i.test(doc.fileName);

// Publishes validator results as VS Code diagnostics for every open BPMN and DMN document.
//
// Cross-file check: a BPMN DMN task naming a decision that no .dmn file defines is reported (see decisionIndex.js).
function registerDiagnostics(context, index) {
  const collection = vscode.languages.createDiagnosticCollection('flowable');
  const timers = new Map();

  const refresh = (doc) => {
    if (!isBpmn(doc) && !isDmn(doc)) return;
    const config = vscode.workspace.getConfiguration('flowableModeler', doc.uri);
    const results = validate(doc.getText(), {
      disabled: config.get('disabledValidators', []),
      config: { passThroughNamespaces: config.get('passThroughNamespaces', ['design']), dmnDecisionKeys: index.keys(isBpmn(doc) ? doc.uri : null), dmnScope: index.describeScope(doc.uri) },
    });
    collection.set(
      doc.uri,
      results.map((r) => {
        const d = new vscode.Diagnostic(new vscode.Range(doc.positionAt(r.start), doc.positionAt(r.end)), r.message, SEVERITY[r.severity] ?? SEVERITY.warning);
        d.source = 'flowable';
        d.code = r.validator;
        return d;
      }),
    );
  };

  const refreshBpmn = () => vscode.workspace.textDocuments.filter(isBpmn).forEach(refresh);

  const schedule = (doc) => {
    const key = doc.uri.toString();
    clearTimeout(timers.get(key));
    timers.set(key, setTimeout(async () => {
      timers.delete(key);
      if (isDmn(doc) || isBpmn(doc)) {
        index.setText(doc); // live text, so unsaved edits count
        index.notify(); // re-checks the BPMN files and refreshes the DMN editors' "used by"
      }
      refresh(doc);
    }, 300));
  };

  context.subscriptions.push(
    collection,
    index.onDidChange(refreshBpmn),
    vscode.workspace.onDidOpenTextDocument(refresh),
    vscode.workspace.onDidChangeTextDocument((e) => schedule(e.document)),
    vscode.workspace.onDidCloseTextDocument((doc) => {
      clearTimeout(timers.get(doc.uri.toString()));
      timers.delete(doc.uri.toString());
      collection.delete(doc.uri);
    }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('flowableModeler.decisionScope') || e.affectsConfiguration('flowableModeler.decisionPath')) index.notify(); // "Used by" of the open DMN editors
      if (e.affectsConfiguration('flowableModeler')) vscode.workspace.textDocuments.forEach(refresh);
    }),
  );

  vscode.workspace.textDocuments.forEach(refresh);
}

module.exports = { registerDiagnostics };
