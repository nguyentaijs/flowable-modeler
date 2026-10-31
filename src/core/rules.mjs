// Reusable normalization rules shared by the comparison (canon) and the differ.
//
// A modeler serializer is not byte-faithful: it adds empty helper elements, drops attributes that equal a
// spec default, and prints numbers differently. Each rule below tells the differ "this difference is not a
// user change", so such differences are never compared, never written, and never removed.
//
// Rule kinds (a rule is {name, test, ...}; `el` and `attr` are parsed nodes from xml.mjs):
//   ignoredElement   test(el)            element carries no information: invisible to comparison, never written
//   ignoredAttribute test(el, attr)      attribute carries no information: not compared, added or removed
//   cdataElement     test(el)            leaf element whose text is written as <![CDATA[...]]> when it is created or
//                                        changed (existing CDATA is always kept); does not affect comparison
//   orderedChildren  test(el)            the order of the element's children is meaningful even when they have ids (e.g. DMN
//                                        columns and cells); a reorder rewrites the element instead of being ignored
//   attributeValue   test(el, attr)      attribute value has equivalent spellings; normalize(value, el, attr)
//                                        returns the canonical one
//
// Add project-specific rules with registerRule(); it returns a function that removes the rule again.

const registry = { ignoredElement: [], ignoredAttribute: [], attributeValue: [], cdataElement: [], orderedChildren: [] };

export function registerRule(kind, rule) {
  const list = registry[kind];
  if (!list) throw new Error(`Unknown rule kind "${kind}" (expected one of ${Object.keys(registry).join(', ')})`);
  if (typeof rule.test !== 'function') throw new Error(`Rule "${rule.name}" needs a test function`);
  if (kind === 'attributeValue' && typeof rule.normalize !== 'function') throw new Error(`Rule "${rule.name}" needs a normalize function`);
  list.push(rule);
  return () => {
    const i = list.indexOf(rule);
    if (i >= 0) list.splice(i, 1);
  };
}

export const listRules = () => Object.fromEntries(Object.entries(registry).map(([k, v]) => [k, v.map((r) => r.name)]));

export const isIgnoredElement = (el) => el.type === 'el' && registry.ignoredElement.some((r) => r.test(el));
export const shouldWriteCdata = (el) => registry.cdataElement.some((r) => r.test(el));
export const hasOrderedChildren = (el) => registry.orderedChildren.some((r) => r.test(el));
export const isIgnoredAttribute = (el, attr) => registry.ignoredAttribute.some((r) => r.test(el, attr));
export const normalizeValue = (el, attr) => registry.attributeValue.reduce((v, r) => (r.test(el, attr) ? r.normalize(v, el, attr) : v), attr.value);

// ---- Default rules -------------------------------------------------------------------------------------

const localName = (name) => name.slice(name.indexOf(':') + 1);
const hasNoContent = (el) => el.attrs.length === 0 && !el.children.some((c) => c.type === 'el' || (c.type === 'text' && c.value.trim()));

// bpmn-js adds an empty <bpmndi:BPMNLabel/> when a label is touched (e.g. on rename).
registerRule('ignoredElement', {
  name: 'empty-bpmn-label',
  test: (el) => localName(el.name) === 'BPMNLabel' && hasNoContent(el),
});

// The serializer omits attributes that equal the spec default.
const SPEC_DEFAULTS = {
  typeLanguage: 'http://www.w3.org/2001/XMLSchema',
  expressionLanguage: 'http://www.w3.org/1999/XPath',
};
registerRule('ignoredAttribute', {
  name: 'bpmn-spec-default-attributes',
  test: (el, attr) => localName(el.name) === 'definitions' && SPEC_DEFAULTS[attr.name] === attr.value,
});

// The serializer prints doubles as numbers: "80.0" -> "80".
registerRule('attributeValue', {
  name: 'di-numbers',
  test: (el, attr) => ['x', 'y', 'width', 'height'].includes(attr.name) && /^-?\d+(\.\d+)?$/.test(attr.value),
  normalize: (v) => String(Number(v)),
});

// <incoming>/<outgoing> only repeat what sequenceFlow sourceRef/targetRef already say, and Flowable derives
// them itself (its converter never reads them). bpmn-js writes them whenever a flow is connected.
registerRule('ignoredElement', {
  name: 'derived-incoming-outgoing',
  test: (el) => ['incoming', 'outgoing'].includes(localName(el.name)) && el.attrs.length === 0 && !el.children.some((c) => c.type === 'el'),
});

// Elements whose text is a script or an expression (JUEL for all but script). Shared with the validators.
export const EXPRESSION_ELEMENTS = ['conditionExpression', 'loopCardinality', 'completionCondition', 'timeDuration', 'timeDate', 'timeCycle'];

// Scripts and expressions are written as CDATA, like the existing files do, so < > & and quotes stay readable.
registerRule('cdataElement', {
  name: 'script-and-expression-bodies',
  test: (el) => ['script', ...EXPRESSION_ELEMENTS].includes(localName(el.name)),
});
registerRule('cdataElement', {
  name: 'flowable-field-values',
  test: (el) => ['string', 'expression'].includes(localName(el.name)) && el.parent && localName(el.parent.name) === 'field',
});

// DMN rule cells are expressions, written as CDATA like the files Flowable exports.
registerRule('cdataElement', {
  name: 'dmn-entry-text',
  test: (el) => localName(el.name) === 'text' && el.parent && ['inputEntry', 'outputEntry'].includes(localName(el.parent.name)),
});

// DMN: the order of columns and of the cells in a rule decides which cell belongs to which column.
registerRule('orderedChildren', {
  name: 'dmn-ordered-tables',
  test: (el) => ['decisionTable', 'rule'].includes(localName(el.name)),
});
