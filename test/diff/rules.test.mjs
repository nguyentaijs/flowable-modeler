import test from 'node:test';
import assert from 'node:assert/strict';
import { registerRule, listRules } from '../../src/core/rules.mjs';
import { diffXml, applyEdits } from '../../src/core/differ.mjs';

const wrap = (inner) => `<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL">\n  <process id="p">\n${inner}\n  </process>\n</definitions>\n`;
const task = (extra = '', attrs = '') => `    <serviceTask id="t" name="a"${attrs}>${extra}</serviceTask>`;

test('default rules are registered', () => {
  const rules = listRules();
  assert.ok(rules.ignoredElement.includes('empty-bpmn-label'));
  assert.ok(rules.attributeValue.includes('di-numbers'));
});

test('a registered ignoredElement rule hides matching elements from the diff', () => {
  const src = wrap(task());
  const next = wrap(task('<documentation></documentation>'));
  assert.equal(diffXml(src, next).length, 1, 'without the rule the empty element is a change');
  const unregister = registerRule('ignoredElement', { name: 'empty-documentation', test: (el) => el.name === 'documentation' && !el.children.length });
  try {
    assert.equal(diffXml(src, next).length, 0);
  } finally {
    unregister();
  }
  assert.equal(diffXml(src, next).length, 1, 'unregistering restores the default behaviour');
});

test('a registered ignoredAttribute rule is not added, removed or compared', () => {
  const src = wrap(task('', ' flowable:async="false"'));
  const next = wrap(task(''));
  assert.equal(applyEdits(src, diffXml(src, next)), next);
  const unregister = registerRule('ignoredAttribute', { name: 'async-false', test: (el, a) => a.name === 'flowable:async' && a.value === 'false' });
  try {
    assert.equal(diffXml(src, next).length, 0);
  } finally {
    unregister();
  }
});

test('a registered attributeValue rule treats equivalent spellings as equal', () => {
  const src = wrap(task('', ' flowable:expression="${a}"'));
  const next = wrap(task('', ' flowable:expression="${ a }"'));
  assert.equal(diffXml(src, next).length, 1);
  const unregister = registerRule('attributeValue', {
    name: 'expr-spaces',
    test: (el, a) => a.name === 'flowable:expression',
    normalize: (v) => v.replace(/\s+/g, ''),
  });
  try {
    assert.equal(diffXml(src, next).length, 0);
  } finally {
    unregister();
  }
});

test('invalid rules are rejected', () => {
  assert.throws(() => registerRule('nope', { name: 'x', test: () => true }), /Unknown rule kind/);
  assert.throws(() => registerRule('ignoredElement', { name: 'x' }), /needs a test function/);
  assert.throws(() => registerRule('attributeValue', { name: 'x', test: () => true }), /needs a normalize function/);
});
