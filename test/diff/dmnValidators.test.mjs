import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { validate } from '../../src/core/validators.mjs';
import { decisionKeys, decisionEntries, referenceKeys, referenceKeyAt, splitValues, cellProblem } from '../../src/core/dmnValidators.mjs';

const doc = (f) => fs.readFileSync(new URL('../../samples/' + f, import.meta.url), 'utf8');
const DMN_FILES = ['sampleOfferConfigurations.dmn', 'sampleTierAssignment.dmn'];
const NS = 'xmlns="https://www.omg.org/spec/DMN/20191111/MODEL/"';
const dmn = (table) => `<definitions ${NS} id="d"><decision id="k"><decisionTable id="t" ${table}`;
const msgs = (text, options) => validate(text, options).map((d) => `${d.severity}: ${d.message}`);

test('the real DMN files have no errors or warnings', () => {
  for (const f of DMN_FILES) assert.deepEqual(validate(doc(f)).filter((d) => d.severity !== 'information'), [], f);
});

test('BPMN validators do not run on DMN files and the other way round', () => {
  const ds = validate(doc(DMN_FILES[0]));
  assert.ok(ds.every((d) => !['juel-syntax', 'flowable-attributes', 'required-fields'].includes(d.validator)));
});

test('decision table: hit policy, aggregation, columns and cells', () => {
  const ok = '<input><inputExpression><text>x</text></inputExpression></input><output name="o"/><rule><inputEntry><text>1</text></inputEntry><outputEntry><text>2</text></outputEntry></rule></decisionTable></decision></definitions>';
  assert.deepEqual(msgs(dmn('hitPolicy="FIRST">' + ok)), []);
  assert.ok(msgs(dmn('hitPolicy="BEST">' + ok)).some((m) => /hitPolicy must be one of/.test(m)));
  assert.ok(msgs(dmn('hitPolicy="FIRST" aggregation="SUM">' + ok)).some((m) => /only applies to hit policy COLLECT/.test(m)));
  assert.deepEqual(msgs(dmn('hitPolicy="COLLECT" aggregation="SUM">' + ok)), []);
  assert.ok(msgs(dmn('hitPolicy="COLLECT" aggregation="AVG">' + ok)).some((m) => /aggregation must be one of/.test(m)));
  assert.ok(msgs(dmn('>' + ok.replace('name="o"', ''))).some((m) => /Output column has no name/.test(m)));
  assert.ok(msgs(dmn('>' + ok.replace('<text>x</text>', '<text> </text>'))).some((m) => /no expression/.test(m)));
  assert.ok(msgs(dmn('>' + ok.replace('<outputEntry><text>2</text></outputEntry>', ''))).some((m) => /0 output cell/.test(m)));
  assert.ok(msgs(dmn('>' + ok.replace('<output name="o"/>', '<output name="o"/><output name="o"/>'))).some((m) => /Duplicate output name/.test(m)));
});

