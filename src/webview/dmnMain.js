import * as dmn from '../core/dmnModel.mjs';
import { suggest, suggestOutput, COLUMN_TYPES as TYPES } from '../core/dmnSuggestions.mjs';
import schema from '../../schema/flowable-dmn-7.2.0.json';
import { mountProblems } from './problems.js';

const vscode = acquireVsCodeApi();
mountProblems(vscode);
const app = document.getElementById('app');
const errorBox = document.getElementById('error');
const TABLE = schema.decisionTable;

let doc = null;
let timer;
let usedBy = { ready: false, byDecision: {} }; // from the host: which DMN tasks use each decision

const el = (tag, props = {}, ...kids) => {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...kids);
  return e;
};

const showError = (msg) => {
  errorBox.textContent = msg || '';
  errorBox.hidden = !msg;
};

// Every change is serialized once after a short pause; the host turns it into a minimal text diff. A change still waiting
// when the editor is closed or hidden is sent at once, so the last edit is never lost.
let pending = false;
function sendChanges() {
  clearTimeout(timer);
  pending = false;
  vscode.postMessage({ type: 'changed', xml: dmn.serializeDmn(doc) });
}
function changed() {
  clearTimeout(timer);
  pending = true;
  timer = setTimeout(sendChanges, 150);
}
const flushChanges = () => {
  if (pending) sendChanges();
};
window.addEventListener('pagehide', flushChanges);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') flushChanges();
});

// Edit that keeps the DOM focus (cell text): no rebuild, so Tab moves on to the next cell.
const edit = (fn) => {
  fn();
  changed();
};
// Edit that changes the table structure: rebuild the grid.
const restructure = (fn) => {
  fn();
  changed();
  render();
};

function textInput(value, onChange, props = {}) {
  const input = el('input', { type: 'text', value, spellcheck: false, ...props });
  input.addEventListener('change', () => onChange(input.value));
  return input;
}

function select(value, values, onChange, blank) {
  const s = el('select');
  if (blank) s.append(el('option', { value: '', textContent: blank }));
  for (const v of values) s.append(el('option', { value: v, textContent: v }));
  if (value && !values.includes(value)) s.append(el('option', { value, textContent: value })); // keep an unknown value as is
  s.value = value ?? '';
  s.addEventListener('change', () => onChange(s.value));
  return s;
}

const button = (text, title, onClick, className = '') => {
  const b = el('button', { type: 'button', textContent: text, title, className });
  b.addEventListener('click', onClick);
  return b;
};

// Drag and drop reordering. `drag` says what is being moved; a drop target accepts only its own kind (a column cannot
// change sides). The drop calls `move(from, to)` and rebuilds the grid.
let drag = null;
function draggable(handle, kind, index) {
  handle.draggable = true;
  handle.addEventListener('dragstart', (e) => {
    drag = { kind, index };
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', kind + ':' + index);
  });
  handle.addEventListener('dragend', () => {
    drag = null;
    document.querySelectorAll('.drop-before, .drop-after').forEach((n) => n.classList.remove('drop-before', 'drop-after'));
  });
}
function dropTarget(node, kind, index, move) {
  const side = (e) => {
    const r = node.getBoundingClientRect();
    return kind === 'rule' ? (e.clientY < r.top + r.height / 2 ? 'before' : 'after') : e.clientX < r.left + r.width / 2 ? 'before' : 'after';
  };
  node.addEventListener('dragover', (e) => {
    if (!drag || drag.kind !== kind) return;
    e.preventDefault();
    node.classList.remove('drop-before', 'drop-after');
    node.classList.add('drop-' + side(e));
  });
  node.addEventListener('dragleave', () => node.classList.remove('drop-before', 'drop-after'));
  node.addEventListener('drop', (e) => {
    if (!drag || drag.kind !== kind) return;
    e.preventDefault();
    const from = drag.index;
    let to = index + (side(e) === 'after' ? 1 : 0);
    if (from < to) to--; // the moved item is taken out first
    drag = null;
    if (to !== from) restructure(() => move(from, to));
  });
}

