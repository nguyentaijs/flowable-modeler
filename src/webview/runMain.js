import NavigatedViewer from 'bpmn-js/lib/NavigatedViewer';
import flowableRenderer from './flowableRenderer.js';
import * as dmn from '../core/dmnModel.mjs';
import { mountSplitter } from './splitter.js';
import { scriptOutputNames } from '../core/scriptOutputs.mjs';
import { callParameters } from '../core/callParameters.mjs';
import { serviceTaskInfo } from '../core/serviceTask.mjs';
import { resolveExpression } from '../core/expressionValue.mjs';

const vscode = acquireVsCodeApi();
const $ = (id) => document.getElementById(id);
const errorBox = $('error');

const el = (tag, props = {}, ...kids) => {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...kids);
  return e;
};
const fmtMs = (ms) => (ms === null || ms === undefined ? '-' : ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(2)} s`);
const json = (v) => {
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
};
const showError = (msg) => {
  errorBox.textContent = msg || '';
  errorBox.hidden = !msg;
};

const viewer = new NavigatedViewer({ container: '#canvas', additionalModules: [flowableRenderer] });
let data = null;
let currentId = null;
let overlayIds = [];

// ---- instance tree

function depthOf(inst) {
  let d = 0;
  for (let i = inst; i.parentInstanceId && data.instances[i.parentInstanceId]; i = data.instances[i.parentInstanceId]) d++;
  return d;
}

function renderTree() {
  const tree = $('run-tree');
  tree.replaceChildren(el('h3', { textContent: 'Process instances' }));
  for (const id of data.order) {
    const inst = data.instances[id];
    const item = el('button', { type: 'button', className: 'tree-item' + (id === currentId ? ' current' : ''), title: id });
    item.style.paddingLeft = 8 + depthOf(inst) * 16 + 'px';
    item.append(el('span', { className: 'chip ' + statusClass(inst.status), textContent: inst.status }), ' ', el('b', { textContent: inst.defKey || '(unknown)' }), el('small', { textContent: ' ' + id.slice(0, 8) }));
    item.addEventListener('click', () => open(id));
    tree.append(item);
  }
}

const statusClass = (status) => (status === 'COMPLETED' ? 'ok' : status === 'RUNNING' ? 'wait' : 'bad');

// ---- banner

let treeHidden = vscode.getState()?.treeHidden ?? false;

function toggleTree() {
  treeHidden = !treeHidden;
  vscode.setState({ ...vscode.getState(), treeHidden });
  $('run-tree').hidden = treeHidden;
  $('tree-toggle').textContent = treeHidden ? '☰ Show instances' : '☰ Hide instances';
  viewer.get('canvas').resized();
}

function renderBanner(inst) {
  const b = $('run-banner');
  $('run-tree').hidden = treeHidden;
  const toggle = button(treeHidden ? '☰ Show instances' : '☰ Hide instances', toggleTree);
  toggle.id = 'tree-toggle';
  b.replaceChildren(
    toggle,
    el('span', { className: 'chip ' + statusClass(inst.status), textContent: inst.status }),
    el('b', { textContent: inst.defKey || '' }),
    el('code', { textContent: inst.instanceId }),
    el('span', { textContent: `${inst.start || '-'} · ${fmtMs(inst.durationMs)}` }),
  );
  if (inst.parentInstanceId && data.instances[inst.parentInstanceId]) b.append(button('↑ parent run', () => open(inst.parentInstanceId)));
  b.append(button('Variables', () => showVariables(inst)));
  if (inst.uri) b.append(button('Open model', () => vscode.postMessage({ type: 'openFile', uri: inst.uri })));
  b.append(el('span', { className: 'hint', textContent: 'flows are inferred from executed steps' }));
  b.append(el('a', { id: 'author-link', href: 'https://www.linkedin.com/in/nguyentaijs', title: 'Opens LinkedIn', textContent: 'Contact the author' }));
}

function button(text, onClick) {
  const b = el('button', { type: 'button', textContent: text });
  b.addEventListener('click', onClick);
  return b;
}

// ---- diagram + overlay

async function open(id) {
  const inst = data.instances[id];
  currentId = id;
  renderTree();
  renderBanner(inst);
  closeDetail();
  if (!inst.bpmn) {
    viewer.clear();
    showError(inst.note || 'No diagram for this instance.');
    return;
  }
  try {
    const { warnings } = await viewer.importXML(inst.bpmn);
    showError(warnings.length ? `Imported with ${warnings.length} warning(s): ${warnings[0].message}` : '');
    viewer.get('canvas').zoom('fit-viewport');
    apply(inst);
  } catch (err) {
    showError('Cannot draw this process: ' + err.message);
  }
}

function apply(inst) {
  const canvas = viewer.get('canvas');
  const registry = viewer.get('elementRegistry');
  const overlays = viewer.get('overlays');
  const run = inst.overlay;
  overlayIds.forEach((o) => overlays.remove(o));
  overlayIds = [];
  const flowSet = new Set(run.flows);
  registry.forEach((element) => {
    const type = element.businessObject && element.businessObject.$type;
    if (!type || element.labelTarget) return;
    if (type === 'bpmn:SequenceFlow') {
      canvas.addMarker(element.id, flowSet.has(element.id) ? 'run-done' : 'run-skip');
    } else if (/Task$|Gateway$|Event$|CallActivity$|SubProcess$/.test(type)) {
      const a = run.activities[element.id];
      if (!a) {
        canvas.addMarker(element.id, 'run-skip');
        return;
      }
      canvas.addMarker(element.id, 'run-' + a.state);
      if (a.count > 1) overlayIds.push(overlays.add(element.id, 'run', { position: { top: -10, right: 10 }, html: `<span class="run-badge">x${a.count}</span>` }));
      if (/Task$|CallActivity$|SubProcess$/.test(type)) overlayIds.push(overlays.add(element.id, 'run', { position: { bottom: -6, left: 0 }, html: `<div class="run-dur">${fmtMs(a.durationMs)}</div>` }));
    }
  });
}

viewer.get('eventBus').on('element.click', 500, (e) => {
  const inst = data && data.instances[currentId];
  const id = e.element && e.element.id;
  if (inst && inst.overlay && id && inst.overlay.activities[id]) showElement(inst, e.element);
});

// ---- detail panel

function openDetail(title, ...content) {
  const d = $('run-detail');
  d.replaceChildren(el('div', { className: 'detail-head' }, el('b', { textContent: title }), button('×', closeDetail)), ...content);
  d.hidden = false;
  $('run-splitter').hidden = false;
}
function closeDetail() {
  $('run-detail').hidden = true;
  $('run-splitter').hidden = true;
}

mountSplitter({
  splitter: $('run-splitter'),
  panel: $('run-detail'),
  layout: $('run-layout'),
  vscode,
  defaultWidth: 380,
  key: 'detailWidth',
  onResize: () => viewer.get('canvas').resized(),
});

function table(head, rows) {
  const t = el('table', { className: 'run-table' }, el('thead', {}, el('tr', {}, ...head.map((h) => el('th', { textContent: h })))));
  t.append(el('tbody', {}, ...rows));
  return t;
}

// Falls back to a hidden textarea where the async clipboard API is not allowed in the webview.
async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch {
    /* use the fallback */
  }
  const area = el('textarea', { value: text });
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.append(area);
  area.select();
  document.execCommand('copy');
  area.remove();
}

// A value, with a button that copies exactly the text shown.
function pre(v) {
  const text = typeof v === 'string' ? v : json(v);
  const copy = button('Copy', () => {
    copyText(text).then(() => {
      copy.textContent = 'Copied';
      setTimeout(() => (copy.textContent = 'Copy'), 1200);
    });
  });
  copy.className = 'copy-btn';
  copy.title = 'Copy this value';
  return el('div', { className: 'value-box' }, el('pre', { textContent: text }), copy);
}

function showElement(inst, element) {
  const run = inst.overlay;
  const a = run.activities[element.id];
  const nodes = [
    el('h4', { textContent: `${a.state} · ${a.count} execution${a.count > 1 ? 's' : ''}` }),
    table(['#', 'start', 'duration'], a.runs.map((r, i) => el('tr', {}, el('td', { textContent: String(i + 1) }), el('td', { textContent: r.startMs ? new Date(r.startMs).toISOString() : '-' }), el('td', { textContent: fmtMs(r.durationMs) })))),
  ];
  const child = run.children[element.id];
  if (child) {
    const link = el('a', { href: '#', textContent: `${child.defKey} (${child.instanceId.slice(0, 8)})` });
    link.addEventListener('click', (ev) => {
      ev.preventDefault();
      open(child.instanceId);
    });
    nodes.push(el('p', {}, 'Called process: ', link));
  } else if (run.calledNoPage && run.calledNoPage[element.id]) {
    nodes.push(el('p', { textContent: `Called process: ${run.calledNoPage[element.id]} (no BPMN file found, no diagram)` }));
  }
  const d = run.dmn[element.id];
  if (d) nodes.push(...dmnNodes(d));
  const bo = element.businessObject;
  if (bo && bo.$type === 'bpmn:CallActivity') nodes.push(...callNodes(inst, bo, child));
  if (bo && bo.$type === 'bpmn:ServiceTask' && !d) nodes.push(...serviceNodes(inst, bo, a));
  if (bo && bo.$type === 'bpmn:ScriptTask') {
    const declared = scriptOutputNames(bo.script, bo.$attrs && bo.$attrs['flowable:resultVariable']);
    const names = [...new Set([...(a.outputs || []), ...declared])].sort();
    nodes.push(el('h4', { textContent: 'Output variables (final values)' }));
    nodes.push(...(names.length ? varTables(inst.variables, names) : [el('p', { className: 'hint', textContent: 'No output variables found for this script task.' })]));
  }
  openDetail((element.businessObject && element.businessObject.name) || element.id, ...nodes);
}

// Parameters declared on the call activity, with the value each ended up with: inputs as the called process holds
// them, outputs as the calling process holds them (final values; history keeps no earlier ones).
function callNodes(inst, bo, child) {
  const params = callParameters(bo.extensionElements && bo.extensionElements.values);
  const calledVars = (child && data.instances[child.instanceId] && data.instances[child.instanceId].variables) || null;
  const from = (p) => p.sourceExpression || p.source || '';
  const to = (p) => p.targetExpression || p.target || '';
  const value = (vars, name) => {
    if (!vars || !name) return el('span', { className: 'hint', textContent: 'n/a' });
    if (!(name in vars)) return el('span', { className: 'hint', textContent: '(not stored)' });
    const v = vars[name];
    return pre(typeof v === 'object' ? v : String(v));
  };
  // one table per parameter: "from -> to" is the header, the value follows
  const section = (title, list, vars, nameOf) =>
    list.length ? [el('h4', { textContent: title }), ...list.map((p) => table([`${from(p)} -> ${to(p)}`], [el('tr', {}, el('td', {}, value(vars, nameOf(p))))]))] : [];
  const nodes = [
    ...section('Input parameters (value in the called process)', params.in, calledVars, (p) => p.target),
    ...section('Output parameters (value in this process)', params.out, inst.variables, (p) => p.target),
  ];
  const inherit = bo.$attrs && bo.$attrs['flowable:inheritVariables'];
  if (inherit === 'true') nodes.push(el('p', { className: 'hint', textContent: 'inheritVariables is on: all variables of this process were copied into the called process.' }));
  if (!nodes.length) nodes.push(el('p', { className: 'hint', textContent: 'This call activity declares no in or out parameters.' }));
  return nodes;
}

// A field whose value is an expression shows what it comes to, with the expression itself underneath.
function fieldTable(f, variables) {
  const isExpr = f.kind === 'expression' || /[$#]{/.test(f.value);
  const header = `${f.name || ''}${isExpr ? ' (expression)' : ''}`;
  if (!isExpr) return table([header], [el('tr', {}, el('td', {}, pre(f.value)))]);
  const r = resolveExpression(f.value, variables);
  const note = r.resolved ? `from ${f.value}` : r.reason === 'not found' ? `no value for ${f.value}` : 'cannot resolve here (only plain variable paths)';
  const body = r.resolved ? pre(typeof r.value === 'object' && r.value !== null ? r.value : String(r.value)) : pre(f.value);
  return table([header], [el('tr', {}, el('td', {}, body, el('small', { className: 'hint', textContent: note })))]);
}

// Outputs when they can be found (resultVariable, or variables written while the task ran); otherwise the inputs the
// task was configured with, so there is still something to read.
function serviceNodes(inst, bo, a) {
  const info = serviceTaskInfo(bo);
  const names = [...new Set([...(a.outputs || []), ...(info.resultVariable ? [info.resultVariable] : [])])].sort();
  if (names.length) return [el('h4', { textContent: 'Output variables (final values)' }), ...varTables(inst.variables, names)];
  const nodes = [el('h4', { textContent: 'No output variable found. Inputs:' })];
  if (info.implementation) nodes.push(el('p', {}, `${info.implementation.kind}: `, el('code', { textContent: info.implementation.value })));
  if (info.fields.length) {
    // one table per field: the name is the header (marked when it is an expression), the value follows
    nodes.push(...info.fields.map((f) => fieldTable(f, inst.variables)));
    nodes.push(el('p', { className: 'hint', textContent: "Values are worked out from the variables' final values, which may differ from what the task saw." }));
  }
  if (!info.implementation && !info.fields.length) nodes.push(el('p', { className: 'hint', textContent: 'This service task declares no implementation or fields.' }));
  return nodes;
}

function dmnNodes(d) {
  const nodes = [el('h4', { textContent: `DMN ${d.key || ''}${d.hitPolicy ? ' · ' + d.hitPolicy : ''}${d.failed ? ' · FAILED' : ''}` })];
  nodes.push(el('p', { textContent: d.hitRules.length ? `Matched rule row${d.hitRules.length > 1 ? 's' : ''}: ${d.hitRules.join(', ')}` : 'No matched rule row reported by the DMN audit.' }));
  if (d.error) nodes.push(pre(d.error));
  const xml = d.key && data.decisions[d.key];
  if (xml) {
    try {
      nodes.push(decisionTable(xml, d.key, new Set(d.hitRules)));
    } catch (e) {
      nodes.push(el('p', { textContent: 'Cannot show the decision table: ' + e.message }));
    }
  } else if (d.key) {
    nodes.push(el('p', { className: 'hint', textContent: `No .dmn file with decision id "${d.key}" in the workspace.` }));
  }
  nodes.push(el('p', { textContent: 'Inputs' }), pre(d.inputs), el('p', { textContent: 'Result' }), pre(d.result));
  return nodes;
}

function decisionTable(xml, key, hits) {
  const doc = dmn.parseDmn(xml);
  const decision = dmn.decisions(doc).find((x) => x.getAttribute('id') === key) || dmn.decisions(doc)[0];
  const tbl = decision && dmn.decisionTable(decision);
  if (!tbl) return el('p', { textContent: 'This decision has no decision table.' });
  const ins = dmn.inputs(tbl);
  const outs = dmn.outputs(tbl);
  const head = ['#', ...ins.map((i) => i.getAttribute('label') || dmn.textOf(dmn.inputExpressionOf(i))), ...outs.map((o) => o.getAttribute('label') || o.getAttribute('name') || '')];
  const rows = dmn.rules(tbl).map((rule, i) => {
    const tr = el('tr', { className: hits.has(i + 1) ? 'run-hit' : '' }, el('td', { textContent: String(i + 1) }));
    for (const entry of [...dmn.inputEntries(rule), ...dmn.outputEntries(rule)]) tr.append(el('td', { className: 'mono', textContent: dmn.textOf(entry) }));
    return tr;
  });
  return el('div', { className: 'detail-table' }, el('small', { textContent: `Hit policy ${tbl.getAttribute('hitPolicy') || 'UNIQUE'}` }), table(head, rows));
}

// One table per variable: the name is the header, the value is the body.
function varTables(variables, names) {
  return names.map((k) => {
    const body = !(k in variables) ? el('span', { className: 'hint', textContent: '(not stored)' }) : pre(typeof variables[k] === 'object' ? variables[k] : String(variables[k]));
    return table([k], [el('tr', {}, el('td', {}, body))]);
  });
}

function showVariables(inst) {
  openDetail('Process variables (final values)', ...varTables(inst.variables, Object.keys(inst.variables).sort()));
}

window.addEventListener('message', (event) => {
  if (event.data.type !== 'run') return;
  data = event.data.data;
  open(data.order[0]);
});

vscode.postMessage({ type: 'ready' });
