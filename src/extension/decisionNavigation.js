const vscode = require('vscode');
const { referenceKeyAt, referenceKeys } = require('../core/dmnValidators.mjs');

const BPMN = [{ pattern: '**/*.bpmn' }, { pattern: '**/*.bpmn20.xml' }];
const COMMAND = 'flowable.openDecision';

// Opens the .dmn file that defines `key` in the DMN editor. With several matches the user picks one.
async function openDecision(index, key) {
  const found = index.find(key);
  if (!found.length) {
    vscode.window.showWarningMessage(index.ready ? `No decision with id "${key}" was found in the .dmn files of this workspace.` : 'Still scanning the workspace for .dmn files, try again in a moment.');
    return;
  }
  let target = found[0];
  if (found.length > 1) {
    const pick = await vscode.window.showQuickPick(found.map((f) => ({ label: vscode.workspace.asRelativePath(f.uri), target: f })), { placeHolder: `Decision "${key}" is defined in several files` });
    if (!pick) return;
    target = pick.target;
  }
  await vscode.commands.executeCommand('vscode.openWith', target.uri, 'flowable.dmnEditor');
}

// In the XML text of a .bpmn file a decisionTableReferenceKey value is
//   - a link (underlined, Ctrl+Click) that opens the decision in the DMN editor, and
//   - a definition (F12 / Go to Definition) that jumps to the <decision> in the .dmn text.
// Only keys that a .dmn file of the workspace defines are linked (all of them while the workspace is still being scanned).
function registerDecisionNavigation(context, index) {
  const range = (doc, r) => new vscode.Range(doc.positionAt(r.start), doc.positionAt(r.end));

  context.subscriptions.push(
    vscode.commands.registerCommand(COMMAND, (key) => openDecision(index, key)),

    vscode.languages.registerDocumentLinkProvider(BPMN, {
      provideDocumentLinks(doc) {
        return referenceKeys(doc.getText())
          .filter((r) => !index.ready || index.find(r.key).length) // while scanning, link everything: the command explains
          .map((r) => {
            const link = new vscode.DocumentLink(range(doc, r), vscode.Uri.parse(`command:${COMMAND}?${encodeURIComponent(JSON.stringify([r.key]))}`));
            link.tooltip = `Open decision "${r.key}"`;
            return link;
          });
      },
    }),

    vscode.languages.registerDefinitionProvider(BPMN, {
      async provideDefinition(doc, position) {
        const hit = referenceKeyAt(doc.getText(), doc.offsetAt(position));
        if (!hit) return null;
        const links = [];
        for (const f of index.find(hit.key)) {
          const target = await vscode.workspace.openTextDocument(f.uri);
          const at = new vscode.Range(target.positionAt(f.start), target.positionAt(f.start));
          links.push({ originSelectionRange: range(doc, hit), targetUri: f.uri, targetRange: at, targetSelectionRange: at });
        }
        return links;
      },
    }),
  );
}

module.exports = { openDecision, registerDecisionNavigation };
