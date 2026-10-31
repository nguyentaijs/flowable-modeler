import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import BpmnModdle from 'bpmn-moddle';
import { getGroups, registerProvider, listProviders, elementTypeName } from '../../src/core/panel.mjs';

const keys = (type) => getGroups(type).flatMap((g) => g.fields.map((f) => f.key));

test('service task: general, fields summary and schema-driven Flowable attributes', () => {
  const groups = getGroups('serviceTask');
  assert.deepEqual(groups.map((g) => g.id), ['general', 'dmn', 'fields', 'multiinstance', 'execution', 'flowable']);
  const k = keys('serviceTask');
  assert.ok(k.includes('flowable:delegateExpression') && k.includes('flowable:async') && k.includes('name'));
  assert.ok(!k.includes('flowable:asyncBefore'), 'Camunda-only attributes never appear');
  const type = getGroups('serviceTask').flatMap((g) => g.fields).find((f) => f.key === 'flowable:type');
  assert.equal(type.kind, 'enum');
  assert.ok(type.values.includes('dmn'));
});

test('script task and call activity get their dedicated groups', () => {
  assert.ok(getGroups('scriptTask').some((g) => g.id === 'script' && g.fields.some((f) => f.target === 'script')));
  assert.ok(keys('callActivity').includes('calledElement'));
  assert.ok(getGroups('sequenceFlow').some((g) => g.id === 'condition' && g.fields.some((f) => f.target === 'default-flow')));
});

test('elements outside the schema still get the general group', () => {
  assert.deepEqual(keys('textAnnotation'), ['id', 'name']);
  assert.deepEqual(keys('definitions'), ['id', 'name'], 'every element gets id and name');
  assert.equal(getGroups('association')[0].fields.find((f) => f.key === 'name').requiresProperty, 'name');
});

test('providers can be added, merged into existing groups and removed', () => {
  const off = registerProvider({
    id: 'tymex-conventions',
    order: 15,
    appliesTo: ['serviceTask'],
    groups: () => [{ id: 'general', title: 'General', fields: [{ key: 'flowable:extensionId', label: 'Extension id', kind: 'text' }] }],
  });
  const general = getGroups('serviceTask').find((g) => g.id === 'general');
  assert.ok(general.fields.some((f) => f.key === 'flowable:extensionId'));
  assert.ok(listProviders().some((p) => p.id === 'tymex-conventions'));
  off();
  assert.ok(!getGroups('serviceTask').find((g) => g.id === 'general').fields.some((f) => f.key === 'flowable:extensionId' && f.label === 'Extension id'));
  assert.throws(() => registerProvider({ id: 'general', groups: () => [] }), /already registered/);
  assert.throws(() => registerProvider({}), /needs an id/);
});

test('moddle element types map to schema names, so real elements get their dedicated groups', async () => {
  assert.equal(elementTypeName('bpmn:ScriptTask'), 'scriptTask');
  assert.equal(elementTypeName('bpmn:SequenceFlow'), 'sequenceFlow');
  const m = new BpmnModdle();
  const { rootElement } = await m.fromXML(fs.readFileSync(new URL('../../samples/sampleCoreProcess.bpmn', import.meta.url), 'utf8'));
  const process = rootElement.rootElements.find((e) => e.$type === 'bpmn:Process');
  for (const [moddleType, group] of [['bpmn:ScriptTask', 'script'], ['bpmn:ServiceTask', 'fields'], ['bpmn:SequenceFlow', 'condition']]) {
    const bo = process.flowElements.find((e) => e.$type === moddleType);
    assert.ok(getGroups(elementTypeName(bo.$type)).some((g) => g.id === group), moddleType);
  }
  const script = process.flowElements.find((e) => e.$type === 'bpmn:ScriptTask');
  assert.ok(script.script.length > 0, 'the script body is readable from the model');
});

test('sub process, ad-hoc sub process and transaction get their own groups', () => {
  assert.equal(elementTypeName('bpmn:AdHocSubProcess'), 'adHocSubProcess');
  assert.equal(elementTypeName('bpmn:Transaction'), 'transaction');
  const sub = getGroups('subProcess').flatMap((g) => g.fields.map((f) => f.key));
  assert.ok(sub.includes('id') && sub.includes('name') && sub.includes('triggeredByEvent') && sub.includes('isForCompensation'));
  assert.ok(sub.includes('flowable:async') && sub.includes('flowable:exclusive') && sub.includes('flowable:asyncLeave'), 'Flowable execution flags come from the schema');
  assert.ok(!sub.includes('ordering'));
  const adhoc = getGroups('adHocSubProcess').flatMap((g) => g.fields.map((f) => f.key));
  assert.ok(adhoc.includes('ordering') && adhoc.includes('cancelRemainingInstances'));
  assert.ok(getGroups('transaction').some((g) => g.id === 'subprocess'));
});
