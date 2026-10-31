// The in/out parameters of a call activity, from the children of its extensionElements. They are read as generic
// elements (the run viewer has no Flowable moddle), so attributes may sit in $attrs or directly on the element.
const attr = (el, name) => (el.$attrs && el.$attrs[name]) ?? el[name];
const local = (type) => String(type || '').replace(/^.*:/, '');

function describe(el) {
  return {
    source: attr(el, 'source') ?? null,
    sourceExpression: attr(el, 'sourceExpression') ?? null,
    target: attr(el, 'target') ?? null,
    targetExpression: attr(el, 'targetExpression') ?? null,
  };
}

export function callParameters(extensionValues) {
  const out = { in: [], out: [] };
  for (const el of extensionValues || []) {
    const kind = local(el.$type);
    if (kind === 'in' || kind === 'out') out[kind].push(describe(el));
  }
  return out;
}
