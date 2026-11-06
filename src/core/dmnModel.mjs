// Edit operations on a Flowable DMN document, written against the plain W3C DOM so the same code runs in the
// webview (DOMParser) and in Node tests (jsdom). Nothing here knows about the UI.
//
// Only the decision table is modelled. Everything else (itemDefinitions, DMNDI, extensionElements, inputValues,
// outputValues, unknown attributes) stays in the DOM untouched and is written back as it was.
//
// serializeDmn() pretty-prints the DOM. Its output only has to be canonically equal to the file: the host applies just
// the element-level diff (core/differ.mjs), so untouched parts of the file keep their exact text.

const local = (el) => el.localName ?? el.nodeName.slice(el.nodeName.indexOf(':') + 1);
const kids = (el, name) => [...el.childNodes].filter((n) => n.nodeType === 1 && (!name || local(n) === name));
const kid = (el, name) => kids(el, name)[0] ?? null;

export function parseDmn(text, DOMParserImpl = globalThis.DOMParser) {
  const doc = new DOMParserImpl().parseFromString(text, 'application/xml');
  const err = doc.getElementsByTagName('parsererror')[0];
  if (err) throw new Error(err.textContent.split('\n').find((l) => l.trim()) ?? 'XML parse error');
  if (local(doc.documentElement) !== 'definitions') throw new Error('Not a DMN file: the root element is <' + doc.documentElement.nodeName + '>');
  return doc;
}

// ---- reading ------------------------------------------------------------------------------------------------

export const decisions = (doc) => kids(doc.documentElement, 'decision');
export const decisionTable = (decision) => kid(decision, 'decisionTable');
export const inputs = (table) => kids(table, 'input');
export const outputs = (table) => kids(table, 'output');
export const rules = (table) => kids(table, 'rule');
export const inputEntries = (rule) => kids(rule, 'inputEntry');
export const outputEntries = (rule) => kids(rule, 'outputEntry');

export const textOf = (el) => {
  const t = el && kid(el, 'text');
  return t ? t.textContent : '';
};
export const ruleDescription = (rule) => kid(rule, 'description')?.textContent ?? '';
export const inputExpressionOf = (input) => kid(input, 'inputExpression');

// ---- writing ------------------------------------------------------------------------------------------------

export function setAttr(el, name, value) {
  if (value === '' || value === undefined || value === null) el.removeAttribute(name);
  else el.setAttribute(name, value);
}

const create = (doc, parent, name) => doc.createElementNS(parent.namespaceURI, name);

// Sets the text of a <text> child (creating it). `cdata` writes <![CDATA[...]]>; an existing CDATA node stays CDATA.
function setText(doc, el, value, cdata) {
  let t = kid(el, 'text');
  if (!t) {
    t = create(doc, el, 'text');
    el.insertBefore(t, el.firstChild);
  }
  const existing = [...t.childNodes].find((n) => n.nodeType === 3 || n.nodeType === 4);
  const asCdata = cdata || existing?.nodeType === 4;
  t.replaceChildren();
  if (value === '') return;
  if (!asCdata) return t.append(doc.createTextNode(value));
  // a CDATA section cannot contain "]]>": split it over two sections
  const parts = value.split(']]>');
  parts.forEach((p, i) => t.append(doc.createCDATASection((i ? '>' : '') + p + (i < parts.length - 1 ? ']]' : ''))));
}

// Rule cells are expressions: written as CDATA, like the files Flowable exports.
// DMN 1.3 (10.3.2.9, grammar rule 14/15): "-" is the unary test that matches any value. An emptied input cell is
// therefore written as "-" (a wildcard); output cells may stay empty.
export function setEntryText(doc, entry, value) {
  if (value.trim() === '' && local(entry) === 'inputEntry') value = '-';
  setText(doc, entry, value, true);
}

export function setInputExpression(doc, input, value) {
  setText(doc, inputExpressionOf(input), value, false);
}

export function setRuleDescription(doc, rule, value) {
  let d = kid(rule, 'description');
  if (value === '') return d?.remove();
  if (!d) {
    d = create(doc, rule, 'description');
    rule.insertBefore(d, rule.firstChild);
  }
  d.textContent = value;
}

// An id that is not used anywhere in the document.
function uniqueId(doc, base) {
  const used = new Set([...doc.getElementsByTagName('*')].map((e) => e.getAttribute('id')).filter(Boolean));
  const clean = base.replace(/[^\w.-]/g, '_') || 'id';
  let id = clean;
  for (let n = 1; used.has(id); n++) id = `${clean}_${n}`;
  return id;
}

function newEntry(doc, rule, name, idBase) {
  const e = create(doc, rule, name);
  e.setAttribute('id', uniqueId(doc, idBase));
  e.append(create(doc, e, 'text'));
  return e;
}

// Inserts `node` so it becomes the `index`-th child named `name` of `parent`; with fewer siblings it goes after the last
// one, or, with none, before the first element named in `before` (else at the end).
function insertAmong(parent, node, name, index, before = []) {
  const siblings = kids(parent, name);
  if (index < siblings.length) return parent.insertBefore(node, siblings[index]);
  if (siblings.length) return parent.insertBefore(node, siblings[siblings.length - 1].nextSibling);
  const next = kids(parent).find((c) => before.includes(local(c)));
  return parent.insertBefore(node, next ?? null);
}

