import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { validate, registerValidator, listValidators } from '../../src/core/validators.mjs';
import { getSchema, elementSchema, attributeSpec, extendSchema } from '../../src/core/schema.mjs';
import { checkJuelSyntax } from '../../src/core/juel.mjs';

const NS = 'xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:flowable="http://flowable.org/bpmn" xmlns:design="http://flowable.org/design" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"';
const doc = (inner) => `<definitions ${NS}><process id="p">${inner}</process></definitions>`;
const run = (inner, opts) => validate(doc(inner), opts);
const names = (ds) => ds.map((d) => d.validator);

test('schema is generated from the Flowable 7.2.0 sources', () => {
  const s = getSchema();
  assert.equal(s.version, '7.2.0');
  assert.ok(attributeSpec('serviceTask', 'flowable', 'delegateExpression'));
  assert.deepEqual(attributeSpec('serviceTask', 'flowable', 'type').values.includes('dmn'), true);
  assert.equal(attributeSpec('serviceTask', 'flowable', 'asyncBefore'), null, 'asyncBefore is Camunda-only in 7.2.0');
  assert.ok(elementSchema('flowable:serviceTask') || elementSchema('serviceTask'));
});

test('the fixtures have no errors or warnings, only "ignored by the engine" notes', () => {
  for (const f of ['sampleMainProcess.bpmn', 'sampleCoreProcess.bpmn']) {
    const ds = validate(fs.readFileSync(new URL('../../samples/' + f, import.meta.url), 'utf8'));
    assert.deepEqual(ds.filter((d) => d.severity !== 'information'), [], f);
    assert.ok(ds.length > 0 && ds.every((d) => d.validator.startsWith('flowable-')), 'expected Work-only extras to be reported');
  }
});

test('unique-ids, sequence-flow-refs', () => {
  const ds = run('<startEvent id="a"/><endEvent id="a"/><sequenceFlow id="f" sourceRef="a" targetRef="nope"/>');
  assert.ok(names(ds).includes('unique-ids'));
  assert.ok(ds.some((d) => d.validator === 'sequence-flow-refs' && /nope/.test(d.message)));
});

test('gateway-flows: conditions and default', () => {
  const ds = run('<exclusiveGateway id="g" default="f1"/><sequenceFlow id="f1" sourceRef="g" targetRef="g"/><sequenceFlow id="f2" sourceRef="g" targetRef="g"/>');
  assert.ok(ds.some((d) => d.validator === 'gateway-flows' && /f2/.test(d.message)));
  const bad = run('<exclusiveGateway id="g" default="zzz"/>');
  assert.ok(bad.some((d) => d.severity === 'error' && /not an outgoing flow/.test(d.message)));
});

test('required-fields', () => {
  assert.ok(run('<callActivity id="c"/>').some((d) => /calledElement/.test(d.message)));
  assert.ok(!run('<scriptTask id="s"/>').some((d) => /scriptFormat/.test(d.message)), 'scriptFormat is optional');
  assert.ok(run('<scriptTask id="s"/>').some((d) => /no <script> body/.test(d.message)));
  assert.ok(run('<serviceTask id="t" flowable:type="dmn"/>').some((d) => /decisionTableReferenceKey/.test(d.message)));
  assert.equal(run('<serviceTask id="t" flowable:type="dmn"><extensionElements><flowable:field name="decisionTableReferenceKey"><flowable:string>k</flowable:string></flowable:field></extensionElements></serviceTask>').length, 0);
});

test('flowable-attributes: unknown, boolean and enum values; design: is passed through', () => {
  const ds = run('<serviceTask id="t" flowable:bogus="1" flowable:async="maybe" flowable:type="zzz" design:thing="x" flowable:class="${x"/>');
  assert.ok(ds.some((d) => /bogus/.test(d.message) && d.severity === 'information'));
  assert.ok(ds.some((d) => /async must be true or false/.test(d.message)));
  assert.ok(ds.some((d) => /one of: camel/.test(d.message)));
  assert.ok(!ds.some((d) => /design/.test(d.message)));
});

test('juel-syntax', () => {
  assert.deepEqual(checkJuelSyntax("${a == 'x' && b.c(1, [2])}"), []);
  assert.equal(checkJuelSyntax('${a == 1').length, 1);
  assert.equal(checkJuelSyntax("${a == 'x}").length, 1);
  assert.equal(checkJuelSyntax('${f(1))}').length, 1);
  const ds = run('<exclusiveGateway id="g"/><sequenceFlow id="f" sourceRef="g" targetRef="g"><conditionExpression xsi:type="tFormalExpression"><![CDATA[${a ==]]></conditionExpression></sequenceFlow>');
  assert.ok(ds.some((d) => d.validator === 'juel-syntax'));
  const padded = run('<sequenceFlow id="f" sourceRef="f" targetRef="f"><conditionExpression>\n  <![CDATA[${a ==]]>\n</conditionExpression></sequenceFlow>');
  assert.ok(padded.some((d) => d.validator === 'juel-syntax'), 'whitespace around the CDATA does not hide the expression');
  const loop = run('<task id="t"><multiInstanceLoopCharacteristics><loopCardinality>${n</loopCardinality></multiInstanceLoopCharacteristics></task>');
  assert.ok(loop.some((d) => d.validator === 'juel-syntax'), 'other expression elements are checked too');
});

test('validators can be disabled, registered and removed', () => {
  assert.ok(listValidators().some((v) => v.name === 'unique-ids'));
  assert.equal(names(run('<startEvent id="a"/><endEvent id="a"/>', { disabled: ['unique-ids'] })).includes('unique-ids'), false);
  const off = registerValidator({ name: 'no-start-events', appliesTo: ['startEvent'], check: () => [{ message: 'no start events allowed' }] });
  assert.ok(run('<startEvent id="a"/>').some((d) => d.validator === 'no-start-events'));
  off();
  assert.ok(!run('<startEvent id="a"/>').some((d) => d.validator === 'no-start-events'));
  assert.throws(() => registerValidator({ name: 'x' }), /needs a name/);
});

test('the schema can be extended without touching code', () => {
  extendSchema({ elements: { boundaryEvent: { attributes: [{ name: 'fake', ns: 'flowable', type: 'boolean' }] } } });
  assert.ok(attributeSpec('boundaryEvent', 'flowable', 'fake'));
  assert.ok(run('<boundaryEvent id="b" flowable:fake="nope"/>').some((d) => /fake must be true or false/.test(d.message)));
});

test('malformed XML yields one error', () => {
  const ds = validate('<definitions><process></definitions>');
  assert.equal(ds.length, 1);
  assert.equal(ds[0].severity, 'error');
});
