import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { JSDOM } from 'jsdom';
import { diffXml, applyEdits } from '../../src/core/differ.mjs';
import { parseXml, canon, rootElement } from '../../src/core/xml.mjs';
import * as dmn from '../../src/core/dmnModel.mjs';

const { DOMParser } = new JSDOM('').window;
// the samples (open/save changes nothing) and a richer table in test/data for the edit operations
const FILES = ['sampleOfferConfigurations.dmn', 'sampleTierAssignment.dmn'];
const RICH = 'data/discountDecision.dmn';
const read = (f) => fs.readFileSync(new URL(f.startsWith('data/') ? '../' + f : '../../samples/' + f, import.meta.url), 'utf8');
const open = (f) => {
  const src = read(f);
  const doc = dmn.parseDmn(src, DOMParser);
  return { src, doc, table: dmn.decisionTable(dmn.decisions(doc)[0]) };
};
// what the extension does: diff the serialized model against the file, patch, and verify
const write = ({ src, doc }) => {
  const next = dmn.serializeDmn(doc);
  const out = applyEdits(src, diffXml(src, next));
  assert.equal(canon(rootElement(parseXml(out))), canon(rootElement(parseXml(next))), 'patched text matches the editor output');
  return out;
};

for (const f of FILES) {
  test(`${f}: opening and saving without edits changes nothing`, () => {
    const m = open(f);
    assert.equal(write(m), m.src);
  });
}

test('editing one rule cell changes only that cell', () => {
  const m = open(RICH);
  dmn.setEntryText(m.doc, dmn.inputEntries(dmn.rules(m.table)[1])[2], '== "C"');
  const out = write(m);
  assert.equal(out, m.src.replace('inputEntry_3_2"><text><![CDATA[== "B"]]>', 'inputEntry_3_2"><text><![CDATA[== "C"]]>'));
});

test('hit policy and a rule description are single-attribute / single-line edits', () => {
  const m = open(RICH);
  dmn.setAttr(m.table, 'hitPolicy', 'COLLECT');
  dmn.setAttr(m.table, 'aggregation', 'SUM');
  dmn.setRuleDescription(m.doc, dmn.rules(m.table)[0], 'changed');
  const out = write(m);
  assert.ok(out.includes('hitPolicy="COLLECT" aggregation="SUM"'));
  assert.ok(out.includes('<description>changed</description>'));
  assert.equal(out.split('\n').length, m.src.split('\n').length);
});

test('adding a rule, an input column and an output column keeps every rule aligned', () => {
  const m = open(RICH);
  const before = dmn.rules(m.table).length;
  dmn.addRule(m.doc, m.table);
  dmn.addInput(m.doc, m.table, { label: 'Channel', expression: 'channel', typeRef: 'string' }, 1);
  dmn.addOutput(m.doc, m.table, { label: 'Note', name: 'note' });
  const out = write(m);
  const re = dmn.parseDmn(out, DOMParser);
  const t = dmn.decisionTable(dmn.decisions(re)[0]);
  assert.equal(dmn.rules(t).length, before + 1);
  for (const rule of dmn.rules(t)) {
    assert.equal(dmn.inputEntries(rule).length, dmn.inputs(t).length);
    assert.equal(dmn.outputEntries(rule).length, dmn.outputs(t).length);
  }
  assert.equal(dmn.textOf(dmn.inputExpressionOf(dmn.inputs(t)[1])), 'channel');
  const ids = [...re.getElementsByTagName('*')].map((e) => e.getAttribute('id')).filter(Boolean);
  assert.equal(new Set(ids).size, ids.length, 'generated ids are unique');
  assert.ok(/<inputEntry id="[^"]+">\s*<text><\/text>/.test(out) || /<text><\/text>/.test(out));
});

test('removing a column and a rule removes the matching cells', () => {
  const m = open(RICH);
  dmn.removeInput(m.table, 1);
  dmn.removeOutput(m.table, 0);
  dmn.removeRule(m.table, 0);
  const out = write(m);
  const t = dmn.decisionTable(dmn.decisions(dmn.parseDmn(out, DOMParser))[0]);
  assert.equal(dmn.inputs(t).length, 2);
  assert.equal(dmn.outputs(t).length, 1);
  assert.equal(dmn.rules(t).length, 6);
  for (const rule of dmn.rules(t)) assert.equal(dmn.inputEntries(rule).length + dmn.outputEntries(rule).length, 3);
});