// "Used by" under a decision: the DMN tasks of the workspace's BPMN files that refer to it. Filled separately from the grid, so
// an update from the host never rebuilds (and never disturbs) the table being edited.
function fillUsedBy(node) {
  const id = node.dataset.decision;
  const list = usedBy.byDecision[id] ?? [];
  node.replaceChildren(el('span', { className: 'used-by-title', textContent: usedBy.ready ? `Used by (${list.length})` : 'Used by (scanning the workspace...)', title: usedBy.scope ? `BPMN files ${usedBy.scope} (setting flowableModeler.decisionScope)` : '' }));
  if (usedBy.ready && !list.length) node.append(el('span', { className: 'empty', textContent: ` not referenced by any DMN task ${usedBy.scope ?? 'in this workspace'}` }));
  for (const u of list) {
    const link = el('a', { href: '#', textContent: `${u.file}  ›  ${u.task}`, title: 'Open this process' });
    link.addEventListener('click', (e) => {
      e.preventDefault();
      vscode.postMessage({ type: 'openUsage', uri: u.uri });
    });
    node.append(el('div', { className: 'used-by-item' }, link));
  }
}

function renderDecision(decision) {
  const table = dmn.decisionTable(decision);
  const box = el('section', { className: 'decision' });
  const usedByNode = el('div', { className: 'used-by' });
  usedByNode.dataset.decision = decision.getAttribute('id') ?? '';
  fillUsedBy(usedByNode);
  // decision id, name, hit policy and aggregation share one line
  const head = el('div', { className: 'decision-head' },
    el('label', { textContent: 'Decision id' }), textInput(decision.getAttribute('id') ?? '', (v) => edit(() => dmn.setAttr(decision, 'id', v))),
    el('label', { textContent: 'Name' }), textInput(decision.getAttribute('name') ?? '', (v) => edit(() => dmn.setAttr(decision, 'name', v))));
  box.append(head);
  if (!table) {
    box.append(el('p', { className: 'empty', textContent: 'This decision has no decision table.' }));
    return box;
  }

  const hit = TABLE.attributes.hitPolicy;
  const agg = TABLE.attributes.aggregation;
  head.append(el('label', { textContent: 'Hit policy' }),
    select(table.getAttribute('hitPolicy') ?? '', hit.values, (v) => restructure(() => {
      dmn.setAttr(table, 'hitPolicy', v);
      if (v !== agg.onlyWhen.hitPolicy) dmn.setAttr(table, 'aggregation', ''); // aggregation only exists for COLLECT
    }), '(default)'));
  if (table.getAttribute('hitPolicy') === agg.onlyWhen.hitPolicy) {
    head.append(el('label', { textContent: 'Aggregation' }), select(table.getAttribute('aggregation') ?? '', agg.values, (v) => edit(() => dmn.setAttr(table, 'aggregation', v)), '(none)'));
  }

  const ins = dmn.inputs(table);
  const outs = dmn.outputs(table);
  const grid = el('table', { className: 'dmn-grid' });

  // header: group row, label row, then type + expression / result variable
  const group = el('tr', {},
    el('th', { rowSpan: 4, textContent: '#' }),
    el('th', { colSpan: Math.max(ins.length, 1), className: 'when', textContent: 'When' }),
    el('th', { colSpan: Math.max(outs.length, 1), className: 'then', textContent: 'Then' }),
    el('th', { rowSpan: 4, textContent: 'Description' }));
  const labels = el('tr');
  const exprs = el('tr');
  const values = el('tr', { className: 'values' });
  // allowed values of a column (<inputValues> / <outputValues>), written as the engine reads them: "A","B" or 1,2
  const valuesCell = (column) => el('th', {}, textInput(dmn.allowedValues(column), (v) => edit(() => dmn.setAllowedValues(doc, column, v)), { placeholder: 'allowed values  "A","B"', className: 'mono values-input', title: 'Allowed values (optional), comma separated' }));
  const removeColumn = (onRemove) => button('×', 'Remove column', onRemove, 'remove');
  ins.forEach((input, i) => {
    const ie = dmn.inputExpressionOf(input);
    const th = el('th', {});
    const grip = el('span', { className: 'grip', title: 'Drag to move this column', textContent: '⋮⋮' });
    draggable(grip, 'input', i);
    dropTarget(th, 'input', i, (from, to) => dmn.moveInput(table, from, to));
    th.append(el('div', { className: 'col-head' }, grip, textInput(input.getAttribute('label') ?? '', (v) => edit(() => dmn.setAttr(input, 'label', v)), { placeholder: 'label' }), removeColumn(() => restructure(() => dmn.removeInput(table, i)))));
    labels.append(th);
    values.append(valuesCell(input));
    exprs.append(el('th', {}, el('div', { className: 'col-expr' }, select(ie.getAttribute('typeRef') ?? '', TYPES, (v) => restructure(() => dmn.setAttr(ie, 'typeRef', v)), '(type)'), textInput(dmn.textOf(ie), (v) => edit(() => dmn.setInputExpression(doc, input, v)), { placeholder: 'variable or expression', className: 'mono' }))));
  });
  if (!ins.length) for (const r of [labels, exprs, values]) r.append(el('th', { className: 'empty', textContent: '-' }));
  outs.forEach((out, i) => {
    const th = el('th', {});
    const grip = el('span', { className: 'grip', title: 'Drag to move this column', textContent: '⋮⋮' });
    draggable(grip, 'output', i);
    dropTarget(th, 'output', i, (from, to) => dmn.moveOutput(table, from, to));
    th.append(el('div', { className: 'col-head' }, grip, textInput(out.getAttribute('label') ?? '', (v) => edit(() => dmn.setAttr(out, 'label', v)), { placeholder: 'label' }), removeColumn(() => restructure(() => dmn.removeOutput(table, i)))));
    labels.append(th);
    values.append(valuesCell(out));
    exprs.append(el('th', {}, el('div', { className: 'col-expr' }, select(out.getAttribute('typeRef') ?? '', TYPES, (v) => restructure(() => dmn.setAttr(out, 'typeRef', v)), '(type)'), textInput(out.getAttribute('name') ?? '', (v) => edit(() => dmn.setAttr(out, 'name', v)), { placeholder: 'result variable', className: 'mono' }))));
  });
  if (!outs.length) for (const r of [labels, exprs, values]) r.append(el('th', { className: 'empty', textContent: '-' }));
  grid.append(group, labels, exprs, values);

  dmn.rules(table).forEach((rule, r) => {
    const grip = el('span', { className: 'grip', title: 'Drag to move this rule', textContent: '⋮⋮' });
    // rule number cell: drag grip, number and (on hover) remove; reordering is by drag and drop
    const tr = el('tr', {}, el('td', { className: 'num' }, grip, String(r + 1), button('×', 'Remove rule', () => restructure(() => dmn.removeRule(table, r)), 'remove')));
    draggable(grip, 'rule', r);
    dropTarget(tr, 'rule', r, (from, to) => dmn.moveRule(table, from, to));
    // an input cell holding the "-" wildcard is shown empty, with "-" as the placeholder
    const cell = (entry, isInput, typeRef, expression) => {
      const shown = () => (isInput && dmn.textOf(entry).trim() === '-' ? '' : dmn.textOf(entry));
      const input = textInput(shown(), (v) => edit(() => dmn.setEntryText(doc, entry, v)), { className: 'mono', placeholder: isInput ? '-' : '' });
      input.addEventListener('change', () => { input.value = shown(); });
      attachSuggestions(input, isInput ? (text, caret) => suggest(typeRef, text, caret, expression()) : (text) => suggestOutput(typeRef, text));
      return el('td', {}, input);
    };
    dmn.inputEntries(rule).forEach((entry, i) => tr.append(cell(entry, true, ins[i] ? dmn.inputExpressionOf(ins[i]).getAttribute('typeRef') : '', () => (ins[i] ? dmn.textOf(dmn.inputExpressionOf(ins[i])) : ''))));
    dmn.outputEntries(rule).forEach((entry, i) => tr.append(cell(entry, false, outs[i]?.getAttribute('typeRef') ?? '')));
    tr.append(el('td', {}, textInput(dmn.ruleDescription(rule), (v) => edit(() => dmn.setRuleDescription(doc, rule, v)), { placeholder: 'description' })));
    grid.append(tr);
  });

  box.append(usedByNode);
  box.append(el('div', { className: 'grid-wrap' }, grid));
  box.append(el('div', { className: 'toolbar' },
    button('+ Rule', 'Add a rule at the end', () => restructure(() => dmn.addRule(doc, table))),
    button('+ Input', 'Add an input column', () => restructure(() => dmn.addInput(doc, table))),
    button('+ Output', 'Add an output column', () => restructure(() => dmn.addOutput(doc, table)))));
  return box;
}

