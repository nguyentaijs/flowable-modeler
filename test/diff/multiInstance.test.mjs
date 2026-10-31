import test from 'node:test';
import assert from 'node:assert/strict';
import BpmnModdle from 'bpmn-moddle';
import { readMultiInstance, updateMultiInstance } from '../../src/core/multiInstance.mjs';
import { getGroups } from '../../src/core/panel.mjs';
import { diffXml, applyEdits } from '../../src/core/differ.mjs';
import { validate } from '../../src/core/validators.mjs';
import { elementSchema } from '../../src/core/schema.mjs';

const SRC = '<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:flowable="http://flowable.org/bpmn">\n  <process id="p">\n    <subProcess id="sp" name="Loop">\n      <startEvent id="se"/>\n    </subProcess>\n    <serviceTask id="t" flowable:class="x.Y"/>\n  </process>\n</definitions>\n';

async function setup() {
  const m = new BpmnModdle();
  const { rootElement } = await m.fromXML(SRC);
  const [sp, task] = rootElement.rootElements[0].flowElements;
  const set = (target, props) => Object.entries(props).forEach(([k, v]) => target.set(k, v));
  const write = async () => {
    const next = (await m.toXML(rootElement, { format: true })).xml;
    const out = applyEdits(SRC, diffXml(SRC, next));
    return out;
  };
  return { m, sp, task, set, write };
}

test('multi-instance is offered for every activity type, and is in the schema', () => {
  for (const t of ['subProcess', 'adHocSubProcess', 'transaction', 'serviceTask', 'scriptTask', 'userTask', 'callActivity', 'businessRuleTask']) {
    assert.ok(getGroups(t).some((g) => g.id === 'multiinstance'), t);
  }
  assert.ok(!getGroups('exclusiveGateway').some((g) => g.id === 'multiinstance'));
  assert.ok(elementSchema('multiInstanceLoopCharacteristics').attributes.some((a) => a.name === 'collection' && a.ns === 'flowable'));
});

test('parallel loop on a sub process: collection and element variable', async () => {
  const { m, sp, set, write } = await setup();
  assert.equal(readMultiInstance(sp).mode, 'none');
  updateMultiInstance(m, sp, set, { mode: 'parallel' });
  updateMultiInstance(m, sp, set, { key: 'collection', value: '${customers}' });
  updateMultiInstance(m, sp, set, { key: 'elementVariable', value: 'customer' });
  const out = await write();
  assert.match(out, /<multiInstanceLoopCharacteristics flowable:collection="\$\{customers\}" flowable:elementVariable="customer" ?\/?>|<multiInstanceLoopCharacteristics[^>]*flowable:collection/);
  assert.ok(!out.includes('isSequential'), 'parallel is the default, so nothing is written for it');
  assert.deepEqual(readMultiInstance(sp), { mode: 'parallel', values: { collection: '${customers}', elementVariable: 'customer', elementIndexVariable: '', loopCardinality: '', completionCondition: '' } });
  assert.deepEqual(validate(out), []);
});

test('sequential loop with cardinality and completion condition written as CDATA', async () => {
  const { m, sp, set, write } = await setup();
  updateMultiInstance(m, sp, set, { mode: 'sequential' });
  updateMultiInstance(m, sp, set, { key: 'loopCardinality', value: '${n < 5}' });
  updateMultiInstance(m, sp, set, { key: 'completionCondition', value: '${nrOfCompletedInstances >= 2 && ok}' });
  const out = await write();
  assert.ok(out.includes('isSequential="true"'));
  assert.ok(out.includes('<loopCardinality><![CDATA[${n < 5}]]></loopCardinality>'));
  assert.ok(out.includes('<completionCondition><![CDATA[${nrOfCompletedInstances >= 2 && ok}]]></completionCondition>'));
  assert.ok(!out.includes('xsi:type'), 'plain expressions, no xsi:type needed');
  assert.deepEqual(validate(out), []);
});

test('switching parallel <-> sequential and removing the loop', async () => {
  const { m, task, set, write } = await setup();
  updateMultiInstance(m, task, set, { mode: 'sequential' });
  assert.equal(readMultiInstance(task).mode, 'sequential');
  updateMultiInstance(m, task, set, { mode: 'parallel' });
  assert.equal(readMultiInstance(task).mode, 'parallel');
  updateMultiInstance(m, task, set, { key: 'elementVariable', value: 'x' });
  updateMultiInstance(m, task, set, { key: 'elementVariable', value: '' });
  assert.equal(readMultiInstance(task).values.elementVariable, '');
  updateMultiInstance(m, task, set, { mode: 'none' });
  assert.equal(await write(), SRC, 'removing the loop restores the original bytes');
});

test('setting a value before choosing a mode creates a parallel loop; unknown keys are rejected', async () => {
  const { m, task, set } = await setup();
  updateMultiInstance(m, task, set, { key: 'collection', value: '${a}' });
  assert.equal(readMultiInstance(task).mode, 'parallel');
  assert.throws(() => updateMultiInstance(m, task, set, { key: 'bogus', value: '1' }), /Unknown multi-instance property/);
});

test('invalid loop attributes are reported by the validators', async () => {
  const { m, sp, set, write } = await setup();
  updateMultiInstance(m, sp, set, { mode: 'parallel' });
  sp.loopCharacteristics.set('flowable:noWaitStatesAsyncLeave', 'maybe');
  const out = await write();
  assert.ok(validate(out).some((d) => /noWaitStatesAsyncLeave must be true or false/.test(d.message)));
});
