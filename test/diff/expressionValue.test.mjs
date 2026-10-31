import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveExpression as r } from '../../src/core/expressionValue.mjs';

const vars = { applicationData: { profileId: 42, tags: ['a', 'b'], 'odd key': 'x' }, id: 7, n: null };

test('resolves plain property paths', () => {
  assert.deepEqual(r('${applicationData.profileId}', vars), { resolved: true, value: 42 });
  assert.deepEqual(r('#{applicationData.tags[1]}', vars), { resolved: true, value: 'b' });
  assert.deepEqual(r("${applicationData['odd key']}", vars), { resolved: true, value: 'x' });
  assert.deepEqual(r('${applicationData.tags}', vars), { resolved: true, value: ['a', 'b'] });
  assert.deepEqual(r('${n}', vars), { resolved: true, value: null });
});

test('substitutes embedded expressions and passes plain text through', () => {
  assert.deepEqual(r('http://x/${id}/p/${applicationData.profileId}', vars), { resolved: true, value: 'http://x/7/p/42' });
  assert.deepEqual(r('plain', vars), { resolved: true, value: 'plain' });
});

test('reports what it cannot resolve', () => {
  assert.deepEqual(r('${missing.x}', vars), { resolved: false, reason: 'not found' });
  assert.deepEqual(r('${applicationData.nope}', vars), { resolved: false, reason: 'not found' });
  assert.deepEqual(r('${id + 1}', vars), { resolved: false, reason: 'not a simple path' });
  assert.deepEqual(r('${bean.call(id)}', vars), { resolved: false, reason: 'not a simple path' });
  assert.deepEqual(r('${a ? b : c}', vars), { resolved: false, reason: 'not a simple path' });
  assert.deepEqual(r('${x}', undefined), { resolved: false, reason: 'not found' });
});
