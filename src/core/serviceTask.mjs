// What a service task declares, read from a generic (no Flowable moddle) bpmn-js business object: how it is
// implemented, its resultVariable, and its field injections. Attributes may sit in $attrs or on the element itself.
const attr = (el, name) => (el.$attrs && (el.$attrs[name] ?? el.$attrs['flowable:' + name])) ?? el[name];
const local = (type) => String(type || '').replace(/^.*:/, '');

function textOf(el) {
  if (typeof el.$body === 'string') return el.$body.trim();
  return (el.$children || []).map((c) => (typeof c === 'string' ? c : c.$body || '')).join('').trim();
}

function fieldOf(el) {
  const name = attr(el, 'name') ?? null;
  if (attr(el, 'stringValue') != null) return { name, kind: 'string', value: attr(el, 'stringValue') };
  if (attr(el, 'expression') != null) return { name, kind: 'expression', value: attr(el, 'expression') };
  for (const child of el.$children || []) {
    const kind = local(child.$type);
    if (kind === 'string' || kind === 'expression') return { name, kind, value: textOf(child) };
  }
  return { name, kind: 'string', value: '' };
}

export function serviceTaskInfo(bo) {
  const info = { implementation: null, resultVariable: attr(bo, 'resultVariable') ?? null, fields: [] };
  for (const kind of ['class', 'delegateExpression', 'expression']) {
    const v = attr(bo, kind);
    if (typeof v === 'string' && v) {
      info.implementation = { kind, value: v };
      break;
    }
  }
  for (const el of (bo.extensionElements && bo.extensionElements.values) || []) {
    if (local(el.$type) === 'field') info.fields.push(fieldOf(el));
  }
  return info;
}
