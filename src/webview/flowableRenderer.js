import BaseRenderer from 'diagram-js/lib/draw/BaseRenderer';
import { isDmnTask } from '../core/dmnTask.mjs';

// Display only: a service task with flowable:type="dmn" is drawn like a business rule task. The XML is untouched.
export class FlowableRenderer extends BaseRenderer {
  constructor(eventBus, bpmnRenderer) {
    super(eventBus, 1500);
    this._bpmnRenderer = bpmnRenderer;
  }

  canRender(element) {
    return isDmnTask(element.businessObject);
  }

  drawShape(parentGfx, element) {
    return this._bpmnRenderer.handlers['bpmn:BusinessRuleTask'](parentGfx, element);
  }
}
FlowableRenderer.$inject = ['eventBus', 'bpmnRenderer'];

export default { __init__: ['flowableRenderer'], flowableRenderer: ['type', FlowableRenderer] };
