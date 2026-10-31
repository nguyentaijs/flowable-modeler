import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import BpmnModdle from 'bpmn-moddle';
import { diffXml, applyEdits } from '../../src/core/differ.mjs';
import { parseXml, canon, rootElement } from '../../src/core/xml.mjs';

const FIXTURES = ['sampleMainProcess.bpmn', 'sampleCoreProcess.bpmn'];
const load = (f) => fs.readFileSync(new URL('../../samples/' + f, import.meta.url), 'utf8');
const lines = (s) => s.split(/\r?\n/);
const changedLines = (a, b) => {
  const set = new Map();
  for (const l of lines(a)) set.set(l, (set.get(l) || 0) + 1);
  let n = 0;
  for (const l of lines(b)) {
    if (set.get(l)) set.set(l, set.get(l) - 1);
    else n++;
  }
  return n;
};

async function open(f) {
  const src = load(f);
  const m = new BpmnModdle();
  const { rootElement: defs } = await m.fromXML(src);
  const process = defs.rootElements.find((e) => e.$type === 'bpmn:Process');
  const plane = defs.diagrams[0].plane;
  const toXml = async () => (await m.toXML(defs, { format: true })).xml;
  return { src, m, defs, process, plane, toXml };
}

// The patched text must parse and be canonically equal to what the modeler exported.
function check(src, next) {
  const edits = diffXml(src, next);
  const out = applyEdits(src, edits);
  assert.equal(canon(rootElement(parseXml(out))), canon(rootElement(parseXml(next))), 'patched text differs from modeler output');
  return { edits, out };
}

