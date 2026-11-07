import BpmnModeler from 'bpmn-js/lib/Modeler';
import { mountPanel } from './propertiesPanel.js';
import flowablePalette from './flowablePalette.js';
import flowableRenderer from './flowableRenderer.js';
import { mountSplitter } from './splitter.js';
import { mountProblems } from './problems.js';

const vscode = acquireVsCodeApi();
mountProblems(vscode);
const errorBox = document.getElementById('error');

const modeler = new BpmnModeler({ container: '#canvas', additionalModules: [flowablePalette, flowableRenderer] });
mountPanel(modeler, document.getElementById('panel'), { openDecision: (key) => vscode.postMessage({ type: 'openDecision', key }) });

let importing = false;
let timer;

const showError = (msg) => {
  errorBox.textContent = msg || '';
  errorBox.hidden = !msg;
};

async function load(xml) {
  vscode.postMessage({ type: 'log', text: 'load start' });
  const canvas = modeler.get('canvas');
  const view = modeler._definitions ? canvas.viewbox() : null;
  const selected = modeler._definitions ? modeler.get('selection').get().map((e) => e.id) : [];
  importing = true;
  try {
    const { warnings } = await modeler.importXML(xml);
    showError(warnings.length ? `Imported with ${warnings.length} warning(s): ${warnings[0].message}` : '');
    if (view) canvas.viewbox(view);
    else canvas.zoom('fit-viewport');
    // keep the same element selected (e.g. after undo) so the panel shows its restored values
    const registry = modeler.get('elementRegistry');
    modeler.get('selection').select(selected.map((id) => registry.get(id)).filter(Boolean));
  } catch (err) {
    showError('Cannot open this file as BPMN: ' + err.message);
  } finally {
    importing = false;
    vscode.postMessage({ type: 'log', text: 'load done' });
  }
}

// Debounced: each burst of edits is serialized once and sent to the host, which turns it into a minimal text diff.
modeler.on('commandStack.changed', () => {
  vscode.postMessage({ type: 'log', text: `commandStack.changed (importing=${importing})` });
  if (importing) return;
  clearTimeout(timer);
  timer = setTimeout(async () => {
    try {
      const { xml } = await modeler.saveXML({ format: true });
      vscode.postMessage({ type: 'changed', xml });
    } catch (err) {
      showError('Cannot serialize diagram: ' + err.message);
    }
  }, 150);
});

window.addEventListener('message', (event) => {
  if (event.data.type === 'load') load(event.data.xml);
});

mountSplitter({
  splitter: document.getElementById('splitter'),
  panel: document.getElementById('panel'),
  layout: document.getElementById('layout'),
  vscode,
  onResize: () => modeler.get('canvas').resized(),
});

vscode.postMessage({ type: 'ready' });
