// Validator registry. A validator is
//   { name, description, severity?, kind?, appliesTo?, check(el, ctx) | checkDocument(ctx) }
// and returns [{message, start?, end?, severity?}] (offsets into the document text; default: the element's
// opening tag). `kind` is the document type it runs on, 'bpmn' (default), 'dmn', or an array of them. `appliesTo` is an array of local element names or a predicate (el) => boolean.
//
//   const off = registerValidator({ name: 'my-rule', appliesTo: ['serviceTask'], check: (el, ctx) => [...] });
//   validate(text, { disabled: ['juel-syntax'] })  ->  diagnostics
import { parseXml, rootElement, elementChildren, idOf } from './xml.mjs';
import { attributeKey, attributeSpec, childSpec, elementSchema, getSchema, localName } from './schema.mjs';
import { checkJuelSyntax } from './juel.mjs';
import { EXPRESSION_ELEMENTS } from './rules.mjs';
import { registerDmnValidators } from './dmnValidators.mjs';

const validators = [];

export function registerValidator(v) {
  if (!v.name || (typeof v.check !== 'function' && typeof v.checkDocument !== 'function')) {
    throw new Error('A validator needs a name and a check(el, ctx) or checkDocument(ctx) function');
  }
  if (validators.some((x) => x.name === v.name)) throw new Error(`Validator "${v.name}" is already registered`);
  validators.push(v);
  return () => {
    const i = validators.indexOf(v);
    if (i >= 0) validators.splice(i, 1);
  };
}

export const listValidators = () => validators.map(({ name, description, severity }) => ({ name, description, severity: severity ?? 'warning' }));

const matches = (v, el) => !v.appliesTo || (Array.isArray(v.appliesTo) ? v.appliesTo.includes(localName(el.name)) : v.appliesTo(el));

function* walk(el) {
  yield el;
  for (const c of elementChildren(el)) yield* walk(c);
}

const attr = (el, name) => el.attrs.find((a) => a.name === name);
const tag = (el) => ({ start: el.start, end: el.openEnd });
const attrRange = (a) => ({ start: a.start, end: a.end });

