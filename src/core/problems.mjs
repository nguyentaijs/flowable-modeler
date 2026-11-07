// The diagnostics of a document, in the plain form the designer webviews show in their problems bar.
// Input: objects shaped like vscode.Diagnostic ({severity: 0 error | 1 warning | 2 information | 3 hint, message, code,
// range: {start: {line, character}, end: {line, character}}}). Output: plain data that survives postMessage.

const SEVERITIES = ['error', 'warning', 'information', 'hint'];

// A diagnostic code is a string, a number or {value, target}.
const codeOf = (code) => (code && typeof code === 'object' ? String(code.value ?? '') : code === undefined || code === null ? '' : String(code));

export function toProblemItems(diagnostics, limit = 200) {
  return diagnostics
    .map((d) => ({
      severity: SEVERITIES[d.severity] ?? 'warning',
      message: d.message,
      code: codeOf(d.code),
      line: d.range.start.line,
      character: d.range.start.character,
      endLine: d.range.end.line,
      endCharacter: d.range.end.character,
    }))
    .sort((a, b) => SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity) || a.line - b.line || a.character - b.character)
    .slice(0, limit);
}
