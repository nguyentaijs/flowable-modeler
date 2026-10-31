// Generates schema/flowable-<version>.json from the Flowable engine sources at a release tag.
//
//   node scripts/extract-flowable-schema.mjs [--tag flowable-7.2.0] [--out schema/flowable-7.2.0.json] [--cache <dir>]
//
// Attribute lists, namespaces and the element names come straight from the BPMN converter sources
// (the `default*Attributes` lists plus the write*/read calls that decide the XML namespace), and attribute
// types/enums come from flowable-bpmn-extensions.xsd. Child elements are NOT derivable from the sources
// without interpreting `instanceof` checks, so they are curated in CHILDREN below, each with the source
// class that accepts them.
import fs from 'node:fs';
import path from 'node:path';

const arg = (name, dflt) => {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 ? process.argv[i + 1] : dflt;
};
const TAG = arg('tag', 'flowable-7.2.0');
const OUT = arg('out', `schema/${TAG}.json`);
const CACHE = arg('cache', null);
const RAW = `https://raw.githubusercontent.com/flowable/flowable-engine/${TAG}/modules/flowable-bpmn-converter/src/main`;
const CONV = `${RAW}/java/org/flowable/bpmn/converter`;

async function get(url) {
  const file = CACHE && path.join(CACHE, url.split('/').slice(-2).join('_'));
  if (file && fs.existsSync(file)) return fs.readFileSync(file, 'utf8');
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  const text = await res.text();
  if (file) {
    fs.mkdirSync(CACHE, { recursive: true });
    fs.writeFileSync(file, text);
  }
  return text;
}

// Elements covered: BPMN element name -> converter class. Extend this table to cover more of the palette.
const CONVERTERS = {
  startEvent: 'StartEventXMLConverter',
  endEvent: 'EndEventXMLConverter',
  sequenceFlow: 'SequenceFlowXMLConverter',
  exclusiveGateway: 'ExclusiveGatewayXMLConverter',
  inclusiveGateway: 'InclusiveGatewayXMLConverter',
  parallelGateway: 'ParallelGatewayXMLConverter',
  scriptTask: 'ScriptTaskXMLConverter',
  serviceTask: 'ServiceTaskXMLConverter',
  callActivity: 'CallActivityXMLConverter',
  userTask: 'UserTaskXMLConverter',
  // sub processes are read by a parser, not a converter; attributes are scanned from its getAttributeValue calls
  subProcess: 'parser/SubProcessParser',
  // multi-instance is a child element of every activity
  multiInstanceLoopCharacteristics: 'child/MultiInstanceParser',
};

// Element variants that read the parser's attributes of another element, plus their own.
const DERIVED = {
  transaction: { from: 'subProcess', only: [] },
  adHocSubProcess: { from: 'subProcess', only: ['ATTRIBUTE_ORDERING', 'ATTRIBUTE_CANCEL_REMAINING_INSTANCES'] },
};
const PARSER_ONLY_FOR = { ATTRIBUTE_ORDERING: 'adHocSubProcess', ATTRIBUTE_CANCEL_REMAINING_INSTANCES: 'adHocSubProcess' };

// Child elements in the flowable namespace, with the converter/parser that accepts them.
const CHILDREN = {
  serviceTask: [{ name: 'field', source: 'FieldExtensionParser.accepts (ServiceTask)' }],
  callActivity: [
    { name: 'in', source: 'InParameterParser (CallActivity)' },
    { name: 'out', source: 'OutParameterParser (CallActivity)' },
  ],
  startEvent: [{ name: 'in', source: 'StartEventXMLConverter.childParserMap (InParameterParser)' }],
  endEvent: [{ name: 'out', source: 'EndEventXMLConverter.childParserMap (OutParameterParser)' }],
  scriptTask: [{ name: 'in', source: 'ScriptTaskXMLConverter.childParserMap (InParameterParser)' }],
  userTask: [{ name: 'taskListener', source: 'TaskListenerParser (UserTask)' }],
};
// Accepted by every flow element (BaseBpmnXMLConverter / generic parsers).
const COMMON_CHILDREN = [
  { name: 'executionListener', source: 'ExecutionListenerParser (HasExecutionListeners)' },
];