// ---- suggestions for input cells (by column type) ---------------------------------------------------------------------------
// One popup shared by all cells: it opens when a cell gets focus, narrows as the text is typed, and inserts a template with the
// caret (or the date) selected. Only the cell text changes; it is stored through the cell's normal 'change' handler.
const popup = el('div', { className: 'suggest', role: 'listbox', hidden: true });
document.body.append(popup);
let popupFor = null; // { input, items, index }

function closePopup() {
  popup.hidden = true;
  popupFor = null;
}

function pick(item) {
  const { input } = popupFor;
  closePopup();
  input.value = item.text;
  input.dispatchEvent(new Event('change')); // store it
  input.focus();
  input.setSelectionRange(item.from, item.to);
}

function showPopup(input, suggestions) {
  const items = suggestions(input.value, input.selectionStart ?? input.value.length);
  if (!items.length || document.activeElement !== input) return closePopup();
  popupFor = { input, items, index: 0 };
  popup.replaceChildren(...items.map((item, i) => {
    const row = el('div', { className: 'suggest-item mono' + (i === 0 ? ' active' : ''), role: 'option', textContent: item.label });
    row.addEventListener('mousedown', (e) => { e.preventDefault(); pick(item); }); // before the input loses focus
    return row;
  }));
  const r = input.getBoundingClientRect();
  Object.assign(popup.style, { left: r.left + window.scrollX + 'px', top: r.bottom + window.scrollY + 'px', minWidth: r.width + 'px' });
  popup.hidden = false;
}

