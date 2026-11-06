// Which .dmn files a .bpmn file may refer to (setting flowableModeler.decisionScope):
//   workspace   any .dmn of the workspace (default)
//   path        the .dmn is in a given folder or below it; the folder is relative to the .bpmn's directory ("." = that directory)
//   sameFolder  the .dmn is in the same directory as the .bpmn
// Paths are the "/" separated paths of the files (uri.path); no vscode here, so it is unit-tested.

export const SCOPES = ['sameFolder', 'path', 'workspace'];

const dirOf = (p) => p.slice(0, Math.max(p.lastIndexOf('/'), 0));

// Resolves "." / ".." / "a/b" segments of `p` (a "/" path, already absolute).
function normalize(p) {
  const out = [];
  for (const part of p.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') out.pop();
    else out.push(part);
  }
  return '/' + out.join('/');
}

// The folder a `path` scope searches: absolute as given, otherwise relative to the .bpmn's directory.
export function scopeFolder(bpmnPath, folder = '.') {
  const f = folder.trim().replace(/\\/g, '/') || '.';
  const absolute = f.startsWith('/') || /^[A-Za-z]:\//.test(f);
  if (!absolute) return normalize(dirOf(bpmnPath) + '/' + f);
  return normalize(/^[A-Za-z]:\//.test(f) ? '/' + f : f); // "C:/x" -> "/C:/x", like a Windows uri.path
}

export function inScope({ scope = 'workspace', path: folder = '.', ignoreCase = false }, bpmnPath, dmnPath) {
  if (scope === 'workspace') return true;
  const fold = (s) => (ignoreCase ? s.toLowerCase() : s);
  const dmnDir = fold(normalize(dirOf(dmnPath)));
  if (scope === 'path') {
    const root = fold(scopeFolder(bpmnPath, folder));
    return dmnDir === root || dmnDir.startsWith(root === '/' ? '/' : root + '/');
  }
  return dmnDir === fold(normalize(dirOf(bpmnPath)));
}

// For messages: "in the same folder" / "in or below <folder>" / "in this workspace".
export function describeScope({ scope = 'workspace', path: folder = '.' }) {
  if (scope === 'workspace') return 'in this workspace';
  if (scope === 'path') return `in or below "${folder.trim() || '.'}"`;
  return 'in the same folder';
}
