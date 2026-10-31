import test from 'node:test';
import assert from 'node:assert/strict';
import { registerPaletteEntry, listPaletteEntries } from '../../src/core/palette.mjs';
import { elementSchema, attributeSpec } from '../../src/core/schema.mjs';

test('default entries create elements and attributes that exist in the Flowable schema', () => {
  const entries = listPaletteEntries();
  assert.deepEqual(entries.map((e) => e.id), ['service-task', 'script-task', 'user-task', 'call-activity', 'dmn-task']);
  for (const e of entries) {
    const local = e.type.slice(5);
    assert.ok(elementSchema(local[0].toLowerCase() + local.slice(1)), e.type);
    for (const k of Object.keys(e.attrs).filter((k) => k.startsWith('flowable:'))) {
      assert.ok(attributeSpec(local[0].toLowerCase() + local.slice(1), 'flowable', k.slice(9)), k);
    }
  }
  const dmn = entries.find((e) => e.id === 'dmn-task');
  assert.equal(dmn.attrs['flowable:type'], 'dmn');
});

test('entries can be added and removed; invalid ones are rejected', () => {
  const off = registerPaletteEntry({ id: 'mail', title: 'Create mail task', icon: 'bpmn-icon-send-task', type: 'bpmn:ServiceTask', attrs: { 'flowable:type': 'mail' } });
  assert.ok(listPaletteEntries().some((e) => e.id === 'mail'));
  off();
  assert.ok(!listPaletteEntries().some((e) => e.id === 'mail'));
  assert.throws(() => registerPaletteEntry({ id: 'service-task', title: 't', icon: 'i', type: 'bpmn:Task' }), /already registered/);
  assert.throws(() => registerPaletteEntry({ id: 'x' }), /needs "title"/);
});
