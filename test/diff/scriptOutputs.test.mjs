import test from 'node:test';
import assert from 'node:assert/strict';
import { scriptOutputNames } from '../../src/core/scriptOutputs.mjs';
import { instanceOverlay } from '../../src/core/runHistory.mjs';

test('scriptOutputNames finds resultVariable and literal setVariable names', () => {
  const script = `execution.setVariable('score', 1); execution.setVariable( "band" , x); other.setVariable(name, 2)`;
  assert.deepEqual(scriptOutputNames(script, 'result').sort(), ['band', 'result', 'score']);
  assert.deepEqual(scriptOutputNames('def a = 1', null), []);
  assert.deepEqual(scriptOutputNames(undefined, undefined), []);
});

test('instanceOverlay gives a script task the variables written while it ran', () => {
  const inst = {
    activities: [
      { id: 'script1', type: 'scriptTask', startMs: 1000, endMs: 2000 },
      { id: 'script2', type: 'scriptTask', startMs: 3000, endMs: null },
      { id: 'user1', type: 'userTask', startMs: 1000, endMs: 2000 },
    ],
    varTimes: {
      inside: { createdMs: 1500, updatedMs: 1500 },
      updated: { createdMs: 500, updatedMs: 2000 },
      outside: { createdMs: 2500, updatedMs: 2500 },
    },
    dmn: [],
    children: {},
  };
  const { activities } = instanceOverlay(inst, []);
  assert.deepEqual(activities.script1.outputs, ['inside', 'updated']);
  assert.deepEqual(activities.script2.outputs, []);
  assert.equal(activities.user1.outputs, undefined);
});
