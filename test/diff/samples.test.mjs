import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import BpmnModdle from 'bpmn-moddle';
import { JSDOM } from 'jsdom';
import { validate } from '../../src/core/validators.mjs';
import { decisionKeys } from '../../src/core/dmnValidators.mjs';
import { diffXml, applyEdits } from '../../src/core/differ.mjs';
import { parseDmn, serializeDmn } from '../../src/core/dmnModel.mjs';

// The dummy files in samples/ stand in for real Flowable Design exports: two processes and a decision table for every key they refer to.
const DIR = new URL('../../samples/', import.meta.url);
const files = fs.readdirSync(DIR, { withFileTypes: true }).filter((e) => e.isFile()).map((e) => e.name).sort(); // not folders such as .vscode
const read = (f) => fs.readFileSync(new URL(f, DIR), 'utf8');
const bpmn = files.filter((f) => f.endsWith('.bpmn'));
const dmn = files.filter((f) => f.endsWith('.dmn'));
const keys = new Set(dmn.flatMap((f) => decisionKeys(read(f))));

test('samples: two processes and a decision table for every key they refer to', () => {
  assert.equal(bpmn.length, 2);
  assert.equal(dmn.length, 2);
});

test('samples have no errors or warnings, and every DMN task finds its decision', () => {
  for (const f of files) {
    const ds = validate(read(f), { config: { dmnDecisionKeys: keys } }).filter((d) => d.severity !== 'information');
    assert.deepEqual(ds.map((d) => d.message), [], f);
  }
});

test('samples carry no production terms', () => {
  const banned = /tymex|moretyme|credit|bureau|risk|icl|champion|challenger|\bbau\b|program|loan|customer|gender|profile|applicat|facility|PROG-|\bFT\b/i;
  for (const f of files) {
    const hit = banned.exec(read(f).replace(/Af(?=terExternal)/g, ''));
    assert.equal(hit, null, `${f}: ${hit?.[0]}`);
  }
});

test('BPMN samples round-trip through the modeler without a text change', async () => {
  for (const f of bpmn) {
    const src = read(f);
    const m = new BpmnModdle();
    const { rootElement } = await m.fromXML(src);
    const next = (await m.toXML(rootElement, { format: true })).xml;
    assert.equal(applyEdits(src, diffXml(src, next)), src, f);
  }
});

test('DMN samples open and save in the DMN editor without a text change', () => {
  const { DOMParser } = new JSDOM('').window;
  for (const f of dmn) {
    const src = read(f);
    assert.equal(applyEdits(src, diffXml(src, serializeDmn(parseDmn(src, DOMParser)))), src, f);
  }
});