export function addInput(doc, table, { label = 'New input', expression = '', typeRef = 'string' } = {}, index = inputs(table).length) {
  const input = create(doc, table, 'input');
  input.setAttribute('label', label);
  const ie = create(doc, input, 'inputExpression');
  ie.setAttribute('id', uniqueId(doc, 'inputExpression_' + (label || 'input')));
  setAttr(ie, 'typeRef', typeRef);
  input.append(ie);
  setInputExpression(doc, input, expression);
  insertAmong(table, input, 'input', index, ['output', 'rule']);
  for (const rule of rules(table)) insertAmong(rule, newEntry(doc, rule, 'inputEntry', 'inputEntry_' + (label || 'input')), 'inputEntry', index, ['outputEntry']);
  return input;
}

export function removeInput(table, index) {
  inputs(table)[index]?.remove();
  for (const rule of rules(table)) inputEntries(rule)[index]?.remove();
}

export function addOutput(doc, table, { label = 'New output', name = '', typeRef = 'string' } = {}, index = outputs(table).length) {
  const out = create(doc, table, 'output');
  out.setAttribute('id', uniqueId(doc, 'outputExpression_' + (name || label || 'output')));
  setAttr(out, 'label', label);
  setAttr(out, 'name', name);
  setAttr(out, 'typeRef', typeRef);
  insertAmong(table, out, 'output', index, ['rule']);
  for (const rule of rules(table)) insertAmong(rule, newEntry(doc, rule, 'outputEntry', 'outputEntry_' + (name || label || 'output')), 'outputEntry', index);
  return out;
}

export function removeOutput(table, index) {
  outputs(table)[index]?.remove();
  for (const rule of rules(table)) outputEntries(rule)[index]?.remove();
}

export function addRule(doc, table, index = rules(table).length) {
  const rule = create(doc, table, 'rule');
  inputs(table).forEach((_, i) => rule.append(newEntry(doc, rule, 'inputEntry', 'inputEntry_' + (i + 1))));
  outputs(table).forEach((_, i) => rule.append(newEntry(doc, rule, 'outputEntry', 'outputEntry_' + (i + 1))));
  insertAmong(table, rule, 'rule', index);
  return rule;
}

export function removeRule(table, index) {
  rules(table)[index]?.remove();
}

export function moveRule(table, from, to) {
  const all = rules(table);
  if (to < 0 || to >= all.length || from === to) return;
  const rule = all[from];
  rule.remove();
  insertAmong(table, rule, 'rule', to);
}

// ---- serializing --------------------------------------------------------------------------------------------

const escText = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escAttr = (s) => escText(s).replace(/"/g, '&quot;').replace(/\n/g, '&#10;').replace(/\r/g, '&#13;').replace(/\t/g, '&#9;');
const cdata = (s) => '<![CDATA[' + s.replace(/]]>/g, ']]]]><![CDATA[>') + ']]>';

function write(node, depth, out) {
  const pad = '  '.repeat(depth);
  if (node.nodeType === 8) return out.push(`${pad}<!--${node.data}-->`);
  const open = `<${node.nodeName}${[...node.attributes].map((a) => ` ${a.name}="${escAttr(a.value)}"`).join('')}`;
  const children = [...node.childNodes].filter((n) => n.nodeType === 1 || n.nodeType === 8 || n.nodeType === 4 || (n.nodeType === 3 && n.data.trim() !== ''));
  if (!children.length) return out.push(`${pad}${open}></${node.nodeName}>`);
  if (children.every((n) => n.nodeType === 3 || n.nodeType === 4)) {
    const body = children.map((n) => (n.nodeType === 4 ? cdata(n.data) : escText(n.data))).join('');
    return out.push(`${pad}${open}>${body}</${node.nodeName}>`);
  }
  out.push(`${pad}${open}>`);
  for (const c of children) {
    if (c.nodeType === 4 || c.nodeType === 3) out.push(`${pad}  ${c.nodeType === 4 ? cdata(c.data) : escText(c.data.trim())}`);
    else write(c, depth + 1, out);
  }
  out.push(`${pad}</${node.nodeName}>`);
}

export function serializeDmn(doc) {
  const out = ['<?xml version="1.0" encoding="UTF-8"?>'];
  for (const n of doc.childNodes) if (n.nodeType === 8) out.push(`<!--${n.data}-->`);
  write(doc.documentElement, 0, out);
  return out.join('\n') + '\n';
}

// Moves input column `from` to position `to` (counted after it is taken out), with its cell in every rule.
export function moveInput(table, from, to) {
  moveColumn(table, 'input', 'inputEntry', inputs(table), inputEntries, from, to, ['output', 'rule'], ['outputEntry']);
}

export function moveOutput(table, from, to) {
  moveColumn(table, 'output', 'outputEntry', outputs(table), outputEntries, from, to, ['rule'], []);
}

function moveColumn(table, name, entryName, columns, entriesOf, from, to, before, entryBefore) {
  if (from === to || from < 0 || to < 0 || from >= columns.length || to >= columns.length) return;
  const column = columns[from];
  column.remove();
  insertAmong(table, column, name, to, before);
  for (const rule of rules(table)) {
    const entry = entriesOf(rule)[from];
    if (!entry) continue;
    entry.remove();
    insertAmong(rule, entry, entryName, to, entryBefore);
  }
}

// ---- allowed values (<inputValues> / <outputValues>) ---------------------------------------------------------

const valuesName = (column) => (local(column) === 'input' ? 'inputValues' : 'outputValues');

// The list as written, e.g. "A","B". Empty when the column has none.
export const allowedValues = (column) => textOf(kid(column, valuesName(column)));

// Sets the list; an empty value removes the element. The text is plain (no CDATA), as in the files Flowable exports.
export function setAllowedValues(doc, column, value) {
  const name = valuesName(column);
  let values = kid(column, name);
  if (value.trim() === '') return values?.remove();
  if (!values) {
    values = create(doc, column, name);
    column.append(values);
  }
  setText(doc, values, value, false);
}