for (const f of FIXTURES) {
  test(`${f}: no edit produces no changes`, async () => {
    const { src, toXml } = await open(f);
    const { edits, out } = check(src, await toXml());
    assert.equal(edits.length, 0);
    assert.equal(out, src);
  });

  test(`${f}: rename touches only one attribute`, async () => {
    const { src, process, toXml } = await open(f);
    const task = process.flowElements.find((e) => e.$type === 'bpmn:ScriptTask');
    task.name = 'Renamed & <task>';
    const { edits, out } = check(src, await toXml());
    assert.equal(edits.length, 1);
    assert.equal(changedLines(src, out), 1);
  });

  test(`${f}: move shape changes only its bounds`, async () => {
    const { src, plane, toXml } = await open(f);
    const shape = plane.planeElement.find((e) => e.$type === 'bpmndi:BPMNShape');
    shape.bounds.x += 10;
    const { edits, out } = check(src, await toXml());
    assert.equal(edits.length, 1);
    assert.equal(changedLines(src, out), 1);
  });

  test(`${f}: script edit patches CDATA only`, async () => {
    const { src, process, toXml } = await open(f);
    const task = process.flowElements.find((e) => e.$type === 'bpmn:ScriptTask');
    task.script = '\nprintln "a < b ]]> c"\n';
    const { out } = check(src, await toXml());
    assert.ok(out.includes('<![CDATA['), 'CDATA kept');
    assert.ok(changedLines(src, out) < 120);
  });

  test(`${f}: reordered DI elements (as bpmn-js does on move) cause no spurious edits`, async () => {
    const { src, plane, toXml } = await open(f);
    const shape = plane.planeElement.find((e) => e.$type === 'bpmndi:BPMNShape');
    plane.planeElement = plane.planeElement.filter((e) => e !== shape).concat(shape); // moved to the end
    const { edits } = check(src, await toXml());
    assert.equal(edits.length, 0);
    shape.bounds.x += 5;
    const second = check(src, await toXml());
    assert.equal(second.edits.length, 1);
    assert.equal(changedLines(src, second.out), 1);
  });

  test(`${f}: rename adds no empty BPMNLabel`, async () => {
    const { src, m, process, plane, toXml } = await open(f);
    const task = process.flowElements.find((e) => e.$type === 'bpmn:ScriptTask');
    task.name = 'Renamed';
    const shape = plane.planeElement.find((e) => e.bpmnElement === task);
    shape.label = m.create('bpmndi:BPMNLabel'); // what bpmn-js does when a label is edited
    const { edits, out } = check(src, await toXml());
    assert.equal(edits.length, 1);
    assert.ok(!out.includes('BPMNLabel') || out.split('BPMNLabel').length === src.split('BPMNLabel').length);
    assert.equal(changedLines(src, out), 1);
  });

  test(`${f}: new shape is written without an empty BPMNLabel`, async () => {
    const { src, m, process, plane, toXml } = await open(f);
    const task = m.create('bpmn:ServiceTask', { id: 'ServiceTask_lbl', name: 'Lbl' });
    process.flowElements.push(task);
    const bounds = m.create('dc:Bounds', { x: 1, y: 2, width: 100, height: 80 });
    plane.planeElement.push(m.create('bpmndi:BPMNShape', { id: 'ServiceTask_lbl_di', bpmnElement: task, bounds, label: m.create('bpmndi:BPMNLabel') }));
    const { out } = check(src, await toXml());
    assert.ok(out.includes('ServiceTask_lbl_di'));
    assert.equal(out.split('BPMNLabel').length, src.split('BPMNLabel').length);
  });

  test(`${f}: delete a flow and its edge`, async () => {
    const { src, process, plane, toXml } = await open(f);
    const flow = process.flowElements.find((e) => e.$type === 'bpmn:SequenceFlow');
    process.flowElements = process.flowElements.filter((e) => e !== flow);
    plane.planeElement = plane.planeElement.filter((e) => e.bpmnElement !== flow);
    const { out } = check(src, await toXml());
    assert.ok(!out.includes(`id="${flow.id}"`));
    assert.ok(changedLines(src, out) <= 12, 'changed lines ' + changedLines(src, out));
  });

  test(`${f}: add a task with its shape`, async () => {
    const { src, m, process, plane, toXml } = await open(f);
    const task = m.create('bpmn:ServiceTask', { id: 'ServiceTask_new', name: 'New task' });
    process.flowElements.push(task);
    const bounds = m.create('dc:Bounds', { x: 10, y: 10, width: 100, height: 80 });
    plane.planeElement.push(m.create('bpmndi:BPMNShape', { id: 'ServiceTask_new_di', bpmnElement: task, bounds }));
    const { out } = check(src, await toXml());
    assert.ok(out.includes('id="ServiceTask_new"'));
    assert.ok(changedLines(src, out) <= 12, 'changed lines ' + changedLines(src, out));
  });
}

for (const f of FIXTURES) {
  test(`${f}: reconnecting a flow writes no <incoming>/<outgoing>`, async () => {
    const { src, m, process, toXml } = await open(f);
    const flows = process.flowElements.filter((e) => e.$type === 'bpmn:SequenceFlow');
    const flow = flows[0];
    const target = process.flowElements.find((e) => e.$type === 'bpmn:ScriptTask' && e !== flow.targetRef);
    // what bpmn-js does when a flow's target changes: updates targetRef and the derived incoming/outgoing lists
    flow.targetRef = target;
    target.get('incoming').push(flow);
    flow.sourceRef.get('outgoing').push(flow);
    const { edits, out } = check(src, await toXml());
    assert.equal(edits.length, 1, 'only targetRef changes');
    assert.ok(!/<(bpmn:)?(incoming|outgoing)>/.test(out));
    assert.equal(changedLines(src, out), 1);
  });
}

