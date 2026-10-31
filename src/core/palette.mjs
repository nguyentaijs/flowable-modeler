// Palette entries added on top of bpmn-js's stock palette (which only offers a generic Task; Service, Script
// and the others are reached through its wrench menu). Entries are data, so adding one is one call:
//
//   registerPaletteEntry({
//     id: 'my-task',               // unique
//     title: 'Create my task',
//     icon: 'bpmn-icon-service',   // a bpmn-font class
//     type: 'bpmn:ServiceTask',    // moddle type to create
//     attrs: { 'flowable:type': 'mail' },   // optional: initial attributes (Flowable ones as "flowable:x")
//     name: 'Send mail',           // optional initial name
//     group: 'flowable',           // optional, default "flowable"
//   })
const entries = [];

export function registerPaletteEntry(entry) {
  for (const k of ['id', 'title', 'icon', 'type']) if (!entry[k]) throw new Error(`Palette entry needs "${k}"`);
  if (entries.some((e) => e.id === entry.id)) throw new Error(`Palette entry "${entry.id}" is already registered`);
  entries.push({ group: 'flowable', attrs: {}, ...entry });
  return () => {
    const i = entries.findIndex((e) => e.id === entry.id);
    if (i >= 0) entries.splice(i, 1);
  };
}

export const listPaletteEntries = () => [...entries];

registerPaletteEntry({ id: 'service-task', title: 'Create service task', icon: 'bpmn-icon-service-task', type: 'bpmn:ServiceTask' });
registerPaletteEntry({ id: 'script-task', title: 'Create script task', icon: 'bpmn-icon-script-task', type: 'bpmn:ScriptTask', attrs: { scriptFormat: 'groovy' } });
registerPaletteEntry({ id: 'user-task', title: 'Create user task', icon: 'bpmn-icon-user-task', type: 'bpmn:UserTask' });
registerPaletteEntry({ id: 'call-activity', title: 'Create call activity', icon: 'bpmn-icon-call-activity', type: 'bpmn:CallActivity' });
registerPaletteEntry({ id: 'dmn-task', title: 'Create DMN task (service task, type dmn)', icon: 'bpmn-icon-business-rule-task', type: 'bpmn:ServiceTask', attrs: { 'flowable:type': 'dmn' }, name: 'DMN task' });
