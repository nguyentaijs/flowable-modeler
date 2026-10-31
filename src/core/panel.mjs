// Properties-panel provider registry. Providers only DESCRIBE fields; the webview renders them and reads and
// writes values through an adapter, so everything here is plain data and runs in Node tests.
//
//   registerProvider({
//     id: 'my-provider',
//     order: 50,                                  // lower renders first
//     appliesTo: ['serviceTask'] | (type) => bool, // local element names, or a predicate on the local name
//     groups: ({ type, schema }) => [{ id, title, fields: [field...] }],
//   })
//
// A field is {key, label, kind, target?, values?, hint?, readOnly?}
//   requiresProperty  hide the field when the BPMN element type has no such property
//   validate          named check run before committing (see propertiesPanel.js); only 'id' so far
//   kind    text | expression | namedFields | textarea | boolean | enum | toggle | list | multiInstance | summary
//   key     "name" (BPMN attribute), "flowable:async" (Flowable attribute) or a virtual key used with `target`
//   item    for kind 'list': the row layout (see listItems.mjs)
//   target  attr (default) | script (scriptTask body) | condition (sequenceFlow conditionExpression) | default-flow (is this flow its source's default) | children:<name>
// Groups with the same id from different providers are merged.
import { elementSchema } from './schema.mjs';

const providers = [];

// Moddle types are PascalCase ("bpmn:ScriptTask"); XML element names, and so the schema, are camelCase ("scriptTask").
// ---- Field validation (named by a field's `validate`) -------------------------------------------------------
const NCNAME = /^[A-Za-z_][\w.-]*$/;
const fieldValidators = {
  id: (value, ctx) => {
    if (!NCNAME.test(value)) return 'Id must start with a letter or underscore and contain only letters, digits, _ . -';
    return ctx.isIdTaken?.(value) ? `Id "${value}" is already used` : '';
  },
};

// Returns an error message, or '' when the value is fine.
export const validateField = (name, value, ctx = {}) => fieldValidators[name]?.(value, ctx) ?? '';
export const registerFieldValidator = (name, fn) => {
  fieldValidators[name] = fn;
  return () => delete fieldValidators[name];
};

export const elementTypeName = (moddleType) => {
  const local = moddleType.slice(moddleType.indexOf(':') + 1);
  return local[0].toLowerCase() + local.slice(1);
};

export function registerProvider(p) {
  if (!p.id || typeof p.groups !== 'function') throw new Error('A provider needs an id and a groups(ctx) function');
  if (providers.some((x) => x.id === p.id)) throw new Error(`Provider "${p.id}" is already registered`);
  providers.push({ order: 100, ...p });
  providers.sort((a, b) => a.order - b.order);
  return () => {
    const i = providers.findIndex((x) => x.id === p.id);
    if (i >= 0) providers.splice(i, 1);
  };
}

export const listProviders = () => providers.map(({ id, order }) => ({ id, order }));

const applies = (p, type) => !p.appliesTo || (Array.isArray(p.appliesTo) ? p.appliesTo.includes(type) : p.appliesTo(type));

// Groups to show for an element with the given local type name (e.g. "serviceTask").
export function getGroups(type) {
  const ctx = { type, schema: elementSchema(type) };
  const merged = new Map();
  for (const p of providers) {
    if (!applies(p, type)) continue;
    for (const g of p.groups(ctx) ?? []) {
      const cur = merged.get(g.id);
      if (cur) cur.fields.push(...g.fields);
      else merged.set(g.id, { ...g, fields: [...g.fields], provider: p.id });
    }
  }
  return [...merged.values()].filter((g) => g.fields.length);
}

// ---- Default providers ----------------------------------------------------------------------------------

// Row layouts for editable lists (see listItems.mjs).
const FIELD_ITEM = {
  type: 'flowable:field',
  columns: [
    { key: 'name', label: 'Key', as: 'attr' },
    { key: 'value', label: 'Value', as: 'child', childTypes: ['string', 'expression'] },
  ],
};
const PARAMETER_ITEM = (type) => ({
  type,
  columns: [
    // The engine uses sourceExpression when both are present, so a row holds exactly one of them.
    { key: 'src', label: 'Source', as: 'attrChoice', choices: [{ key: 'source', label: 'variable' }, { key: 'sourceExpression', label: 'expression', expression: true, wins: true }] },
    { key: 'target', label: 'Target', as: 'attr' },
  ],
});

registerProvider({
  id: 'general',
  order: 10,
  // every element: id and name (name only where the BPMN model defines it, e.g. not on associations)
  groups: () => [{ id: 'general', title: 'General', fields: [
    { key: 'id', label: 'Id', kind: 'text', validate: 'id' },
    { key: 'name', label: 'Name', kind: 'text', requiresProperty: 'name' },
  ] }],
});

registerProvider({
  id: 'script-task',
  order: 20,
  appliesTo: ['scriptTask'],
  groups: () => [{ id: 'script', title: 'Script', fields: [
    { key: 'scriptFormat', label: 'Script format', kind: 'text', hint: 'e.g. groovy, javascript', suggestions: ['groovy', 'javascript'] },
    { key: 'script', label: 'Script', kind: 'textarea', target: 'script' },
  ] }],
});