for (const f of FIXTURES) {
  test(`${f}: add a gateway wired into the flow (incoming/outgoing on new and existing nodes)`, async () => {
    const { src, m, process, plane, toXml } = await open(f);
    const tasks = process.flowElements.filter((e) => e.$instanceOf('bpmn:Task'));
    const [a, b] = tasks;
    const gw = m.create('bpmn:ExclusiveGateway', { id: 'Gateway_new' });
    process.flowElements.push(gw);
    const wire = (id, from, to) => {
      const flow = m.create('bpmn:SequenceFlow', { id, sourceRef: from, targetRef: to });
      process.flowElements.push(flow);
      from.get('outgoing').push(flow);
      to.get('incoming').push(flow);
      plane.planeElement.push(m.create('bpmndi:BPMNEdge', { id: id + '_di', bpmnElement: flow, waypoint: [m.create('dc:Point', { x: 1, y: 2 }), m.create('dc:Point', { x: 3, y: 4 })] }));
    };
    wire('Flow_to_new', a, gw);
    wire('Flow_from_new', gw, b);
    plane.planeElement.push(m.create('bpmndi:BPMNShape', { id: 'Gateway_new_di', bpmnElement: gw, bounds: m.create('dc:Bounds', { x: 5, y: 6, width: 50, height: 50 }), label: m.create('bpmndi:BPMNLabel') }));
    const { out } = check(src, await toXml());
    assert.ok(out.includes('id="Gateway_new"') && out.includes('id="Flow_from_new"'));
    assert.ok(!/<(bpmn:)?(incoming|outgoing)>/.test(out));
    assert.ok(!out.includes('BPMNLabel') || out.split('BPMNLabel').length === src.split('BPMNLabel').length);
  });
}

for (const f of FIXTURES) {
  test(`${f}: new scripts and conditions are written as CDATA, like the existing ones`, async () => {
    const { src, m, process, plane, toXml } = await open(f);
    const task = m.create('bpmn:ScriptTask', { id: 'ScriptTask_cd', name: 'cd', scriptFormat: 'groovy', script: 'if (a < b && c > 1) { println "x" }' });
    process.flowElements.push(task);
    const from = process.flowElements.find((e) => e.$type === 'bpmn:ExclusiveGateway') ?? process.flowElements.find((e) => e.$type === 'bpmn:ScriptTask');
    const flow = m.create('bpmn:SequenceFlow', { id: 'Flow_cd', sourceRef: from, targetRef: task, conditionExpression: m.create('bpmn:FormalExpression', { body: "${a < 1 && b == 'x'}" }) });
    process.flowElements.push(flow);
    plane.planeElement.push(m.create('bpmndi:BPMNShape', { id: 'ScriptTask_cd_di', bpmnElement: task, bounds: m.create('dc:Bounds', { x: 1, y: 1, width: 100, height: 80 }) }));
    const { out } = check(src, await toXml());
    assert.ok(out.includes('<![CDATA[if (a < b && c > 1) { println "x" }]]>'));
    assert.ok(out.includes("<![CDATA[${a < 1 && b == 'x'}]]>"));
    assert.ok(!out.includes('&amp;&amp;') || src.includes('&amp;&amp;'), 'no escaped && introduced');
  });
}

test('editing a script that was written without CDATA writes it as CDATA', async () => {
  const src = '<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL">\n  <process id="p">\n    <scriptTask id="s" scriptFormat="groovy">\n      <script>old</script>\n    </scriptTask>\n  </process>\n</definitions>\n';
  const m = new BpmnModdle();
  const { rootElement } = await m.fromXML(src);
  rootElement.rootElements[0].flowElements[0].script = 'a < b';
  const { out } = check(src, (await m.toXML(rootElement, { format: true })).xml);
  assert.ok(out.includes('<script><![CDATA[a < b]]></script>'));
});

test('an ignored spec-default attribute that gets a real value is updated, not duplicated', () => {
  const o = '<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL" typeLanguage="http://www.w3.org/2001/XMLSchema" targetNamespace="t"></definitions>';
  const n = '<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL" typeLanguage="urn:other" targetNamespace="t"></definitions>';
  const out = applyEdits(o, diffXml(o, n));
  assert.equal(out.split('typeLanguage').length - 1, 1);
  assert.ok(out.includes('typeLanguage="urn:other"'));
});