export function validate(text, options = {}) {
  const disabled = new Set(options.disabled ?? []);
  let root;
  try {
    root = rootElement(parseXml(text));
    if (!root) throw new Error('no root element');
  } catch (err) {
    return [{ validator: 'xml-well-formed', severity: 'error', message: `Not well-formed XML: ${err.message}`, start: 0, end: Math.min(text.length, 1) }];
  }
  const elements = [...walk(root)];
  const byId = new Map();
  for (const el of elements) {
    const id = idOf(el);
    if (id !== undefined) byId.set(id, [...(byId.get(id) ?? []), el]);
  }
  // prefix -> namespace URI, from the root's xmlns declarations
  const prefixes = Object.fromEntries(root.attrs.filter((a) => a.name.startsWith('xmlns:')).map((a) => [a.name.slice(6), a.value]));
  // the document type is told by the namespace of the root element (.../BPMN/... or .../DMN/...)
  const rootNs = root.attrs.find((a) => a.name === 'xmlns')?.value ?? '';
  const kind = /DMN/i.test(rootNs) ? 'dmn' : 'bpmn';
  const ctx = { kind, text, root, elements, byId, prefixes, schema: getSchema(), config: { passThroughNamespaces: ['design'], ...options.config }, attr, tag, attrRange };

  const out = [];
  const add = (v, el, d) => out.push({ validator: v.name, severity: d.severity ?? v.severity ?? 'warning', message: d.message, ...(d.start === undefined ? tag(el) : { start: d.start, end: d.end ?? d.start }) });
  for (const v of validators) {
    if (disabled.has(v.name) || ![].concat(v.kind ?? 'bpmn').includes(kind)) continue;
    try {
      if (v.checkDocument) for (const d of v.checkDocument(ctx) ?? []) add(v, root, d);
      if (v.check) for (const el of elements) if (matches(v, el)) for (const d of v.check(el, ctx) ?? []) add(v, el, d);
    } catch (err) {
      out.push({ validator: v.name, severity: 'error', message: `Validator "${v.name}" crashed: ${err.message}`, ...tag(root) });
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

// ---- Default validators ---------------------------------------------------------------------------------

registerValidator({
  name: 'unique-ids',
  description: 'Element ids must be unique in the document',
  severity: 'error',
  kind: ['bpmn', 'dmn'],
  checkDocument: (ctx) => [...ctx.byId].filter(([, els]) => els.length > 1).flatMap(([id, els]) => els.slice(1).map((el) => ({ message: `Duplicate id "${id}"`, ...attrRange(attr(el, 'id')) }))),
});

registerValidator({
  name: 'sequence-flow-refs',
  description: 'sourceRef/targetRef of a sequence flow must point to existing elements',
  severity: 'error',
  appliesTo: ['sequenceFlow'],
  check: (el, ctx) => ['sourceRef', 'targetRef'].flatMap((n) => {
    const a = attr(el, n);
    if (!a) return [{ message: `Sequence flow has no ${n}` }];
    return ctx.byId.has(a.value) ? [] : [{ message: `${n} "${a.value}" does not exist`, ...attrRange(a) }];
  }),
});

registerValidator({
  name: 'gateway-flows',
  description: 'Exclusive/inclusive gateway: default must be an outgoing flow; other outgoing flows need a condition',
  appliesTo: ['exclusiveGateway', 'inclusiveGateway'],
  check: (el, ctx) => {
    const id = idOf(el);
    const outgoing = ctx.elements.filter((e) => localName(e.name) === 'sequenceFlow' && attr(e, 'sourceRef')?.value === id);
    const def = attr(el, 'default');
    const problems = [];
    if (def && !outgoing.some((f) => idOf(f) === def.value)) problems.push({ severity: 'error', message: `default "${def.value}" is not an outgoing flow of this gateway`, ...attrRange(def) });
    if (outgoing.length > 1) {
      for (const f of outgoing) {
        const hasCondition = elementChildren(f).some((c) => localName(c.name) === 'conditionExpression');
        if (!hasCondition && idOf(f) !== def?.value) problems.push({ message: `Flow "${idOf(f)}" leaves gateway "${id}" without a condition and is not the default flow`, ...tag(f) });
      }
    }
    return problems;
  },
});

registerValidator({
  name: 'required-fields',
  description: 'Elements that need an attribute or field to be executable',
  checkDocument: (ctx) => ctx.elements.flatMap((el) => {
    const n = localName(el.name);
    const flowableAttr = (name) => el.attrs.find((a) => attributeKey(a).name === name && ctx.prefixes[attributeKey(a).ns] === ctx.schema.namespaces.flowable);
    if (n === 'callActivity' && !attr(el, 'calledElement')) return [{ severity: 'error', message: 'Call activity needs calledElement', ...tag(el) }];
    if (n === 'scriptTask') {
      // scriptFormat is optional: the engine falls back to its default scripting language
      return elementChildren(el).some((c) => localName(c.name) === 'script') ? [] : [{ message: 'Script task has no <script> body', ...tag(el) }];
    }
    if (n === 'serviceTask' && flowableAttr('type')?.value === 'dmn') {
      const hasKey = elementChildren(el).some((c) => localName(c.name) === 'extensionElements' && elementChildren(c).some((f) => localName(f.name) === 'field' && attr(f, 'name')?.value === 'decisionTableReferenceKey'));
      return hasKey ? [] : [{ severity: 'error', message: 'DMN task needs a decisionTableReferenceKey field', ...tag(el) }];
    }
    return [];
  }),
});

registerValidator({
  name: 'flowable-attributes',
  description: 'Flowable-namespace attributes must be known to the active Flowable version and have valid values',
  checkDocument: (ctx) => {
    const flowableUri = ctx.schema.namespaces.flowable;
    const passThrough = new Set(ctx.config.passThroughNamespaces);
    const out = [];
    for (const el of ctx.elements) {
      if (!elementSchema(el.name)) continue;
      for (const a of el.attrs) {
        const { ns, name } = attributeKey(a);
        if (ns === 'bpmn' || ns === 'xmlns' || a.name === 'xmlns' || passThrough.has(ns) || ctx.prefixes[ns] !== flowableUri) continue;
        const spec = attributeSpec(el.name, 'flowable', name);
        if (!spec) {
          out.push({ severity: 'information', message: `flowable:${name} is not recognised on <${localName(el.name)}> by Flowable ${ctx.schema.version}; the engine ignores it`, ...attrRange(a) });
          continue;
        }
        if (a.value.includes('${') || a.value.includes('#{')) continue;
        if (spec.type === 'boolean' && !['true', 'false'].includes(a.value)) out.push({ severity: 'error', message: `flowable:${name} must be true or false`, ...attrRange(a) });
        if (spec.type === 'enum' && !spec.values.includes(a.value)) out.push({ severity: 'error', message: `flowable:${name} must be one of: ${spec.values.join(', ')}`, ...attrRange(a) });
      }
    }
    return out;
  },
});

registerValidator({
  name: 'juel-syntax',
  description: 'JUEL expressions (${...}) must be well-formed',
  severity: 'error',
  checkDocument: (ctx) => {
    const out = [];
    const check = (value, base, range) => {
      for (const p of checkJuelSyntax(value)) out.push({ message: p.message, ...(range ?? { start: base + p.offset, end: base + p.offset + 1 }) });
    };
    for (const el of ctx.elements) {
      for (const a of el.attrs) if (/[$#]\{/.test(a.value)) check(a.value, 0, attrRange(a));
      if (EXPRESSION_ELEMENTS.includes(localName(el.name))) {
        // the body may be split over text and CDATA nodes (e.g. whitespace around a CDATA): check them as one value
        const parts = el.children.filter((c) => c.type === 'text' || c.type === 'cdata');
        const value = parts.map((c) => c.value).join('');
        if (parts.length === 1) check(value, parts[0].type === 'cdata' ? parts[0].start + 9 : parts[0].start);
        else if (value.trim()) check(value, 0, tag(el));
      }
    }
    return out;
  },
});

registerValidator({
  name: 'flowable-child-elements',
  description: 'Flowable-namespace children of <extensionElements> must be known to the active Flowable version',
  checkDocument: (ctx) => {
    const flowableUri = ctx.schema.namespaces.flowable;
    const out = [];
    for (const el of ctx.elements) {
      const parent = el.parent;
      if (localName(el.name) !== 'extensionElements' || !parent?.name || !elementSchema(parent.name)) continue;
      for (const c of elementChildren(el)) {
        const prefix = c.name.includes(':') ? c.name.slice(0, c.name.indexOf(':')) : '';
        if (ctx.prefixes[prefix] !== flowableUri || ctx.config.passThroughNamespaces.includes(prefix)) continue;
        if (!childSpec(parent.name, localName(c.name))) {
          out.push({ severity: 'information', message: `<${c.name}> is not in the Flowable ${ctx.schema.version} schema for <${localName(parent.name)}> (the schema lists only part of the extension elements), so it is kept but not validated`, ...tag(c) });
        }
      }
    }
    return out;
  },
});

registerDmnValidators(registerValidator);