registerProvider({
  id: 'call-activity',
  order: 20,
  appliesTo: ['callActivity'],
  groups: () => [{ id: 'called', title: 'Called process', fields: [
    { key: 'calledElement', label: 'Called element', kind: 'expression', hint: 'process key or ${expression}' },
    { key: 'in', label: 'In parameters', kind: 'list', target: 'children:in', item: PARAMETER_ITEM('flowable:in') },
    { key: 'out', label: 'Out parameters', kind: 'list', target: 'children:out', item: PARAMETER_ITEM('flowable:out') },
  ] }],
});

registerProvider({
  id: 'sub-process',
  order: 20,
  appliesTo: ['subProcess', 'adHocSubProcess', 'transaction'],
  groups: ({ type }) => [{ id: 'subprocess', title: 'Sub process', fields: [
    { key: 'triggeredByEvent', label: 'Triggered by event', kind: 'toggle', hint: 'Event sub process: starts from its own start event (message, signal, timer, error, ...) instead of being entered by a flow.' },
    ...(type === 'adHocSubProcess' ? [
      { key: 'ordering', label: 'Ordering', kind: 'enum', values: ['Parallel', 'Sequential'] },
      { key: 'cancelRemainingInstances', label: 'Cancel remaining instances', kind: 'boolean' },
    ] : []),
    { key: 'isForCompensation', label: 'Is for compensation', kind: 'toggle' },
  ] }],
});

// Loops: every activity (tasks, call activities, sub processes) can run as multiple instances.
registerProvider({
  id: 'multi-instance',
  order: 25,
  appliesTo: (t) => /(Task|Activity|[sS]ubProcess)$|^transaction$/.test(t),
  groups: () => [{ id: 'multiinstance', title: 'Multi-instance', fields: [{
    key: 'multiInstance',
    label: 'Loop',
    kind: 'multiInstance',
    modes: [{ key: 'none', label: 'None' }, { key: 'parallel', label: 'Parallel' }, { key: 'sequential', label: 'Sequential' }],
    fields: [
      { key: 'collection', label: 'Collection', kind: 'expression', hint: '${items}  (flowable:collection)' },
      { key: 'elementVariable', label: 'Element variable', kind: 'text', hint: 'name of the variable holding the current item' },
      { key: 'elementIndexVariable', label: 'Element index variable', kind: 'text', hint: 'name of the variable holding the loop index' },
      { key: 'loopCardinality', label: 'Loop cardinality', kind: 'expression', hint: '${n}  (instances when there is no collection)' },
      { key: 'completionCondition', label: 'Completion condition', kind: 'expression', hint: '${nrOfCompletedInstances >= 2}' },
    ],
  }] }],
});

registerProvider({
  id: 'service-task',
  order: 20,
  appliesTo: ['serviceTask'],
  groups: () => [{ id: 'fields', title: 'Fields', fields: [{ key: 'field', label: 'Field extensions', kind: 'list', target: 'children:field', item: FIELD_ITEM, notDmn: true }] }],
});

// DMN task: the engine reads fixed field names (DmnActivityBehavior / ServiceTaskXMLConverter), so they are shown as
// named values rather than free key/value rows. Fields not listed here are left untouched in the file.
registerProvider({
  id: 'dmn-task',
  order: 19,
  appliesTo: ['serviceTask'],
  groups: () => [{ id: 'dmn', title: 'Decision', fields: [{
    key: 'dmnFields',
    label: 'Decision',
    kind: 'namedFields',
    dmnOnly: true,
    item: FIELD_ITEM,
    names: [
      { name: 'decisionTableReferenceKey', label: 'Decision table key', kind: 'expression' },
      { name: 'decisionTaskThrowErrorOnNoHits', label: 'Throw error on no hits', kind: 'boolean' },
      { name: 'fallbackToDefaultTenant', label: 'Fallback to default tenant', kind: 'boolean' },
      { name: 'sameDeployment', label: 'Same deployment', kind: 'boolean' },
    ],
  }] }],
});

registerProvider({
  id: 'sequence-flow',
  order: 20,
  appliesTo: ['sequenceFlow'],
  groups: () => [{ id: 'condition', title: 'Condition', fields: [
    { key: 'defaultFlow', label: 'Default flow', kind: 'toggle', target: 'default-flow', hint: 'Taken when no other outgoing flow of the source matches. Stored as default="..." on the source element.' },
    { key: 'condition', label: 'Condition expression', kind: 'expression', target: 'condition', hint: '${...}' },
  ] }],
});

// Every Flowable-namespace attribute of the element, straight from the schema. Execution flags go in their own group.
const EXECUTION = new Set(['async', 'exclusive', 'asyncLeave', 'triggerable']);
registerProvider({
  id: 'flowable-attributes',
  order: 90,
  groups: ({ schema }) => {
    if (!schema) return [];
    const field = (a) => ({
      key: `flowable:${a.name}`,
      label: a.name,
      kind: a.type === 'boolean' ? 'boolean' : a.type === 'enum' ? 'enum' : a.type === 'expression' ? 'expression' : 'text',
      ...(a.values ? { values: a.values } : {}),
    });
    const attrs = schema.attributes.filter((a) => a.ns === 'flowable');
    return [
      { id: 'execution', title: 'Execution', fields: attrs.filter((a) => EXECUTION.has(a.name)).map(field) },
      { id: 'flowable', title: 'Flowable', fields: attrs.filter((a) => !EXECUTION.has(a.name)).map(field) },
    ];
  },
});
