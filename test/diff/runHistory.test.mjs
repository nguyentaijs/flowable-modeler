import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  selectSql, inList, createDb, fetchRun, listRoots, parseTs, decodeVar, attachJsonTwins, parseDmnExecution, instanceOverlay,
  statusOf, bpmnFlows, bpmnProcessIds, clientCommand, extractStrings, RunError,
} from '../../src/core/runHistory.mjs';

const T = (s) => `2024-05-01 10:00:${s}`;

// A fake database: answers each query from tables by looking at the table name and the id list in the WHERE clause.
function fakeDb(tables, engine = 'mysql') {
  const run = async (sql) => {
    const table = /FROM (ACT_\w+)/.exec(sql)[1];
    let rows = tables[table] ?? [];
    if (tables.__missing?.includes(table)) throw new RunError('Table doesn\'t exist');
    const where = /WHERE (\w+) (IS NULL|IN \(([^)]*)\))/.exec(sql);
    if (where) {
      const col = where[1].toLowerCase();
      if (where[2] === 'IS NULL') rows = rows.filter((r) => r[col] === null || r[col] === undefined);
      else {
        const ids = where[3].split(',').map((s) => s.replace(/'/g, ''));
        rows = rows.filter((r) => ids.includes(r[col]));
      }
    }
    return JSON.stringify(rows);
  };
  return createDb(engine, run);
}

const proc = (id, def, start, end, extra = {}) => ({ id_: id, proc_def_id_: def, start_time_: start, end_time_: end, super_process_instance_id_: null, ...extra });
const act = (inst, id, type, start, end, extra = {}) => ({ proc_inst_id_: inst, act_id_: id, act_type_: type, start_time_: T(start), end_time_: end === null ? null : T(end), ...extra });

const tables = () => ({
  ACT_HI_PROCINST: [
    proc('p1', 'main:1', T('00.000'), T('09.000')),
    proc('p2', 'core:1', T('02.000'), T('06.000'), { super_process_instance_id_: 'p1' }),
    proc('old', 'main:1', '2024-04-01 10:00:00.000', '2024-04-01 10:00:05.000'),
  ],
  ACT_RE_PROCDEF: [
    { id_: 'main:1', key_: 'mainProcess', name_: 'Main', version_: 1 },
    { id_: 'core:1', key_: 'coreProcess', name_: 'Core', version_: 3 },
  ],
  ACT_HI_ACTINST: [
    act('p1', 'start', 'startEvent', '00.000', '00.010'),
    act('p1', 'callCore', 'callActivity', '01.000', '08.000', { call_proc_inst_id_: 'p2' }),
    act('p1', 'end', 'endEvent', '08.500', '09.000'),
    act('p2', 'dmnTask', 'serviceTask', '03.000', '04.000'),
    act('p2', 'loop', 'scriptTask', '04.100', '04.200'),
    act('p2', 'loop', 'scriptTask', '04.300', '04.400'),
    act('p2', 'boom', 'scriptTask', '05.000', '05.500', { delete_reason_: 'Error: bad' }),
  ],
  ACT_HI_VARINST: [
    { name_: 'tier', var_type_: 'string', text_: 'GOLD', proc_inst_id_: 'p1', execution_id_: 'p1' },
    { name_: 'count', var_type_: 'integer', long_: 3, proc_inst_id_: 'p1', execution_id_: 'p1' },
    { name_: 'decisionResult', var_type_: 'json', text_: '{"outcome":"APPROVED_WITH_OFFER"}', proc_inst_id_: 'p1', execution_id_: 'p1' },
    { name_: 'payload', var_type_: 'serializable', bytearray_id_: 'b1', proc_inst_id_: 'p2', execution_id_: 'p2' },
    { name_: 'payloadJson', var_type_: 'json', text_: '{"a":1}', proc_inst_id_: 'p2', execution_id_: 'p2' },
  ],
  ACT_GE_BYTEARRAY: [{ id_: 'b1', bytes_b64: Buffer.from([0xac, 0xed, 0, 5, 0, 5, 0x68, 0x65, 0x6c, 0x6c, 0x6f]).toString('base64') }],
  ACT_DMN_HI_DECISION_EXECUTION: [
    {
      id_: 'd1', decision_definition_id_: 'dd1', instance_id_: 'p2', activity_id_: 'dmnTask', failed_: '0',
      execution_json_: JSON.stringify({ hitPolicy: 'FIRST', inputVariables: { age: 30 }, decisionResult: [{ tier: 'GOLD' }], ruleExecutions: { 1: { valid: false }, 2: { valid: true, ruleNumber: 2 } } }),
    },
  ],
  ACT_DMN_DECISION: [{ id_: 'dd1', key_: 'sampleTierAssignment' }],
});

test('SQL: each engine prints one JSON array', () => {
  assert.equal(selectSql('mysql', 'ACT_RE_PROCDEF', ['ID_', ['x', 'KEY_']], 'WHERE ID_ IN (\'a\')'), "SELECT COALESCE(JSON_ARRAYAGG(JSON_OBJECT('id_', ID_, 'x', KEY_)),JSON_ARRAY()) FROM ACT_RE_PROCDEF WHERE ID_ IN ('a');");
  assert.equal(selectSql('postgres', 'ACT_RE_PROCDEF', ['ID_']), "SELECT COALESCE(json_agg(t),'[]'::json) FROM (SELECT ID_ AS id_ FROM ACT_RE_PROCDEF ) t;");
});

test('ids are validated before they reach SQL', () => {
  assert.equal(inList(['a-1', 'b:2']), "('a-1','b:2')");
  assert.throws(() => inList(["x'; DROP TABLE y;--"]), RunError);
});

test('timestamps: mysql and postgres text, zone-less taken as UTC', () => {
  assert.equal(parseTs('2024-05-01 10:00:00.123'), Date.UTC(2024, 4, 1, 10, 0, 0, 123));
  assert.equal(parseTs('2024-05-01T10:00:00.5'), Date.UTC(2024, 4, 1, 10, 0, 0, 500));
  assert.equal(parseTs(null), null);
  assert.equal(parseTs('nonsense'), null);
});

test('listRoots: newest root first, children excluded, filter by key', async () => {
  const db = fakeDb(tables());
  const roots = await listRoots(db, 10);
  assert.deepEqual(roots.map((r) => r.id_), ['p1', 'old']);
  assert.deepEqual((await listRoots(db, 10, 'coreProcess')).map((r) => r.id_), []);
  assert.equal((await listRoots(db, 1)).length, 1);
});

test('fetchRun: parent, called process, variables, DMN', async () => {
  const run = await fetchRun(fakeDb(tables()), 'p1');
  assert.deepEqual(run.instances.map((i) => [i.instanceId, i.defKey, i.defVersion]), [['p1', 'mainProcess', 1], ['p2', 'coreProcess', 3]]);
  const [main, core] = run.instances;
  assert.equal(main.children.callCore, 'p2');
  assert.equal(main.variables.tier, 'GOLD');
  assert.equal(main.variables.count, 3);
  assert.equal(statusOf(main), 'COMPLETED');
  assert.deepEqual(core.dmn[0].hitRules, [2]);
  assert.equal(core.dmn[0].key, 'sampleTierAssignment');
  assert.equal(core.dmn[0].hitPolicy, 'FIRST');
  // an unreadable Java value keeps the strings that could be recovered, and shows its readable Json twin
  assert.ok(core.variables.payload._unreadable);
  assert.ok(core.variables.payload._recovered_strings.includes('hello'));
  assert.deepEqual(core.variables.payload._json_twin, { a: 1 });
  assert.deepEqual(run.warnings, []);
});

test('fetchRun: missing DMN history is a warning, not a failure', async () => {
  const t = tables();
  t.__missing = ['ACT_DMN_HI_DECISION_EXECUTION'];
  const run = await fetchRun(fakeDb(t), 'p1');
  assert.equal(run.warnings.length, 1);
  assert.deepEqual(run.instances[1].dmn, []);
});

test('fetchRun: unknown instance', async () => {
  await assert.rejects(fetchRun(fakeDb(tables()), 'nope'), /not found/);
});

test('overlay: states, loop counts, failures, inferred flows', async () => {
  const run = await fetchRun(fakeDb(tables()), 'p1');
  const core = run.instances[1];
  const flows = [['f1', 'dmnTask', 'loop'], ['f2', 'loop', 'boom'], ['f3', 'boom', 'neverRan']];
  const o = instanceOverlay(core, flows, {});
  assert.equal(o.activities.dmnTask.state, 'done');
  assert.equal(o.activities.loop.count, 2);
  assert.equal(o.activities.loop.durationMs, 200);
  assert.equal(o.activities.boom.state, 'failed');
  assert.deepEqual(o.flows, ['f1', 'f2']);
  assert.equal(o.dmn.dmnTask.hitRules[0], 2);
  const main = instanceOverlay(run.instances[0], [], { p2: { instanceId: 'p2', defKey: 'coreProcess' } });
  assert.equal(main.children.callCore.defKey, 'coreProcess');
});

test('overlay: an activity without an end time is active, a failed DMN marks its task failed', () => {
  const inst = {
    activities: [{ id: 'a', startMs: 1, endMs: null }, { id: 'b', startMs: 2, endMs: 3 }],
    dmn: [{ activityId: 'b', failed: true, hitRules: [] }], children: {},
  };
  const o = instanceOverlay(inst, [['f', 'a', 'b']]);
  assert.equal(o.activities.a.state, 'active');
  assert.equal(o.activities.b.state, 'failed');
});

test('statuses', () => {
  assert.equal(statusOf({ deleteReason: 'x', endMs: 1 }), 'CANCELED');
  assert.equal(statusOf({ deleteReason: null, endMs: null }), 'RUNNING');
});

test('DMN audit JSON: list form and conclusion-only form', () => {
  assert.deepEqual(parseDmnExecution({ failed_: 'true' }, { ruleExecutions: [{ valid: true }, { valid: false }, { conclusionResults: [{}] }] }, {}).hitRules, [1, 3]);
  const failed = parseDmnExecution({ failed_: 't', decision_definition_id_: 'x' }, { exceptionMessage: 'boom' }, { x: 'k' });
  assert.equal(failed.failed, true);
  assert.equal(failed.error, 'boom');
  assert.equal(failed.key, 'k');
});

test('variable decoding', () => {
  assert.equal(decodeVar({ var_type_: 'boolean', long_: 1 }, {}), true);
  assert.equal(decodeVar({ var_type_: 'double', double_: 1.5 }, {}), 1.5);
  assert.equal(decodeVar({ var_type_: 'date', long_: 0 }, {}), '1970-01-01T00:00:00.000Z');
  assert.deepEqual(decodeVar({ var_type_: 'json', text_: '[1]' }, {}), [1]);
  assert.ok(decodeVar({ var_type_: 'weird' }, {})._unreadable);
  const vars = { m: { _unreadable: 'x' }, mJson: { _unreadable: 'y' } };
  attachJsonTwins(vars);
  assert.equal(vars.m._json_twin, undefined); // the twin is unreadable too
  assert.deepEqual(extractStrings(new Uint8Array([0, 0, 0, 3, 0x61, 0x62, 0x63])), ['abc']);
});

test('BPMN text helpers read the sample processes', () => {
  const main = readFileSync(new URL('../../samples/sampleMainProcess.bpmn', import.meta.url), 'utf8');
  const core = readFileSync(new URL('../../samples/sampleCoreProcess.bpmn', import.meta.url), 'utf8');
  assert.ok(bpmnProcessIds(main).length >= 1);
  assert.ok(bpmnProcessIds(core).length >= 1);
  const flows = bpmnFlows(core);
  assert.ok(flows.length > 0 && flows.every(([id, s, t]) => id && s && t));
});

test('client command: mysql default, postgres, custom command; password redacted in the display', () => {
  const my = clientCommand({ engine: 'mysql', container: 'db', user: 'flowable', database: 'flowable', password: 'secret', dockerPath: 'docker' });
  assert.deepEqual(my.argv, ['docker', 'exec', '-i', '-e', 'MYSQL_PWD=secret', 'db', 'mysql', '-u', 'flowable', '-N', '-B', '-r', 'flowable']);
  assert.ok(!my.display.includes('secret'));
  const pg = clientCommand({ engine: 'postgres', container: 'db', user: 'u', database: 'd', password: '' });
  assert.deepEqual(pg.argv, ['docker', 'exec', '-i', 'db', 'psql', '-U', 'u', '-d', 'd', '-v', 'ON_ERROR_STOP=1', '-At']);
  assert.deepEqual(clientCommand({ dbCommand: 'docker exec -i "my db" mysql -N' }).argv, ['docker', 'exec', '-i', 'my db', 'mysql', '-N']);
  assert.throws(() => clientCommand({ engine: 'mysql' }), /no database container/);
});
