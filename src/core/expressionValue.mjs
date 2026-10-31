// Resolves the simple JUEL expressions of a field (${a.b.c}, ${list[0]}, ${map['key']}) against process variables.
// Anything that needs real evaluation (operators, calls, ternaries) is reported as unresolved, never guessed.
const STEP = /^(?:\.([A-Za-z_$][\w$]*)|\[(\d+)\]|\[\s*(?:'([^']*)'|"([^"]*)")\s*\])/;
const HEAD = /^[A-Za-z_$][\w$]*/;

// path text (without ${ }) -> { found, value } or null when it is not a plain path
function walk(path, variables) {
  const text = path.trim();
  const head = HEAD.exec(text);
  if (!head) return null;
  let rest = text.slice(head[0].length);
  let value = variables ? variables[head[0]] : undefined;
  let found = variables ? head[0] in variables : false;
  while (rest) {
    const m = STEP.exec(rest);
    if (!m) return null;
    rest = rest.slice(m[0].length);
    const key = m[1] ?? m[3] ?? m[4] ?? Number(m[2]);
    if (found && value !== null && typeof value === 'object' && key in Object(value)) value = value[key];
    else found = false;
  }
  return { found, value };
}

const show = (v) => (typeof v === 'string' ? v : JSON.stringify(v));

// -> { resolved: true, value } | { resolved: false, reason: 'not found' | 'not a simple path' }
export function resolveExpression(text, variables) {
  const source = String(text ?? '');
  const parts = [...source.matchAll(/[$#]\{([^}]*)\}/g)];
  if (!parts.length) return { resolved: true, value: source };
  const whole = parts.length === 1 && parts[0][0] === source.trim() ? parts[0] : null;
  const values = [];
  for (const p of parts) {
    const r = walk(p[1], variables);
    if (!r) return { resolved: false, reason: 'not a simple path' };
    if (!r.found) return { resolved: false, reason: 'not found' };
    values.push(r.value);
  }
  if (whole) return { resolved: true, value: values[0] };
  let i = 0;
  return { resolved: true, value: source.replace(/[$#]\{([^}]*)\}/g, () => show(values[i++])) };
}
