// Starting content for an empty .bpmn or .dmn file. Only what the Flowable engine needs to read and run the model, what
// the editors need to write `flowable:` attributes, and what Flowable Design needs to open it. Namespaces are the
// constants of Flowable's own converters (BpmnXMLConstants, DmnXMLConstants). No exporter, `design:*`, typeLanguage or
// expressionLanguage (the engine fills those defaults in; Flowable Design adds its own metadata when it saves).

const escapeAttr = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

// A file path or name -> a valid XML id and a display name. `fallback` is used when nothing usable is left.
export function idFromFileName(path, fallback = 'process') {
  const base = String(path ?? '').split(/[\\/]/).pop().replace(/\.(bpmn20\.xml|bpmn|dmn\.xml|dmn|xml)$/i, '');
  let id = base.replace(/[^A-Za-z0-9_.-]+/g, '_').replace(/^_+|_+$/g, '');
  if (!id) id = fallback;
  if (!/^[A-Za-z_]/.test(id)) id = '_' + id;
  return { id, name: base || id };
}

export function newBpmn(path) {
  const { id, name } = idFromFileName(path, 'process');
  const process = escapeAttr(id);
  return `<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:flowable="http://flowable.org/bpmn" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:omgdc="http://www.omg.org/spec/DD/20100524/DC" xmlns:omgdi="http://www.omg.org/spec/DD/20100524/DI" targetNamespace="http://www.flowable.org/test">
  <process id="${process}" name="${escapeAttr(name)}" isExecutable="true">
    <startEvent id="startEvent1"></startEvent>
  </process>
  <bpmndi:BPMNDiagram id="BPMNDiagram_${process}">
    <bpmndi:BPMNPlane id="BPMNPlane_${process}" bpmnElement="${process}">
      <bpmndi:BPMNShape id="BPMNShape_startEvent1" bpmnElement="startEvent1">
        <omgdc:Bounds height="30.0" width="30.0" x="100.0" y="163.0"></omgdc:Bounds>
      </bpmndi:BPMNShape>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</definitions>
`;
}

export function newDmn(path) {
  const { id, name } = idFromFileName(path, 'decision');
  const key = escapeAttr(id);
  return `<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="https://www.omg.org/spec/DMN/20191111/MODEL/" xmlns:flowable="http://flowable.org/dmn" id="definition_${key}" name="${escapeAttr(name)}" namespace="http://www.flowable.org/dmn">
  <decision id="${key}" name="${escapeAttr(name)}">
    <decisionTable id="decisionTable_${key}" hitPolicy="FIRST">
      <input label="input1">
        <inputExpression id="inputExpression_1" typeRef="string">
          <text>input1</text>
        </inputExpression>
      </input>
      <output id="outputExpression_2" label="output1" name="output1" typeRef="string"></output>
    </decisionTable>
  </decision>
</definitions>
`;
}
