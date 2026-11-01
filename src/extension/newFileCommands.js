const vscode = require('vscode');
const { newBpmn, newDmn } = require('../core/templates.mjs');

const KINDS = {
  bpmn: { ext: '.bpmn', make: newBpmn, editor: 'flowable.bpmnEditor', prompt: 'Process name (the file name and the process id)', value: 'process' },
  dmn: { ext: '.dmn', make: newDmn, editor: 'flowable.dmnEditor', prompt: 'Decision name (the file name and the decision id)', value: 'decision' },
};

// Folder for the new file: the folder (or file's folder) picked in the Explorer, else the folder of the active editor,
// else the first workspace folder.
async function targetFolder(arg) {
  const isDir = async (uri) => {
    try { return ((await vscode.workspace.fs.stat(uri)).type & vscode.FileType.Directory) !== 0; } catch { return false; }
  };
  const parent = (uri) => vscode.Uri.joinPath(uri, '..');
  if (arg?.scheme) return (await isDir(arg)) ? arg : parent(arg);
  const active = vscode.window.activeTextEditor?.document.uri ?? vscode.window.tabGroups.activeTabGroup.activeTab?.input?.uri;
  if (active?.scheme === 'file') return parent(active);
  return vscode.workspace.workspaceFolders?.[0]?.uri;
}

async function createFile(kind, arg) {
  const k = KINDS[kind];
  const folder = await targetFolder(arg);
  if (!folder) {
    vscode.window.showErrorMessage('Open a folder first, then create the file there.');
    return;
  }
  const input = await vscode.window.showInputBox({
    prompt: k.prompt,
    value: k.value,
    validateInput: (v) => (/^[^\\/:*?"<>|]+$/.test(v.trim()) ? undefined : 'Enter a file name without path characters'),
  });
  if (!input) return;
  const name = input.trim().replace(/\.(bpmn20\.xml|bpmn|dmn)$/i, '');
  const uri = vscode.Uri.joinPath(folder, name + k.ext);
  try {
    await vscode.workspace.fs.stat(uri);
    vscode.window.showErrorMessage(`${name + k.ext} already exists in ${vscode.workspace.asRelativePath(folder)}.`);
    return;
  } catch { /* does not exist: good */ }
  await vscode.workspace.fs.writeFile(uri, Buffer.from(k.make(uri.path), 'utf8'));
  await vscode.commands.executeCommand('vscode.openWith', uri, k.editor);
}

function registerNewFileCommands(context) {
  context.subscriptions.push(
    vscode.commands.registerCommand('flowable.newBpmn', (arg) => createFile('bpmn', arg)),
    vscode.commands.registerCommand('flowable.newDmn', (arg) => createFile('dmn', arg)),
  );
}

module.exports = { registerNewFileCommands };
