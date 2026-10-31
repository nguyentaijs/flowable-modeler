import * as dmn from '../core/dmnModel.mjs';
import schema from '../../schema/flowable-dmn-7.2.0.json';

const vscode = acquireVsCodeApi();
const app = document.getElementById('app');
const errorBox = document.getElementById('error');
const TABLE = schema.decisionTable;
const TYPES = ['string', 'number', 'boolean', 'date'];

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

// Every change is serialized once after a short pause; the host turns it into a minimal text diff.
function changed() {
  clearTimeout(timer);
  timer = setTimeout(() => vscode.postMessage({ type: 'changed', xml: dmn.serializeDmn(doc) }), 150);
}

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
  node.replaceChildren(el('span', { className: 'used-by-title', textContent: usedBy.ready ? `Used by (${list.length})` : 'Used by (scanning the workspace...)' }));
  if (usedBy.ready && !list.length) node.append(el('span', { className: 'empty', textContent: ' not referenced by any DMN task in this workspace' }));
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
  box.append(
    el('div', { className: 'decision-head' },
      el('label', { textContent: 'Decision id' }), textInput(decision.getAttribute('id') ?? '', (v) => edit(() => dmn.setAttr(decision, 'id', v))),
      el('label', { textContent: 'Name' }), textInput(decision.getAttribute('name') ?? '', (v) => edit(() => dmn.setAttr(decision, 'name', v)))),
  );
  if (!table) {
    box.append(el('p', { className: 'empty', textContent: 'This decision has no decision table.' }));
    return box;
  }

  const hit = TABLE.attributes.hitPolicy;
  const agg = TABLE.attributes.aggregation;
  const head = el('div', { className: 'decision-head' },
    el('label', { textContent: 'Hit policy' }),
    select(table.getAttribute('hitPolicy') ?? '', hit.values, (v) => restructure(() => {
      dmn.setAttr(table, 'hitPolicy', v);
      if (v !== agg.onlyWhen.hitPolicy) dmn.setAttr(table, 'aggregation', ''); // aggregation only exists for COLLECT
    }), '(default)'));
  if (table.getAttribute('hitPolicy') === agg.onlyWhen.hitPolicy) {
    head.append(el('label', { textContent: 'Aggregation' }), select(table.getAttribute('aggregation') ?? '', agg.values, (v) => edit(() => dmn.setAttr(table, 'aggregation', v)), '(none)'));
  }
  box.append(head);

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
    exprs.append(el('th', {}, el('div', { className: 'col-expr' }, select(ie.getAttribute('typeRef') ?? '', TYPES, (v) => edit(() => dmn.setAttr(ie, 'typeRef', v)), '(type)'), textInput(dmn.textOf(ie), (v) => edit(() => dmn.setInputExpression(doc, input, v)), { placeholder: 'variable or expression', className: 'mono' }))));
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
    exprs.append(el('th', {}, el('div', { className: 'col-expr' }, select(out.getAttribute('typeRef') ?? '', TYPES, (v) => edit(() => dmn.setAttr(out, 'typeRef', v)), '(type)'), textInput(out.getAttribute('name') ?? '', (v) => edit(() => dmn.setAttr(out, 'name', v)), { placeholder: 'result variable', className: 'mono' }))));
  });
  if (!outs.length) for (const r of [labels, exprs, values]) r.append(el('th', { className: 'empty', textContent: '-' }));
  grid.append(group, labels, exprs, values);

  dmn.rules(table).forEach((rule, r) => {
    const grip = el('span', { className: 'grip', title: 'Drag to move this rule', textContent: '⋮⋮' });
    // rule number cell: drag grip, number and (on hover) remove; reordering is by drag and drop
    const tr = el('tr', {}, el('td', { className: 'num' }, grip, String(r + 1), button('×', 'Remove rule', () => restructure(() => dmn.removeRule(table, r)), 'remove')));
    draggable(grip, 'rule', r);
    dropTarget(tr, 'rule', r, (from, to) => dmn.moveRule(table, from, to));
    const cell = (entry) => el('td', {}, textInput(dmn.textOf(entry), (v) => edit(() => dmn.setEntryText(doc, entry, v)), { className: 'mono' }));
    dmn.inputEntries(rule).forEach((entry) => tr.append(cell(entry)));
    dmn.outputEntries(rule).forEach((entry) => tr.append(cell(entry)));
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
