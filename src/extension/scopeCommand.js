const vscode = require('vscode');

// "Flowable: Configure Lookup Scope (Used By)": picks flowableModeler.decisionScope (and, for "path", flowableModeler.decisionPath)
// and saves it for the workspace. The settings are read per .bpmn file, so a workspace folder can still override them.
function registerScopeCommand(context) {
  context.subscriptions.push(vscode.commands.registerCommand('flowable.configureDecisionScope', async () => {
    const config = vscode.workspace.getConfiguration('flowableModeler');
    const current = config.get('decisionScope', 'workspace');
    const items = [
      { label: 'Workspace', description: 'default', detail: 'A BPMN file sees every .dmn file of the workspace', value: 'workspace' },
      { label: 'Same folder', detail: 'A BPMN file sees the .dmn files of its own folder only (use it when copies exist in other folders)', value: 'sameFolder' },
      { label: 'Path', detail: 'A BPMN file sees the .dmn files of a folder (and below), given relative to its own folder', value: 'path' },
    ].map((i) => ({ ...i, picked: i.value === current, description: [i.description, i.value === current ? 'current' : ''].filter(Boolean).join(', ') }));
    const pick = await vscode.window.showQuickPick(items, { title: 'Flowable: where does a BPMN file look for its decisions?', placeHolder: 'Lookup scope for "Used by", missing-decision warnings and Open decision' });
    if (!pick) return;
    let folder;
    if (pick.value === 'path') {
      folder = await vscode.window.showInputBox({
        title: 'Folder to search',
        prompt: 'Relative to the .bpmn file\'s own folder ("." = the current folder, ".." = its parent, "../dmn"), or an absolute path. Subfolders are included.',
        value: config.get('decisionPath', '.') || '.',
        validateInput: (v) => (v.trim() ? null : 'Enter a folder, "." for the current one'),
      });
      if (folder === undefined) return;
    }
    const target = vscode.workspace.workspaceFolders ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global;
    await config.update('decisionScope', pick.value, target);
    if (folder !== undefined) await config.update('decisionPath', folder.trim(), target);
    vscode.window.setStatusBarMessage(`Flowable: decisions are searched ${pick.value === 'path' ? `in or below "${folder.trim()}"` : pick.value === 'workspace' ? 'in the whole workspace' : 'in the same folder'}`, 5000);
  }));
}

module.exports = { registerScopeCommand };
