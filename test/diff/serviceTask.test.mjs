import test from 'node:test';
import assert from 'node:assert/strict';
import { serviceTaskInfo } from '../../src/core/serviceTask.mjs';
import { instanceOverlay } from '../../src/core/runHistory.mjs';

test('serviceTaskInfo reads implementation, resultVariable and fields', () => {
  const bo = {
    $attrs: { 'flowable:class': 'com.acme.Call', 'flowable:resultVariable': 'answer' },
    extensionElements: {
      values: [
        { $type: 'flowable:field', $attrs: { name: 'url' }, $children: [{ $type: 'flowable:string', $body: 'http://x' }] },
        { $type: 'flowable:field', $attrs: { name: 'id', expression: '${customerId}' } },
        { $type: 'flowable:executionListener' },
      ],
    },
  };
  const info = serviceTaskInfo(bo);
  assert.deepEqual(info.implementation, { kind: 'class', value: 'com.acme.Call' });
  assert.equal(info.resultVariable, 'answer');
  assert.deepEqual(info.fields, [{ name: 'url', kind: 'string', value: 'http://x' }, { name: 'id', kind: 'expression', value: '${customerId}' }]);
  assert.deepEqual(serviceTaskInfo({}), { implementation: null, resultVariable: null, fields: [] });
});

test('instanceOverlay gives a service task its timed outputs', () => {
  const inst = {
    activities: [{ id: 's', type: 'serviceTask', startMs: 10, endMs: 20 }],
    varTimes: { v: { createdMs: 15, updatedMs: 15 } },
    dmn: [],
    children: {},
  };
  assert.deepEqual(instanceOverlay(inst, []).activities.s.outputs, ['v']);
});