test('rule cells: unbalanced quote and literals outside the allowed values', () => {
  const t = (cell) => dmn(`><input><inputExpression><text>x</text></inputExpression><inputValues><text>"A","B"</text></inputValues></input><output name="o"/><rule><inputEntry><text>${cell}</text></inputEntry><outputEntry><text>1</text></outputEntry></rule></decisionTable></decision></definitions>`);
  assert.deepEqual(msgs(t('== "A"')), []);
  assert.deepEqual(msgs(t('-')), []);
  assert.ok(msgs(t('== "C"')).some((m) => /"C" is not in this column's allowed values/.test(m)));
  assert.ok(msgs(t('== "A')).some((m) => /Unbalanced quote/.test(m)));
  assert.deepEqual(msgs(t('"A","B"')), [], 'lists and ranges are not checked');
});

test('splitValues and decisionKeys', () => {
  assert.deepEqual(splitValues('"A","B", 3 ,"x,y"'), ['A', 'B', '3', 'x,y']);
  assert.deepEqual(decisionKeys(doc(DMN_FILES[0])), ['sampleOfferConfigurations']);
  assert.deepEqual(decisionKeys('not xml <'), []);
});

test('dmn-reference: a DMN task must name a decision that exists', () => {
  const bpmn = (key, extra = '') => `<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:flowable="http://flowable.org/bpmn"><process id="p"><serviceTask id="s" flowable:type="dmn"><extensionElements><flowable:field name="decisionTableReferenceKey"><flowable:string>${key}</flowable:string></flowable:field></extensionElements></serviceTask>${extra}</process></definitions>`;
  const keys = new Set(['dmnA']);
  const run = (text, dmnDecisionKeys = keys) => msgs(text, { config: { dmnDecisionKeys } }).filter((m) => /decision/.test(m));
  assert.deepEqual(run(bpmn('dmnA')), []);
  assert.equal(run(bpmn('dmnB')).length, 1);
  assert.deepEqual(run(bpmn('${key}')), [], 'expressions are not checked');
  assert.deepEqual(run(bpmn('dmnB'), null), [], 'not indexed: no check');
  assert.deepEqual(run(bpmn('dmnB'), new Set()), [], 'no .dmn files at all: no check');
});

test('referenceKeyAt finds the decision key under the cursor, also inside CDATA', () => {
  const text = '<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:flowable="http://flowable.org/bpmn"><process id="p"><serviceTask id="s" flowable:type="dmn"><extensionElements><flowable:field name="decisionTableReferenceKey"><flowable:string><![CDATA[dmnA]]></flowable:string></flowable:field><flowable:field name="other"><flowable:string>x</flowable:string></flowable:field></extensionElements></serviceTask></process></definitions>';
  const at = text.indexOf('dmnA') + 2;
  const hit = referenceKeyAt(text, at);
  assert.equal(hit.key, 'dmnA');
  assert.equal(text.slice(hit.start, hit.end), 'dmnA');
  assert.equal(referenceKeyAt(text, text.indexOf('>x<') + 1), null, 'other fields are not references');
  assert.equal(referenceKeyAt(text, 3), null);
  assert.deepEqual(decisionEntries(fs.readFileSync(new URL('../../samples/' + DMN_FILES[0], import.meta.url), 'utf8')).map((d) => d.id), ['sampleOfferConfigurations']);
});

test('referenceKeys tell which DMN task holds each reference (for "used by")', () => {
  const refs = referenceKeys(fs.readFileSync(new URL('../../samples/sampleCoreProcess.bpmn', import.meta.url), 'utf8'));
  assert.equal(refs.length, 1);
  assert.deepEqual([refs[0].key, refs[0].taskId, refs[0].taskName], ['sampleTierAssignment', 'DmnTask_TierAssignment', 'Tier Assignment']);
  assert.ok(refs[0].taskStart < refs[0].start);
});

test('dmn-reference: the message says where the decision was looked for', () => {
  const bpmn = '<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:flowable="http://flowable.org/bpmn"><process id="p"><serviceTask id="s" flowable:type="dmn"><extensionElements><flowable:field name="decisionTableReferenceKey"><flowable:string>missing</flowable:string></flowable:field></extensionElements></serviceTask></process></definitions>';
  const run = (config) => msgs(bpmn, { config: { dmnDecisionKeys: new Set(['other']), ...config } }).filter((m) => /decision/.test(m));
  assert.match(run({ dmnScope: 'in the same folder' })[0], /"missing" was found in the \.dmn files in the same folder$/);
  assert.match(run({})[0], /\.dmn files of this workspace$/, 'without a scope text: as before');
});

test('cellProblem: a cell must fit the column typeRef', () => {
  const fits = (type, cell, isInput = true) => assert.equal(cellProblem(type, cell, isInput), '', `${type}: ${cell}`);
  const bad = (type, cell, re, isInput = true) => assert.match(cellProblem(type, cell, isInput), re, `${type}: ${cell}`);
  for (const type of ['string', 'number', 'boolean', 'date', 'collection']) {
    fits(type, '');
    fits(type, '   ');
    fits(type, '-');
    fits(type, '${x}');
    bad(type, '${x', /Unterminated/);
  }
  fits('anything', '== 5');
  fits('', '== 5');

  fits('string', '== "A"');
  fits('string', '"A"');
  fits('string', '!= premium');
  fits('string', '== ');
  bad('string', '> "A"', /string column: ">" does not apply/);
  bad('string', '== 5', /string column: expected a quoted text/);
  bad('string', '== true', /string column/);
  fits('string', '"5"');
  bad('string', "== date:toDate('2020-01-01')", /string column/);

  fits('number', '>= 10');
  fits('number', '-3.5');
  fits('number', '< limit');
  fits('number', '100', false);
  bad('number', '>= "10"', /number column: expected a number/);
  bad('number', 'true', /number column/, false);
  bad('number', '> date:now()', /number column/);

  fits('boolean', '== true');
  fits('boolean', 'false', false);
  fits('boolean', '== isVip');
  bad('boolean', '< true', /boolean column: "<" does not apply/);
  bad('boolean', '== "true"', /boolean column: expected true or false/);
  bad('boolean', '== 1', /boolean column/);

  fits('date', ">= date:toDate('2020-01-01')");
  fits('date', 'date:now()', false);
  bad('date', '>= 2020-01-01', /date column: expected date:toDate/);
  bad('date', '== "2020-01-01"', /date column/);
  bad('date', '2020-01-01', /date column/, false);

  fits('collection', '${items}');
  fits('collection', '#{items}');
  bad('collection', 'a, b', /collection column: expected a JUEL expression/);
  bad('collection', '>= 700', /collection column/);
  bad('collection', 'items', /collection column/, false);
});

test('dmn-cell-types: reports mismatching cells and unknown typeRef, as warnings', () => {
  const t = (inType, inCell, outType = 'string', outCell = '"x"') =>
    dmn(`hitPolicy="FIRST"><input><inputExpression typeRef="${inType}"><text>v</text></inputExpression></input><output name="o" typeRef="${outType}"/><rule><inputEntry><text><![CDATA[${inCell}]]></text></inputEntry><outputEntry><text><![CDATA[${outCell}]]></text></outputEntry></rule></decisionTable></decision></definitions>`);
  const run = (text) => validate(text).filter((d) => d.validator === 'dmn-cell-types');
  assert.deepEqual(run(t('date', ">= date:toDate('2020-01-01')")), []);
  assert.deepEqual(run(t('collection', '${v}', 'number', '5')), []);
  const dateBad = run(t('date', '>= 2020-01-01'));
  assert.equal(dateBad.length, 1);
  assert.equal(dateBad[0].severity, 'warning');
  assert.match(dateBad[0].message, /date column/);
  assert.match(run(t('collection', '>= 700'))[0].message, /collection column/);
  assert.match(run(t('number', '1', 'boolean', '"yes"'))[0].message, /boolean column/);
  const unknown = run(t('integer', '== "a"'));
  assert.equal(unknown.length, 1, 'cells of an unknown type are not checked');
  assert.match(unknown[0].message, /typeRef "integer" is not one of: string, number, boolean, date, collection/);
  const untyped = dmn('hitPolicy="FIRST"><input><inputExpression><text>v</text></inputExpression></input><output name="o"/><rule><inputEntry><text>>= 5</text></inputEntry><outputEntry><text>1</text></outputEntry></rule></decisionTable></decision></definitions>');
  assert.deepEqual(run(untyped), [], 'no typeRef: not checked');
});
