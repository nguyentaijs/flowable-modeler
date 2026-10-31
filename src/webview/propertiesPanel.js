import { getGroups, elementTypeName, validateField } from '../core/panel.mjs';
import { checkJuelSyntax } from '../core/juel.mjs';
import { isDmnTask } from '../core/dmnTask.mjs';
import { readRow, emptyRow, replaceItems } from '../core/listItems.mjs';
import { readMultiInstance, updateMultiInstance } from '../core/multiInstance.mjs';

// While the panel is rebuilt, removing a focused input fires blur/change synchronously. Those events must
// neither write the (possibly stale) value back nor trigger a nested rebuild.
const ui = { rebuilding: false };

// Actions the host provides (set by mountPanel): openDecision(key) opens the .dmn file that defines a decision.
let hostActions = {};
const on = (target, type, fn) => target.addEventListener(type, (e) => { if (!ui.rebuilding) fn(e); });

// Text being typed must not be rebuilt under the cursor; other controls (checkbox, select, button) can be.
const isTyping = (e) => e.tagName === 'TEXTAREA' || (e.tagName === 'INPUT' && !['checkbox', 'radio', 'button'].includes(e.type));

const el = (tag, props = {}, ...kids) => {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...kids);
  return e;
};

// Reads and writes element values for the field kinds described by providers (see src/core/panel.mjs).
function createAdapter(modeler) {
  const modeling = modeler.get('modeling');
  const bpmnFactory = modeler.get('bpmnFactory');
  const moddle = modeler.get('moddle');

  // BPMN allows a default flow on gateways (exclusive, inclusive, complex) and activities.
  const canHaveDefault = (source) => source && ['bpmn:ExclusiveGateway', 'bpmn:InclusiveGateway', 'bpmn:ComplexGateway', 'bpmn:Activity'].some((t) => source.businessObject.$instanceOf(t));

  return {
    available(field, element) {
      return (field.target ?? 'attr') !== 'default-flow' || canHaveDefault(element.source);
    },
    read(field, bo) {
      const target = field.target ?? 'attr';
      if (target === 'default-flow') return bo.sourceRef?.default === bo;
      if (target === 'script') return bo.script;
      if (target === 'condition') return bo.conditionExpression?.body;
      if (field.kind === 'list' || field.kind === 'namedFields') return (bo.extensionElements?.values ?? []).filter((v) => v.$type === field.item.type).map((v) => readRow(v, field.item));
      return bo.get(field.key);
    },
    readMultiInstance: (bo) => readMultiInstance(bo),
    updateMultiInstance(element, change) {
      updateMultiInstance(moddle, element.businessObject, (target, props) => modeling.updateModdleProperties(element, target, props), change);
    },
    // Replace all rows of a list field (one undo step; creates <extensionElements> first if needed).
    writeRows(field, element, rows) {
      const bo = element.businessObject;
      let ee = bo.extensionElements;
      if (!ee) {
        ee = bpmnFactory.create('bpmn:ExtensionElements', { values: [] });
        modeling.updateModdleProperties(element, bo, { extensionElements: ee });
      }
      modeling.updateModdleProperties(element, ee, { values: replaceItems(moddle, ee.values ?? [], field.item, rows) });
    },
    write(field, element, value) {
      const bo = element.businessObject;
      const v = value === '' ? undefined : value;
      const target = field.target ?? 'attr';
      if (target === 'default-flow') {
        modeling.updateProperties(element.source, { default: value ? bo : undefined });
        if (value && bo.conditionExpression) modeling.updateProperties(element, { conditionExpression: undefined }); // a default flow carries no condition
        return;
      }
      if (target === 'script') return modeling.updateProperties(element, { script: value });
      if (target === 'condition') {
        const body = v === undefined ? undefined : bpmnFactory.create('bpmn:FormalExpression', { body: v });
        return modeling.updateProperties(element, { conditionExpression: body });
      }
      return modeling.updateProperties(element, { [field.key]: v });
    },
  };
}

