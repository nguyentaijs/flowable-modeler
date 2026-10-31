import NavigatedViewer from 'bpmn-js/lib/NavigatedViewer';
import flowableRenderer from './flowableRenderer.js';
import * as dmn from '../core/dmnModel.mjs';

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

function renderBanner(inst) {
  const b = $('run-banner');
  b.replaceChildren(
    el('span', { className: 'chip ' + statusClass(inst.status), textContent: inst.status }),
    el('b', { textContent: inst.defKey || '' }),
    el('code', { textContent: inst.instanceId }),
    el('span', { textContent: `${inst.start || '-'} · ${fmtMs(inst.durationMs)}` }),
  );
  if (inst.outcome) {
    const o = inst.outcome.outcome;
    b.append(el('span', { className: 'chip ' + (/^APPROVED/.test(o) ? 'ok' : /^DECLINED/.test(o) ? 'bad' : 'wait'), textContent: o }), el('span', { textContent: `(${inst.outcome.from})` }));
  }
  if (inst.parentInstanceId && data.instances[inst.parentInstanceId]) b.append(button('↑ parent run', () => open(inst.parentInstanceId)));
  b.append(button('Variables', () => showVariables(inst)));
  if (inst.uri) b.append(button('Open model', () => vscode.postMessage({ type: 'openFile', uri: inst.uri })));
  b.append(el('span', { className: 'hint', textContent: 'flows are inferred from executed steps' }));
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
}
function closeDetail() {
  $('run-detail').hidden = true;
}

function table(head, rows) {
  const t = el('table', { className: 'run-table' }, el('thead', {}, el('tr', {}, ...head.map((h) => el('th', { textContent: h })))));
  t.append(el('tbody', {}, ...rows));
  return t;
}
const pre = (v) => el('pre', { textContent: typeof v === 'string' ? v : json(v) });

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
  openDetail((element.businessObject && element.businessObject.name) || element.id, ...nodes);
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

function showVariables(inst) {
  const rows = Object.keys(inst.variables).sort().map((k) => {
    const v = inst.variables[k];
    return el('tr', {}, el('td', { textContent: k }), el('td', {}, pre(typeof v === 'object' ? v : String(v))));
  });
  openDetail('Process variables (final values)', table(['name', 'value'], rows));
}

window.addEventListener('message', (event) => {
  if (event.data.type !== 'run') return;
  data = event.data.data;
  open(data.order[0]);
});

vscode.postMessage({ type: 'ready' });
