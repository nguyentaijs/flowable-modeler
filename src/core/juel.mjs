// Basic JUEL well-formedness check. It does not evaluate or type-check anything (beans and variables are
// unknowable offline); it finds unterminated ${...} blocks, unbalanced brackets and unclosed string literals.
// Returns [] when fine, otherwise [{message, offset}] with offsets relative to the input string.
export function checkJuelSyntax(text) {
  const problems = [];
  let i = 0;
  while (i < text.length) {
    const open = /[$#]\{/.exec(text.slice(i));
    if (!open) break;
    const start = i + open.index;
    const stack = [];
    let j = start + 2;
    let quote = null;
    let closed = false;
    for (; j < text.length; j++) {
      const c = text[j];
      if (quote) {
        if (c === '\\') j++;
        else if (c === quote) quote = null;
        continue;
      }
      if (c === "'" || c === '"') quote = c;
      else if (c === '(' || c === '[' || c === '{') stack.push(c);
      else if (c === ')' || c === ']') {
        if (stack.pop() !== (c === ')' ? '(' : '[')) {
          problems.push({ message: `Unbalanced '${c}'`, offset: j });
          break;
        }
      } else if (c === '}') {
        if (stack.length === 0) {
          closed = true;
          break;
        }
        if (stack.pop() !== '{') {
          problems.push({ message: "Unbalanced '}'", offset: j });
          break;
        }
      }
    }
    if (problems.length) break;
    if (quote) problems.push({ message: `Unclosed string literal (${quote})`, offset: start });
    else if (!closed) problems.push({ message: `Unterminated expression '${text.slice(start, start + 2)}...'`, offset: start });
    if (quote || !closed) break;
    i = j + 1;
  }
  return problems;
}