// Editable list of repeated child elements (e.g. <flowable:field>): every column is an input, rows can be
// added and removed. Each change rewrites the whole list from the current model as one undo step.
function renderList(field, element, adapter, refresh) {
  const wrap = el('div', { className: 'list' });
  const commit = (mutate) => {
    const next = adapter.read(field, element.businessObject); // start from the model, not from stale closures
    mutate(next);
    adapter.writeRows(field, element, next);
  };

  adapter.read(field, element.businessObject).forEach((row, i) => {
    const box = el('div', { className: 'list-row' });
    const cells = el('div', { className: 'list-cells' });
    for (const col of field.item.columns) {
      const cell = el('div', { className: 'list-cell' });
      const input = el('input', { type: 'text', value: row[col.key] ?? '', placeholder: col.label, spellcheck: false, title: col.label });
      let typeSelect = null;
      on(input, 'change', () => commit((r) => (r[i][col.key] = input.value)));
      if (col.as === 'child' || col.as === 'attrChoice') {
        const options = col.as === 'child' ? col.childTypes.map((t) => ({ key: t, label: t })) : col.choices;
        const type = el('select', { title: col.label + ' kind' });
        options.forEach((o) => type.append(el('option', { value: o.key, textContent: o.label })));
        type.value = row[col.key + 'Type'];
        typeSelect = type;
        on(type, 'change', () => check());
        on(type, 'change', () => commit((r) => (r[i][col.key + 'Type'] = type.value)));
        cell.append(type);
      }
      const status = el('div', { className: 'juel' });
      const check = () => {
        const t = typeSelect ? typeSelect.value : row[col.key + 'Type'];
        const isExpression = col.as === 'child' ? t === 'expression' : col.as === 'attrChoice' ? !!col.choices.find((c) => c.key === t)?.expression : !!col.expression;
        status.textContent = isExpression ? checkJuelSyntax(input.value).map((p) => p.message).join('; ') : '';
      };
      on(input, 'input', check);
      check();
      cell.append(input, status);
      cells.append(cell);
    }
    const remove = el('button', { type: 'button', textContent: '×', title: 'Remove' });
    on(remove, 'click', () => {
      commit((r) => r.splice(i, 1));
      refresh();
    });
    box.append(cells, remove);
    wrap.append(box);
  });

  const add = el('button', { type: 'button', textContent: '+ Add', className: 'add' });
  on(add, 'click', () => {
    commit((r) => {
      const row = emptyRow(field.item);
      if ('name' in row) row.name = 'field' + (r.length + 1);
      r.push(row);
    });
    refresh();
  });
  wrap.append(add);
  return wrap;
}

