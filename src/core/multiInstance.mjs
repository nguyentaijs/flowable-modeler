// Multi-instance (parallel / sequential loop) editing for any activity: tasks, call activities, sub processes.
//
//   <multiInstanceLoopCharacteristics isSequential="true" flowable:collection="${items}"
//        flowable:elementVariable="item" flowable:elementIndexVariable="idx">
//     <loopCardinality>${n}</loopCardinality>
//     <completionCondition>${nrOfCompletedInstances >= 2}</completionCondition>
//   </multiInstanceLoopCharacteristics>
//
// Absent isSequential means parallel. Flowable attributes are plain namespaced attributes, so no custom
// descriptor is needed. `set(target, props)` performs the change (modeling.updateModdleProperties in the
// editor, which makes it undoable; a plain assignment in tests).
const MI = 'bpmn:MultiInstanceLoopCharacteristics';
const MI_ATTRIBUTES = ['collection', 'elementVariable', 'elementIndexVariable'];
const MI_EXPRESSIONS = ['loopCardinality', 'completionCondition'];

export function readMultiInstance(bo) {
  const mi = bo.loopCharacteristics;
  if (!mi || mi.$type !== MI) return { mode: 'none', values: {} };
  const values = {};
  for (const k of MI_ATTRIBUTES) values[k] = mi.get('flowable:' + k) ?? '';
  for (const k of MI_EXPRESSIONS) values[k] = mi[k]?.body ?? '';
  return { mode: mi.isSequential ? 'sequential' : 'parallel', values };
}

// change: {mode: 'none' | 'parallel' | 'sequential'}  or  {key, value}
export function updateMultiInstance(moddle, bo, set, change) {
  if (change.mode !== undefined) {
    if (change.mode === 'none') return set(bo, { loopCharacteristics: undefined });
    const sequential = change.mode === 'sequential';
    if (bo.loopCharacteristics?.$type === MI) return set(bo.loopCharacteristics, { isSequential: sequential });
    return set(bo, { loopCharacteristics: moddle.create(MI, { isSequential: sequential }) });
  }
  if (bo.loopCharacteristics?.$type !== MI) updateMultiInstance(moddle, bo, set, { mode: 'parallel' });
  const mi = bo.loopCharacteristics;
  const value = change.value === '' ? undefined : change.value;
  if (MI_EXPRESSIONS.includes(change.key)) return set(mi, { [change.key]: value === undefined ? undefined : moddle.create('bpmn:Expression', { body: value }) });
  if (MI_ATTRIBUTES.includes(change.key)) return set(mi, { ['flowable:' + change.key]: value });
  throw new Error(`Unknown multi-instance property "${change.key}"`);
}