function moveActive(delta) {
  const n = popupFor.items.length;
  popupFor.index = (popupFor.index + delta + n) % n;
  [...popup.children].forEach((c, i) => c.classList.toggle('active', i === popupFor.index));
  popup.children[popupFor.index].scrollIntoView({ block: 'nearest' });
}

function attachSuggestions(input, suggestions) { // suggestions(text, caret) -> the items to offer
  if (!suggestions('', 0).length) return; // a type without suggestions
  const show = () => showPopup(input, suggestions);
  input.addEventListener('focus', show);
  input.addEventListener('input', show);
  input.addEventListener('click', show); // the caret moved
  input.addEventListener('keyup', (e) => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) show(); });
  input.addEventListener('blur', closePopup);
  input.addEventListener('keydown', (e) => {
    if (!popupFor || popupFor.input !== input) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      moveActive(e.key === 'ArrowDown' ? 1 : -1);
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      pick(popupFor.items[popupFor.index]);
    } else if (e.key === 'Escape') {
      closePopup();
    }
  });
}

function render() {
  const y = window.scrollY;
  app.replaceChildren();
  for (const d of dmn.decisions(doc)) app.append(renderDecision(d));
  if (!dmn.decisions(doc).length) app.append(el('p', { className: 'empty', textContent: 'This file has no decision.' }));
  window.scrollTo(0, y);
}

window.addEventListener('message', (event) => {
  if (event.data.type === 'usedBy') {
    usedBy = event.data.usages;
    document.querySelectorAll('.used-by').forEach(fillUsedBy);
    return;
  }
  if (event.data.type !== 'load') return;
  try {
    doc = dmn.parseDmn(event.data.xml);
    showError('');
    render();
  } catch (err) {
    showError('Cannot open this file as DMN: ' + err.message);
  }
});

vscode.postMessage({ type: 'ready' });