test('moving a rule reorders it; CDATA stays CDATA; ]]> in a cell is split', () => {
  const m = open(RICH);
  const second = dmn.ruleDescription(dmn.rules(m.table)[1]);
  dmn.moveRule(m.table, 1, 0);
  assert.equal(dmn.ruleDescription(dmn.rules(m.table)[0]), second);
  dmn.setEntryText(m.doc, dmn.inputEntries(dmn.rules(m.table)[0])[0], 'a ]]> b');
  const out = write(m);
  assert.ok(out.includes('a ]]]]><![CDATA[> b'));
});

test('a malformed or non-DMN document is rejected with a message', () => {
  assert.throws(() => dmn.parseDmn('<definitions><decision></definitions>', DOMParser));
  assert.throws(() => dmn.parseDmn('<foo/>', DOMParser), /Not a DMN file/);
});

test('moving columns moves the header and the cell of every rule together', () => {
  const m = open(RICH);
  const before = dmn.rules(m.table).map((r) => [dmn.textOf(dmn.inputEntries(r)[0]), dmn.textOf(dmn.outputEntries(r)[0]), dmn.textOf(dmn.outputEntries(r)[1])]);
  dmn.moveInput(m.table, 0, 2); // orderTotal (>) goes last among the inputs
  dmn.moveOutput(m.table, 1, 0); // feePercent goes first
  const out = write(m);
  const t = dmn.decisionTable(dmn.decisions(dmn.parseDmn(out, DOMParser))[0]);
  assert.deepEqual(dmn.inputs(t).map((i) => i.getAttribute('label')), ['orderTotal (<=)', 'tier', 'orderTotal (>)']);
  assert.deepEqual(dmn.outputs(t).map((o) => o.getAttribute('name')), ['feePercent', 'discountAmount']);
  dmn.rules(t).forEach((r, i) => {
    assert.equal(dmn.textOf(dmn.inputEntries(r)[2]), before[i][0]);
    assert.equal(dmn.textOf(dmn.outputEntries(r)[0]), before[i][2]);
    assert.equal(dmn.textOf(dmn.outputEntries(r)[1]), before[i][1]);
  });
  const order = [...t.children].map((c) => c.localName);
  assert.deepEqual(order.filter((n, i) => order.indexOf(n) === i), ['input', 'output', 'rule'], 'columns stay before the rules');
});

test('allowed values: edit, add and remove <inputValues> / <outputValues>', () => {
  const m = open(RICH);
  const [a, b, c] = dmn.inputs(m.table);
  assert.equal(dmn.allowedValues(c), '"A","B"');
  assert.equal(dmn.allowedValues(a), '');
  dmn.setAllowedValues(m.doc, c, '"A","B","C"');
  dmn.setAllowedValues(m.doc, a, '1,2');
  dmn.setAllowedValues(m.doc, dmn.outputs(m.table)[0], '10,20');
  let out = write(m);
  assert.ok(out.includes('<text>"A","B","C"</text>') && out.includes('<text>1,2</text>') && out.includes('<outputValues>'));
  const m2 = { src: out, doc: dmn.parseDmn(out, DOMParser) };
  const t2 = dmn.decisionTable(dmn.decisions(m2.doc)[0]);
  dmn.setAllowedValues(m2.doc, dmn.inputs(t2)[2], '"A","B"');
  dmn.setAllowedValues(m2.doc, dmn.inputs(t2)[0], '');
  dmn.setAllowedValues(m2.doc, dmn.outputs(t2)[0], '');
  out = write(m2);
  assert.equal(out, m.src, 'removing the added ones and restoring the edited one gives the original bytes');
});

test('an emptied input cell is written as the CDATA wildcard, an emptied output cell stays empty', () => {
  const { doc, table } = open(RICH);
  const rule = dmn.rules(table)[0];
  const [inEntry] = dmn.inputEntries(rule);
  const [outEntry] = dmn.outputEntries(rule);
  dmn.setEntryText(doc, inEntry, '');
  dmn.setEntryText(doc, outEntry, '');
  const xml = dmn.serializeDmn(doc);
  assert.ok(xml.includes(`<inputEntry id="${inEntry.getAttribute('id')}">\n          <text><![CDATA[-]]></text>`));
  assert.equal(dmn.textOf(outEntry), '');
});
