import test from 'node:test';
import assert from 'node:assert/strict';
import { callParameters } from '../../src/core/callParameters.mjs';

test('callParameters reads flowable:in and flowable:out from $attrs or direct properties', () => {
  const values = [
    { $type: 'flowable:in', $attrs: { source: 'a', target: 'b' } },
    { $type: 'flowable:in', sourceExpression: '${x + 1}', target: 'c' },
    { $type: 'flowable:out', $attrs: { source: 'r', target: 'result' } },
    { $type: 'flowable:executionListener' },
  ];
  const p = callParameters(values);
  assert.deepEqual(p.in.map((x) => [x.source, x.sourceExpression, x.target]), [['a', null, 'b'], [null, '${x + 1}', 'c']]);
  assert.deepEqual(p.out.map((x) => [x.source, x.target]), [['r', 'result']]);
  assert.deepEqual(callParameters(undefined), { in: [], out: [] });
});
