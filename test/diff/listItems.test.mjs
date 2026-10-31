import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import BpmnModdle from 'bpmn-moddle';
import { readRow, emptyRow, replaceItems } from '../../src/core/listItems.mjs';
import { getGroups, validateField } from '../../src/core/panel.mjs';
import { diffXml, applyEdits } from '../../src/core/differ.mjs';
import { parseXml, canon, rootElement } from '../../src/core/xml.mjs';

const FIELD = getGroups('serviceTask').find((g) => g.id === 'fields').fields[0].item;
const PARAM = getGroups('callActivity').find((g) => g.id === 'called').fields.find((f) => f.key === 'in').item;

async function open() {
  const src = fs.readFileSync(new URL('../data/serviceTaskFields.bpmn', import.meta.url), 'utf8');
  const m = new BpmnModdle();
  const { rootElement: defs } = await m.fromXML(src);
  const process = defs.rootElements.find((e) => e.$type === 'bpmn:Process');
  const task = process.flowElements.find((e) => e.$type === 'bpmn:ServiceTask' && e.extensionElements?.values.filter((v) => v.$type === 'flowable:field').length >= 3 && e.extensionElements.values.some((v) => v.$type === 'flowable:field' && v.$children?.some((c) => c.$type === 'flowable:expression')));
  const ee = task.extensionElements;
  const rows = () => ee.values.filter((v) => v.$type === 'flowable:field').map((v) => readRow(v, FIELD));
  const apply = (next) => {
    ee.values = replaceItems(m, ee.values, FIELD, next);
  };
  const write = async () => {
    const xml = (await m.toXML(defs, { format: true })).xml;
    const edits = diffXml(src, xml);
    const out = applyEdits(src, edits);
    assert.equal(canon(rootElement(parseXml(out))), canon(rootElement(parseXml(xml))), 'patched text matches the modeler output');
    return { out, edits };
  };
  const changed = (out) => out.split('\n').filter((l, i, a) => !src.split('\n').includes(l)).length;
  return { src, m, rows, apply, write, changed };
}

test('rows are read with key, value and value type (the key is no longer undefined)', async () => {
  const { rows } = await open();
  const r = rows();
  assert.ok(r.length >= 3);
  assert.ok(r.every((x) => typeof x.name === 'string' && x.name.length > 0));
  assert.deepEqual(r.map((x) => x.valueType).filter((t) => t === 'expression').length > 0, true);
  assert.deepEqual(emptyRow(FIELD), { name: '', value: '', valueType: 'string' });
});

test('unchanged rows produce no edits', async () => {
  const { rows, apply, write } = await open();
  apply(rows());
  assert.equal((await write()).edits.length, 0);
});

test('edit a key and a value: only those lines change, CDATA is kept', async () => {
  const { rows, apply, write, changed } = await open();
  const r = rows();
  r[1].name = 'renamedKey';
  r[1].value = '${applicationData.other < 1}';
  apply(r);
  const { out } = await write();
  assert.ok(out.includes('name="renamedKey"') && out.includes('<![CDATA[${applicationData.other < 1}]]>'));
  assert.equal(changed(out), 2);
});

test('change a value type from expression to string', async () => {
  const { rows, apply, write } = await open();
  const r = rows();
  const i = r.findIndex((x) => x.valueType === 'expression');
  r[i].valueType = 'string';
  apply(r);
  const { out } = await write();
  assert.ok(out.includes('<flowable:string><![CDATA[' + r[i].value + ']]></flowable:string>'));
});

test('remove the first field: exactly that element disappears', async () => {
  const { rows, apply, write, src } = await open();
  const r = rows();
  const first = r.shift();
  apply(r);
  const { out } = await write();
  assert.ok(!out.includes(`<flowable:field name="${first.name}">`));
  assert.equal(src.split('\n').length - out.split('\n').length, 3, 'three lines (open tag, value, close tag) removed');
  assert.equal(out.split('\n').filter((l) => !src.split('\n').includes(l)).length, 0, 'nothing else changed');
});

test('add a field: it lands after the last field, before design:* elements', async () => {
  const { rows, apply, write } = await open();
  const r = rows();
  r.push({ name: 'newKey', value: '${a && b}', valueType: 'expression' });
  apply(r);
  const { out } = await write();
  const at = out.indexOf('name="newKey"');
  assert.ok(at > 0);
  assert.ok(out.slice(at, at + 400).includes('<![CDATA[${a && b}]]>'));
  assert.ok(out.slice(at).indexOf('<flowable:field') < out.slice(at).indexOf('<design:stencilid'), 'inserted among the fields');
});

