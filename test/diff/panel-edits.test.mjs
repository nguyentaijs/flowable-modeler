import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import BpmnModdle from 'bpmn-moddle';
import { diffXml, applyEdits } from '../../src/core/differ.mjs';
import { validate } from '../../src/core/validators.mjs';

// The panel writes Flowable attributes with bo.set('flowable:x', value) (via modeling.updateProperties).
test('setting and clearing Flowable attributes edits one attribute and keeps the file valid', async () => {
  const src = fs.readFileSync(new URL('../../samples/sampleCoreProcess.bpmn', import.meta.url), 'utf8');
  const m = new BpmnModdle();
  const { rootElement } = await m.fromXML(src);
  const task = rootElement.rootElements.find((e) => e.$type === 'bpmn:Process').flowElements.find((e) => e.$type === 'bpmn:ServiceTask');

  task.set('flowable:async', 'true');
  let next = (await m.toXML(rootElement, { format: true })).xml;
  let out = applyEdits(src, diffXml(src, next));
  assert.equal(out.split('flowable:async="true"').length - 1, 1);
  assert.equal(out.length - src.length, ' flowable:async="true"'.length);
  assert.deepEqual(validate(out).filter((d) => d.severity !== 'information'), []);

  task.set('flowable:async', undefined);
  next = (await m.toXML(rootElement, { format: true })).xml;
  assert.equal(applyEdits(out, diffXml(out, next)), src, 'clearing restores the original bytes');

  task.set('flowable:type', 'nonsense');
  next = (await m.toXML(rootElement, { format: true })).xml;
  out = applyEdits(src, diffXml(src, next));
  assert.ok(validate(out).some((d) => d.severity === 'error' && /one of: camel/.test(d.message)), 'the validator catches the bad enum value');
});

test('marking a flow as default sets default="..." on the gateway only', async () => {
  const src = fs.readFileSync(new URL('../../samples/sampleMainProcess.bpmn', import.meta.url), 'utf8');
  const m = new BpmnModdle();
  const { rootElement } = await m.fromXML(src);
  const process = rootElement.rootElements.find((e) => e.$type === 'bpmn:Process');
  const gw = process.flowElements.find((e) => e.$type === 'bpmn:ExclusiveGateway' && e.default);
  const other = process.flowElements.find((e) => e.$type === 'bpmn:SequenceFlow' && e.sourceRef === gw && e !== gw.default);
  const before = gw.default;
  gw.default = other; // what the panel's "Default flow" checkbox does (via modeling.updateProperties on the source)
  const next = (await m.toXML(rootElement, { format: true })).xml;
  const out = applyEdits(src, diffXml(src, next));
  assert.ok(out.includes(`default="${other.id}"`) && !out.includes(`default="${before.id}"`));
  assert.equal(diffXml(src, next).length, 1, 'one attribute changes, on the gateway');
});

test('toggling "triggered by event" on a sub process changes one attribute', async () => {
  const src = '<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:flowable="http://flowable.org/bpmn">\n  <process id="p">\n    <subProcess id="sp" name="Sub">\n      <startEvent id="se"/>\n    </subProcess>\n  </process>\n</definitions>\n';
  const m = new BpmnModdle();
  const { rootElement } = await m.fromXML(src);
  const sp = rootElement.rootElements[0].flowElements[0];
  sp.set('triggeredByEvent', true);
  sp.set('flowable:async', 'true');
  const next = (await m.toXML(rootElement, { format: true })).xml;
  const out = applyEdits(src, diffXml(src, next));
  assert.ok(out.includes('<subProcess id="sp" name="Sub" triggeredByEvent="true" flowable:async="true">'));
  assert.deepEqual(validate(out), []);
  assert.ok(validate(out.replace('flowable:async="true"', 'flowable:async="x"')).some((d) => /async must be true or false/.test(d.message)), 'sub process attributes are now validated too');
});
