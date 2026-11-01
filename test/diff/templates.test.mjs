import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import BpmnModdle from 'bpmn-moddle';
import { newBpmn, newDmn, idFromFileName } from '../../src/core/templates.mjs';
import { validate } from '../../src/core/validators.mjs';
import { parseXml, rootElement } from '../../src/core/xml.mjs';
import * as dmn from '../../src/core/dmnModel.mjs';

const { DOMParser } = new JSDOM('').window;
const problems = (text, config = {}) => validate(text, { config }).filter((d) => d.severity !== 'information');

test('idFromFileName makes a valid id and a display name', () => {
  assert.deepEqual(idFromFileName('/w/order-flow.bpmn'), { id: 'order-flow', name: 'order-flow' });
  assert.deepEqual(idFromFileName('C:\\w\\a b.bpmn20.xml'), { id: 'a_b', name: 'a b' });
  assert.equal(idFromFileName('1x.dmn', 'decision').id, '_1x');
  assert.equal(idFromFileName('', 'decision').id, 'decision');
  assert.equal(idFromFileName('/w/.bpmn', 'process').id, 'process');
});

test('the BPMN template is the essential Flowable engine format', () => {
  const text = newBpmn('/w/orderFlow.bpmn');
  const root = rootElement(parseXml(text));
  const attrs = Object.fromEntries(root.attrs.map((a) => [a.name, a.value]));
  assert.equal(attrs.xmlns, 'http://www.omg.org/spec/BPMN/20100524/MODEL');
  assert.equal(attrs['xmlns:flowable'], 'http://flowable.org/bpmn');
  assert.equal(attrs['xmlns:bpmndi'], 'http://www.omg.org/spec/BPMN/20100524/DI');
  assert.equal(attrs['xmlns:omgdc'], 'http://www.omg.org/spec/DD/20100524/DC');
  assert.equal(attrs['xmlns:omgdi'], 'http://www.omg.org/spec/DD/20100524/DI');
  assert.equal(attrs.targetNamespace, 'http://www.flowable.org/test');
  for (const absent of ['exporter', 'typeLanguage', 'expressionLanguage', 'xmlns:design', 'xmlns:xsi']) assert.equal(absent in attrs, false, absent);
  assert.match(text, /<process id="orderFlow" name="orderFlow" isExecutable="true">/);
  assert.match(text, /<startEvent id="startEvent1">/);
  assert.deepEqual(problems(text), []);
});

test('the DMN template is the essential Flowable engine format', () => {
  const text = newDmn('/w/tierAssignment.dmn');
  const root = rootElement(parseXml(text));
  const attrs = Object.fromEntries(root.attrs.map((a) => [a.name, a.value]));
  assert.equal(attrs.xmlns, 'https://www.omg.org/spec/DMN/20191111/MODEL/');
  assert.equal(attrs['xmlns:flowable'], 'http://flowable.org/dmn');
  assert.equal(attrs.namespace, 'http://www.flowable.org/dmn');
  assert.equal(attrs.id, 'definition_tierAssignment');
  const doc = dmn.parseDmn(text, DOMParser);
  const [decision] = dmn.decisions(doc);
  assert.equal(decision.getAttribute('id'), 'tierAssignment');
  const table = dmn.decisionTable(decision);
  assert.equal(table.getAttribute('hitPolicy'), 'FIRST');
  assert.equal(dmn.inputs(table).length, 1);
  assert.equal(dmn.outputs(table).length, 1);
  assert.deepEqual(problems(text), []);
});

test('flowable: attributes survive in a model started from the BPMN template', async () => {
  const moddle = new BpmnModdle();
  const { rootElement: definitions } = await moddle.fromXML(newBpmn('/w/p.bpmn'));
  const process = definitions.rootElements[0];
  const task = moddle.create('bpmn:ServiceTask', { id: 'Task_1', 'flowable:class': 'com.acme.Do' });
  process.flowElements.push(task);
  const { xml } = await moddle.toXML(definitions, { format: true });
  assert.match(xml, /<serviceTask id="Task_1" flowable:class="com.acme.Do"/);
});
