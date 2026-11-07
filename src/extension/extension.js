const vscode = require('vscode');
const { BpmnEditorProvider } = require('./bpmnEditorProvider.js');
const { DmnEditorProvider } = require('./dmnEditorProvider.js');
const { registerDiagnostics } = require('./diagnostics.js');
const { DecisionIndex } = require('./decisionIndex.js');
const { registerDecisionNavigation } = require('./decisionNavigation.js');
const { registerRunCommands } = require('./runCommands.js');
const { registerNewFileCommands } = require('./newFileCommands.js');
const { registerScopeCommand } = require('./scopeCommand.js');
const { registerEditorToggle } = require('./editorToggle.js');

function activate(context) {
  const index = new DecisionIndex(context);
  registerDiagnostics(context, index);
  registerDecisionNavigation(context, index);
  registerNewFileCommands(context);
  registerScopeCommand(context);
  registerEditorToggle(context);
  const channel = vscode.window.createOutputChannel('Flowable Modeler');
  context.subscriptions.push(channel);
  registerRunCommands(context, index, (m) => channel.appendLine(`[${new Date().toISOString()}] ${m}`));
  const options = { webviewOptions: { retainContextWhenHidden: false }, supportsMultipleEditorsPerDocument: false };
  for (const Provider of [BpmnEditorProvider, DmnEditorProvider]) {
    context.subscriptions.push(vscode.window.registerCustomEditorProvider(Provider.viewType, new Provider(context, channel, index), options));
  }
}

module.exports = { activate, deactivate() {} };