const consts = Object.fromEntries([...(await get(`${RAW}/java/org/flowable/bpmn/constants/BpmnXMLConstants.java`)).matchAll(/String (\w+)\s*=\s*"([^"]*)"/g)].map((m) => [m[1], m[2]]));
const base = await get(`${CONV}/BaseBpmnXMLConverter.java`);
const xsd = await get(`${RAW}/resources/org/flowable/impl/bpmn/parser/flowable-bpmn-extensions.xsd`);

const lists = (src) => Object.fromEntries([...src.matchAll(/List<ExtensionAttribute>\s+(\w+)\s*=\s*Arrays\.asList\(([\s\S]*?)\);/g)].map((m) => [m[1], [...m[2].matchAll(/ExtensionAttribute\((?:BpmnXMLConstants\.)?(\w+)\)/g)].map((x) => x[1])]));

// Namespace of an attribute constant: written/read with the flowable helpers, or as a plain BPMN attribute.
function namespaceOf(constName, ...sources) {
  const src = sources.join('\n');
  const esc = constName;
  if (new RegExp(`writeQualifiedAttribute\\((?:BpmnXMLConstants\\.)?${esc}\\b`).test(src)) return 'flowable';
  if (new RegExp(`(writeDefaultAttribute|writeAttribute)\\((?:BpmnXMLConstants\\.)?${esc}\\b`).test(src)) return 'bpmn';
  if (new RegExp(`BpmnXMLUtil\\.getAttributeValue\\((?:BpmnXMLConstants\\.)?${esc}\\b`).test(src)) return 'flowable';
  if (new RegExp(`getAttributeValue\\(FLOWABLE_EXTENSIONS_NAMESPACE,\\s*(?:BpmnXMLConstants\\.)?${esc}\\b`).test(src)) return 'flowable';
  if (new RegExp(`getAttributeValue\\(null,\\s*(?:BpmnXMLConstants\\.)?${esc}\\b`).test(src)) return 'bpmn';
  // asyncBefore is only read from the Camunda namespace in 7.2.0, so it is not a Flowable attribute.
  if (constName === 'ATTRIBUTE_ACTIVITY_ASYNCHRONOUS_BEFORE') return 'camunda';
  return null;
}

// Attribute types / enums from the extensions XSD.
const xsdAttrs = {};
for (const m of xsd.matchAll(/<attribute name="(\w+)"([^>]*?)(\/>|>([\s\S]*?)<\/attribute>)/g)) {
  const type = /type="(?:tns:)?(\w+)"/.exec(m[2])?.[1];
  const enums = [...(m[4] || '').matchAll(/<enumeration value="([^"]*)"/g)].map((x) => x[1]);
  xsdAttrs[m[1]] = { type: enums.length ? 'enum' : type === 'boolean' ? 'boolean' : type === 'tExpression' ? 'expression' : 'string', ...(enums.length ? { values: enums } : {}), ...(/default="([^"]*)"/.exec(m[2]) ? { default: /default="([^"]*)"/.exec(m[2])[1] } : {}) };
}

const baseLists = lists(base);
const elements = {};
const unresolved = [];

for (const [element, cls] of Object.entries(CONVERTERS)) {
  const src = await get(`${CONV}/${cls}.java`);
  const own = lists(src);
  const used = [...src.matchAll(/addCustomAttributes\(xtr,\s*\w+,\s*([^;]*?)\);/g)].flatMap((m) => m[1].split(',').map((s) => s.trim()));
  const names = new Set();
  if (cls.startsWith('parser/') || cls.startsWith('child/')) {
    for (const m of src.matchAll(/getAttributeValue\((?:null,\s*|FLOWABLE_EXTENSIONS_NAMESPACE,\s*)?(?:BpmnXMLConstants\.)?(ATTRIBUTE_\w+)/g)) if (!PARSER_ONLY_FOR[m[1]] && !['ATTRIBUTE_ID', 'ATTRIBUTE_NAME'].includes(m[1])) names.add(m[1]);
  }
  for (const l of used) for (const n of own[l] || baseLists[l] || []) names.add(n);
  for (const n of Object.keys(own)) if (!used.length) own[n].forEach((x) => names.add(x));
  if (element === 'sequenceFlow') ['ATTRIBUTE_FLOW_SOURCE_REF', 'ATTRIBUTE_FLOW_TARGET_REF', 'ATTRIBUTE_FLOW_SKIP_EXPRESSION'].forEach((n) => names.add(n));
  const attributes = [];
  for (const constName of names) {
    const name = consts[constName];
    if (!name) {
      unresolved.push(`${element}: constant ${constName}`);
      continue;
    }
    const ns = namespaceOf(constName, src, base) ?? (unresolved.push(`${element}.${name}: namespace`), 'flowable');
    if (ns === 'camunda') continue;
    const entry = { name, ns };
    if (ns === 'flowable' && xsdAttrs[name]) Object.assign(entry, xsdAttrs[name]);
    else if (/boolean|async|exclusive|inherit|isForCompensation|isInterrupting|autoStore|useLocal|storeResult|fallback|sameDeployment|triggerable|completeAsync|doNotInclude|triggeredByEvent|cancelRemaining|isSequential|noWaitStates/i.test(name)) entry.type = 'boolean';
    attributes.push(entry);
  }
  attributes.sort((a, b) => a.name.localeCompare(b.name) || a.ns.localeCompare(b.ns));
  elements[element] = {
    converter: cls,
    attributes,
    children: [...(CHILDREN[element] || []), ...(element === 'sequenceFlow' || /Gateway$/.test(element) || /Task$|Activity$|Event$|[sS]ubProcess$|^transaction$/.test(element) ? COMMON_CHILDREN : [])],
  };
}

for (const [name, d] of Object.entries(DERIVED)) {
  const base = elements[d.from];
  const own = [];
  for (const constName of d.only) {
    const attrName = consts[constName];
    own.push({ name: attrName, ns: 'bpmn', ...(constName === 'ATTRIBUTE_CANCEL_REMAINING_INSTANCES' ? { type: 'boolean' } : {}) });
  }
  elements[name] = { converter: base.converter + ' (variant)', attributes: [...base.attributes, ...own].sort((a, b) => a.name.localeCompare(b.name) || a.ns.localeCompare(b.ns)), children: base.children };
}

const schema = {
  engine: 'flowable-community',
  version: TAG.replace(/^flowable-/, ''),
  source: `https://github.com/flowable/flowable-engine/tree/${TAG}/modules/flowable-bpmn-converter`,
  generatedBy: 'scripts/extract-flowable-schema.mjs',
  namespaces: { flowable: consts.FLOWABLE_EXTENSIONS_NAMESPACE, bpmn: 'http://www.omg.org/spec/BPMN/20100524/MODEL' },
  note: 'Attributes not listed for an element are treated as custom attributes by the engine (kept in the model, ignored at runtime).',
  attributeTypes: xsdAttrs,
  elements,
};

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(schema, null, 2) + '\n');
console.log(`wrote ${OUT}: ${Object.keys(elements).length} elements`);
if (unresolved.length) console.log('UNRESOLVED:\n  ' + unresolved.join('\n  '));