// Predefined field extensions (e.g. DMN task): fixed names, only the value is editable. An emptied value removes the row.
function renderNamedFields(field, element, adapter) {
  const wrap = el('div', { className: 'list' });
  for (const def of field.names) {
    const rows = adapter.read(field, element.businessObject);
    const current = rows.find((r) => r.name === def.name);
    const cell = el('div', { className: 'field' }, el('label', { textContent: def.label, title: def.name }));
    let input;
    if (def.kind === 'boolean') {
      input = el('select');
      for (const v of ['', 'true', 'false']) input.append(el('option', { value: v, textContent: v || '(not set)' }));
      input.value = current?.value ?? '';
    } else {
      input = el('input', { type: 'text', value: current?.value ?? '', spellcheck: false, placeholder: def.name });
    }
    on(input, 'change', () => {
      const next = adapter.read(field, element.businessObject);
      const i = next.findIndex((r) => r.name === def.name);
      if (input.value === '') {
        if (i >= 0) next.splice(i, 1);
      } else if (i >= 0) {
        next[i].value = input.value;
      } else {
        next.push({ ...emptyRow(field.item), name: def.name, value: input.value });
      }
      adapter.writeRows(field, element, next);
    });
    if (def.name === 'decisionTableReferenceKey' && hostActions.openDecision) {
      const open = el('button', { type: 'button', textContent: 'Open ↗', title: 'Open the decision table (.dmn) with this key', className: 'open-decision' });
      on(open, 'click', () => {
        const key = input.value.trim();
        if (key && !/[$#]{/.test(key)) hostActions.openDecision(key);
      });
      cell.append(el('div', { className: 'input-with-button' }, input, open));
    } else cell.append(input);
    wrap.append(cell);
  }
  return wrap;
}

// Mode dropdown (None / Parallel / Sequential) and, when a loop is set, its collection, variables and conditions.
function renderMultiInstance(field, element, adapter, refresh) {
  const wrap = el('div', { className: 'mi' });
  const { mode, values } = adapter.readMultiInstance(element.businessObject);
  const select = el('select', { title: 'Loop type' });
  field.modes.forEach((m) => select.append(el('option', { value: m.key, textContent: m.label })));
  select.value = mode;
  on(select, 'change', () => {
    adapter.updateMultiInstance(element, { mode: select.value });
    refresh();
  });
  wrap.append(select);
  if (mode === 'none') return wrap;
  for (const f of field.fields) {
    const row = el('div', { className: 'field' }, el('label', { textContent: f.label }));
    const input = el('input', { type: 'text', value: values[f.key] ?? '', placeholder: f.hint ?? '', spellcheck: false });
    const status = el('div', { className: 'juel' });
    const check = () => {
      status.textContent = f.kind === 'expression' ? checkJuelSyntax(input.value).map((p) => p.message).join('; ') : '';
    };
    on(input, 'input', check);
    on(input, 'change', () => adapter.updateMultiInstance(element, { key: f.key, value: input.value }));
    check();
    row.append(input, status);
    wrap.append(row);
  }
  return wrap;
}

function renderField(field, element, adapter, modeler, refresh) {
  const bo = element.businessObject;
  if (field.requiresProperty && !bo.$descriptor?.propertiesByName?.[field.requiresProperty]) return null;
  if (!adapter.available(field, element)) return null;
  if (field.dmnOnly && !isDmnTask(bo)) return null;
  if (field.notDmn && isDmnTask(bo)) return null;
  const current = adapter.read(field, bo);
  const row = el('div', { className: 'field' }, el('label', { textContent: field.label, title: field.key }));

  if (field.kind === 'multiInstance') {
    row.append(renderMultiInstance(field, element, adapter, refresh));
    return row;
  }

  if (field.kind === 'namedFields') {
    row.querySelector('label').remove(); // the group title already says it; each named value has its own label
    row.append(renderNamedFields(field, element, adapter));
    return row;
  }

  if (field.kind === 'list') {
    row.append(renderList(field, element, adapter, refresh));
    return row;
  }

  if (field.kind === 'toggle') {
    const box = el('input', { type: 'checkbox', checked: !!current });
    const label = row.querySelector('label');
    label.prepend(box, ' ');
    on(box, 'change', () => adapter.write(field, element, box.checked));
    if (field.hint) row.append(el('div', { className: 'empty', textContent: field.hint }));
    return row;
  }

  let input;
  if (field.kind === 'boolean' || field.kind === 'enum') {
    input = el('select');
    for (const v of ['', ...(field.kind === 'boolean' ? ['true', 'false'] : field.values)]) input.append(el('option', { value: v, textContent: v || '(not set)' }));
    input.value = current ?? '';
  } else if (field.kind === 'textarea') {
    input = el('textarea', { rows: 10, spellcheck: false, value: current ?? '' });
  } else {
    input = el('input', { type: 'text', value: current ?? '', placeholder: field.hint ?? '', spellcheck: false });
    if (field.suggestions) {
      const list = el('datalist', { id: 'dl-' + field.key });
      field.suggestions.forEach((s) => list.append(el('option', { value: s })));
      input.setAttribute('list', list.id);
      row.append(list);
    }
  }
  input.disabled = !!field.readOnly;
  row.append(input);

  if (field.kind === 'expression') {
    const status = el('div', { className: 'juel' });
    const check = () => {
      status.textContent = checkJuelSyntax(input.value).map((p) => p.message).join('; ');
    };
    on(input, 'input', check);
    check();
    row.append(status);
  }
  const problem = el('div', { className: 'juel' });
  row.append(problem);
  // Commit on change (blur/enter/select), not per keystroke, so one edit is one undo step.
  on(input, 'change', () => {
    const isIdTaken = (id) => modeler.get('elementRegistry').filter((e) => e.businessObject?.id === id && e !== element && e.type !== 'label').length > 0;
    const error = field.validate ? validateField(field.validate, input.value, { isIdTaken }) : '';
    problem.textContent = error;
    if (error) return; // keep the typed text visible, do not write an invalid value
    adapter.write(field, element, input.value);
  });
  return row;
}

export function mountPanel(modeler, container, host = {}) {
  hostActions = host;
  const adapter = createAdapter(modeler);
  const eventBus = modeler.get('eventBus');
  const selection = modeler.get('selection');
  let renderedFor = null;

  const render = (force = false) => {
    if (ui.rebuilding) return;
    // nothing selected: show the diagram root (the process), so id and name are always reachable
    const element = selection.get()[0] ?? modeler.get('canvas').getRootElement();
    const active = document.activeElement;
    if (!force && element && container.contains(active) && renderedFor === element.id && isTyping(active)) return; // do not rebuild under the cursor
    renderedFor = element?.id ?? null;
    ui.rebuilding = true;
    try {
      container.replaceChildren();
    } finally {
      ui.rebuilding = false;
    }
    if (!element || !element.businessObject?.$type) {
      container.append(el('p', { className: 'empty', textContent: 'Select an element to edit its properties.' }));
      return;
    }
    const type = elementTypeName(element.businessObject.$type);
    container.append(el('h2', { textContent: isDmnTask(element.businessObject) ? 'dmnTask (serviceTask)' : type }));
    for (const g of getGroups(type)) {
      const details = el('details', { open: g.id !== 'flowable' }, el('summary', { textContent: g.title }));
      const rows = g.fields.map((f) => renderField(f, element, adapter, modeler, () => render(true))).filter(Boolean);
      if (!rows.length) continue; // every field was hidden for this element (e.g. the generic Fields list on a DMN task)
      details.append(...rows);
      container.append(details);
    }
  };

  // a panel problem must never break loading or editing the diagram
  const safeRender = () => {
    try {
      render();
    } catch (err) {
      ui.rebuilding = false;
      container.textContent = 'Properties panel error: ' + err.message;
    }
  };
  eventBus.on('selection.changed', safeRender);
  eventBus.on('import.done', () => {
    renderedFor = null; // the diagram was reloaded (undo, redo, external edit): rebuild from the new model
    safeRender();
  });
  eventBus.on('commandStack.changed', () => {
    renderedFor = null;
    safeRender(); // checkboxes, selects and buttons keep no typed text, so dependent fields can refresh at once
  });
  safeRender();
}