test('call activity in/out parameters use attribute rows', async () => {
  const src = fs.readFileSync(new URL('../../samples/sampleMainProcess.bpmn', import.meta.url), 'utf8');
  const m = new BpmnModdle();
  const { rootElement: defs } = await m.fromXML(src);
  const call = defs.rootElements.find((e) => e.$type === 'bpmn:Process').flowElements.find((e) => e.$type === 'bpmn:CallActivity' && e.extensionElements?.values.some((v) => v.$type === 'flowable:in'));
  const rows = call.extensionElements.values.filter((v) => v.$type === 'flowable:in').map((v) => readRow(v, PARAM));
  assert.ok(rows.length > 0 && rows.every((r) => r.target));
  const before = rows.length;
  call.extensionElements.values = replaceItems(m, call.extensionElements.values, PARAM, [...rows, { source: 'x', sourceExpression: '', target: 'y' }]);
  const xml = (await m.toXML(defs, { format: true })).xml;
  const out = applyEdits(src, diffXml(src, xml));
  assert.equal(out.split('<flowable:in ').length - src.split('<flowable:in ').length, 1);
  assert.equal(before + 1, call.extensionElements.values.filter((v) => v.$type === 'flowable:in').length);
});

test('id validation accepts normal ids and rejects bad or taken ones', () => {
  assert.equal(validateField('id', 'Gateway_1eqwr7h'), '');
  assert.equal(validateField('id', 'ScriptTask_Bau.step-2'), '');
  assert.match(validateField('id', '1abc'), /must start/);
  assert.match(validateField('id', 'has space'), /must start/);
  assert.match(validateField('id', 'taken', { isIdTaken: (v) => v === 'taken' }), /already used/);
});

test('in/out parameter: source and sourceExpression are one choice; extras are preserved', async () => {
  const m = new BpmnModdle();
  const ns = 'http://flowable.org/bpmn';
  const both = m.createAny('flowable:in', ns, { source: 'a', sourceExpression: '${b}', target: 't', transient: 'true' });
  const only = m.createAny('flowable:in', ns, { source: 'v', target: 't2' });
  const r1 = readRow(both, PARAM);
  assert.equal(r1.srcType, 'sourceExpression', 'the expression wins, as in the engine');
  assert.equal(r1.src, '${b}');
  assert.deepEqual(r1.__extra, { transient: 'true' });
  assert.equal(readRow(only, PARAM).srcType, 'source');

  assert.equal(replaceItems(m, [], PARAM, [r1])[0], both, 'an untouched row is reused as is');
  const rebuilt = replaceItems(m, [], PARAM, [{ ...r1 }, readRow(only, PARAM)]); // a copy has no source link, so it is rebuilt
  assert.equal(rebuilt[0].sourceExpression, '${b}');
  assert.equal(rebuilt[0].source, undefined, 'only the chosen attribute is written');
  assert.equal(rebuilt[0].transient, 'true', 'unknown attributes survive a rewrite');
  assert.equal(rebuilt[1].source, 'v');

  // switching the choice moves the value to the other attribute
  const switched = replaceItems(m, [], PARAM, [{ ...readRow(only, PARAM), srcType: 'sourceExpression' }])[0];
  assert.equal(switched.sourceExpression, 'v');
  assert.equal(switched.source, undefined);
  assert.deepEqual(emptyRow(PARAM), { src: '', srcType: 'source', target: '' });
});

test('editing one row leaves untouched rows byte-identical (stringValue attribute stays an attribute)', async () => {
  const m = new BpmnModdle();
  const src = `<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:flowable="http://flowable.org/bpmn" targetNamespace="t">
  <process id="p">
    <serviceTask id="s">
      <extensionElements>
        <flowable:field name="a" stringValue="x" />
        <flowable:field name="b"><flowable:string>y</flowable:string></flowable:field>
      </extensionElements>
    </serviceTask>
  </process>
</definitions>
`;
  const { rootElement: defs } = await m.fromXML(src);
  const ee = defs.rootElements[0].flowElements[0].extensionElements;
  const rows = ee.values.map((v) => readRow(v, FIELD));
  rows[1].value = 'z';
  ee.values = replaceItems(m, ee.values, FIELD, rows);
  const out = applyEdits(src, diffXml(src, (await m.toXML(defs, { format: true })).xml));
  assert.equal(out, src.replace('>y<', '><![CDATA[z]]><'));
});

test('a new row without a value writes no empty value element', () => {
  const m = new BpmnModdle();
  const el = replaceItems(m, [], FIELD, [{ ...emptyRow(FIELD), name: 'n' }])[0];
  assert.equal(el.$children, undefined);
});
