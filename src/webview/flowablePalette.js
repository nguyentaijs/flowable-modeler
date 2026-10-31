import { listPaletteEntries } from '../core/palette.mjs';

// Adds the entries registered in src/core/palette.mjs to the bpmn-js palette.
export class FlowablePaletteProvider {
  constructor(palette, create, elementFactory, bpmnFactory) {
    this._create = create;
    this._elementFactory = elementFactory;
    this._bpmnFactory = bpmnFactory;
    palette.registerProvider(this);
  }

  getPaletteEntries() {
    const out = {};
    const start = (entry) => (event) => {
      const businessObject = this._bpmnFactory.create(entry.type, { ...(entry.name ? { name: entry.name } : {}), ...entry.attrs });
      this._create.start(event, this._elementFactory.createShape({ type: entry.type, businessObject }));
    };
    for (const entry of listPaletteEntries()) {
      out['flowable-' + entry.id] = {
        group: entry.group,
        className: entry.icon,
        title: entry.title,
        action: { dragstart: start(entry), click: start(entry) },
      };
    }
    return out;
  }
}
FlowablePaletteProvider.$inject = ['palette', 'create', 'elementFactory', 'bpmnFactory'];

export default { __init__: ['flowablePalette'], flowablePalette: ['type', FlowablePaletteProvider] };
