// Reading a Flowable process run from the engine's history tables, and turning it into what the run viewer draws.
// Pure logic: the database is reached through a `run(sql)` function that returns the plain text the client printed, so the
// same code works with `docker exec ... mysql|psql` and with a fake in the tests. Everything here is read-only (SELECT).

const ID_RE = /^[A-Za-z0-9_.:-]+$/;

export class RunError extends Error {}

// ---------------------------------------------------------------------------------------------------------------------
// SQL (each engine prints the rows as one JSON array, so no column parsing is needed)

export function inList(ids) {
  for (const id of ids) if (!ID_RE.test(id)) throw new RunError(`unexpected characters in id: ${JSON.stringify(id)}`);
  return '(' + ids.map((i) => `'${i}'`).join(',') + ')';
}

// columns: names, or [alias, expression]. The alias is the lower-case column name by default.
export function selectSql(engine, table, columns, where = '') {
  const cols = columns.map((c) => (Array.isArray(c) ? c : [c.toLowerCase(), c]));
  if (engine === 'postgres') {
    const inner = cols.map(([alias, expr]) => `${expr} AS ${alias}`).join(', ');
    return `SELECT COALESCE(json_agg(t),'[]'::json) FROM (SELECT ${inner} FROM ${table} ${where}) t;`;
  }
  const pairs = cols.map(([alias, expr]) => `'${alias}', ${expr}`).join(', ');
  return `SELECT COALESCE(JSON_ARRAYAGG(JSON_OBJECT(${pairs})),JSON_ARRAY()) FROM ${table} ${where};`;
}

const base64Column = (engine, column) => ['bytes_b64', engine === 'postgres' ? `encode(${column},'base64')` : `TO_BASE64(${column})`];

export function createDb(engine, run) {
  return {
    engine,
    async select(table, columns, where = '') {
      const out = (await run(selectSql(engine, table, columns, where))).trim();
      if (!out) return [];
      try {
        return JSON.parse(out);
      } catch {
        throw new RunError('could not parse database output: ' + out.slice(0, 200));
      }
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Values

// Database timestamp text -> epoch ms. Zone-less times are taken as UTC, like the engine's own history viewer scripts.
export function parseTs(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return Math.trunc(v);
  const m = /^(\d{4})-(\d\d)-(\d\d)[T ](\d\d):(\d\d):(\d\d)(?:\.(\d+))?/.exec(String(v));
  if (!m) return null;
  const ms = Number((m[7] || '0').padEnd(3, '0').slice(0, 3));
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6], ms);
}

export const iso = (ms) => (ms === null || ms === undefined ? null : new Date(ms).toISOString());

// Length-prefixed text in a Java serialization stream we cannot parse (no Java classes here): every java.lang.String in
// the stream is a 2-byte big-endian length plus UTF-8, so scanning for that shape recovers field names and values.
export function extractStrings(bytes, minLen = 2, maxLen = 256) {
  const found = [];
  const seen = new Set();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let i = 0;
  while (i + 2 <= bytes.length) {
    const length = (bytes[i] << 8) | bytes[i + 1];
    if (length >= minLen && length <= maxLen && i + 2 + length <= bytes.length) {
      let s = null;
      try {
        s = decoder.decode(bytes.subarray(i + 2, i + 2 + length));
      } catch {
        s = null;
      }
      if (s !== null && /^[\P{C}\s]*$/u.test(s) && /[\p{L}\p{N}]/u.test(s) && !seen.has(s)) {
        seen.add(s);
        found.push(s);
        i += 2 + length;
        continue;
      }
    }
    i++;
  }
  return found;
}

const JAVA_MAGIC = [0xac, 0xed];
const isJavaSerialized = (bytes) => bytes.length > 2 && bytes[0] === JAVA_MAGIC[0] && bytes[1] === JAVA_MAGIC[1];

function decodeBlob(bytes) {
  if (isJavaSerialized(bytes)) {
    const out = { _unreadable: 'Java-serialized value, cannot be decoded here' };
    const strings = extractStrings(bytes);
    if (strings.length) out._recovered_strings = strings;
    return out;
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return { _unreadable: `binary value (${bytes.length} bytes)` };
  }
}

export function decodeVar(v, blobs) {
  const t = (v.var_type_ || '').toLowerCase();
  if (['string', 'longstring', 'uuid', ''].includes(t) && v.text_ !== null && v.text_ !== undefined) return v.text_;
  if (t === 'json' || t === 'longjson') {
    try {
      return JSON.parse(v.text_ || 'null');
    } catch {
      return v.text_;
    }
  }
  if (['integer', 'long', 'short'].includes(t)) return v.long_ ?? null;
  if (t === 'boolean') return v.long_ === null || v.long_ === undefined ? null : Boolean(v.long_);
  if (t === 'double' || t === 'bigdecimal') return v.double_ ?? v.text_ ?? null;
  if (t === 'date') return iso(v.long_);
  if (t === 'null') return null;
  const blob = v.bytearray_id_ && blobs[v.bytearray_id_];
  if (blob) return decodeBlob(blob);
  if (v.text_ !== null && v.text_ !== undefined) return v.text_;
  if (v.long_ !== null && v.long_ !== undefined) return v.long_;
  return { _unreadable: `variable type '${t}' not decoded` };
}

const unreadable = (x) => x && typeof x === 'object' && !Array.isArray(x) && '_unreadable' in x;

// A value stored twice (a Map that cannot be read, and a JsonNode named <name>Json) is shown through its readable twin.
export function attachJsonTwins(variables) {
  for (const [name, val] of Object.entries(variables)) {
    if (!unreadable(val)) continue;
    const twin = variables[name + 'Json'];
    if (twin === undefined || unreadable(twin)) continue;
    val._json_twin = twin;
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Fetching

const PROC_COLS = ['ID_', 'PROC_DEF_ID_', 'START_TIME_', 'END_TIME_', 'DURATION_', 'SUPER_PROCESS_INSTANCE_ID_', 'DELETE_REASON_', 'BUSINESS_KEY_'];
const ACT_COLS = ['ACT_ID_', 'ACT_NAME_', 'ACT_TYPE_', 'PROC_INST_ID_', 'CALL_PROC_INST_ID_', 'START_TIME_', 'END_TIME_', 'DURATION_', 'DELETE_REASON_'];
const VAR_COLS = ['NAME_', 'VAR_TYPE_', 'TEXT_', 'LONG_', 'DOUBLE_', 'BYTEARRAY_ID_', 'PROC_INST_ID_', 'EXECUTION_ID_'];
const DMN_COLS = ['ID_', 'DECISION_DEFINITION_ID_', 'START_TIME_', 'END_TIME_', 'INSTANCE_ID_', 'ACTIVITY_ID_', 'FAILED_', 'EXECUTION_JSON_'];

async function fetchDefs(db, defIds) {
  const ids = [...new Set(defIds.filter(Boolean))].sort();
  if (!ids.length) return {};
  const rows = await db.select('ACT_RE_PROCDEF', ['ID_', 'KEY_', 'NAME_', 'VERSION_'], 'WHERE ID_ IN ' + inList(ids));
  return Object.fromEntries(rows.map((r) => [r.id_, { key: r.key_, name: r.name_, version: r.version_ }]));
}

// The newest root instances (not started by a call activity), newest first, optionally of one process key.
export async function listRoots(db, limit = 10, key = null) {
  const rows = await db.select('ACT_HI_PROCINST', PROC_COLS, 'WHERE SUPER_PROCESS_INSTANCE_ID_ IS NULL');
  const defs = await fetchDefs(db, rows.map((r) => r.proc_def_id_));
  for (const r of rows) {
    r.key = defs[r.proc_def_id_]?.key ?? null;
    r.start_ms = parseTs(r.start_time_);
  }
  return rows
    .filter((r) => !key || r.key === key)
    .sort((a, b) => (b.start_ms || 0) - (a.start_ms || 0))
    .slice(0, limit);
}

export async function fetchRun(db, rootId) {
  const procs = {};
  const order = [];
  let frontier = [rootId];
  while (frontier.length) {
    for (const r of await db.select('ACT_HI_PROCINST', PROC_COLS, 'WHERE ID_ IN ' + inList(frontier))) {
      procs[r.id_] = r;
      order.push(r.id_);
    }
    const kids = await db.select('ACT_HI_PROCINST', PROC_COLS, 'WHERE SUPER_PROCESS_INSTANCE_ID_ IN ' + inList(frontier));
    frontier = [...new Set(kids.filter((r) => !procs[r.id_]).map((r) => r.id_))].sort();
  }
  if (!procs[rootId]) throw new RunError(`process instance ${rootId} not found`);
  const ids = Object.keys(procs);
  const defs = await fetchDefs(db, Object.values(procs).map((p) => p.proc_def_id_));
  const acts = await db.select('ACT_HI_ACTINST', ACT_COLS, 'WHERE PROC_INST_ID_ IN ' + inList(ids));
  const vars = await db.select('ACT_HI_VARINST', VAR_COLS, 'WHERE PROC_INST_ID_ IN ' + inList(ids));

  const blobIds = [...new Set(vars.map((v) => v.bytearray_id_).filter(Boolean))].sort();
  const blobs = {};
  const warnings = [];
  if (blobIds.length) {
    try {
      for (const r of await db.select('ACT_GE_BYTEARRAY', ['ID_', base64Column(db.engine, 'BYTES_')], 'WHERE ID_ IN ' + inList(blobIds))) {
        if (r.bytes_b64) blobs[r.id_] = new Uint8Array(Buffer.from(r.bytes_b64, 'base64'));
      }
    } catch (e) {
      warnings.push(`could not read serialized variables: ${e.message}`);
    }
  }

  let dmnRows = [];
  const dmnKeys = {};
  try {
    dmnRows = await db.select('ACT_DMN_HI_DECISION_EXECUTION', DMN_COLS, 'WHERE INSTANCE_ID_ IN ' + inList(ids));
    const defIds = [...new Set(dmnRows.map((r) => r.decision_definition_id_).filter(Boolean))].sort();
    if (defIds.length) for (const r of await db.select('ACT_DMN_DECISION', ['ID_', 'KEY_'], 'WHERE ID_ IN ' + inList(defIds))) dmnKeys[r.id_] = r.key_;
  } catch (e) {
    warnings.push(`DMN history not available (${String(e.message).split('\n')[0]}). Rule hits will be missing.`);
  }

  const run = buildRun(rootId, order, procs, defs, acts, vars, blobs, dmnRows, dmnKeys);
  run.warnings = warnings;
  return run;
}

function buildRun(rootId, order, procs, defs, acts, vars, blobs, dmnRows, dmnKeys) {
  const run = { rootInstanceId: rootId, fetchedAt: iso(Date.now()), instances: [] };
  for (const pid of order) {
    const p = procs[pid];
    const d = defs[p.proc_def_id_] || {};
    const inst = {
      instanceId: pid,
      parentInstanceId: p.super_process_instance_id_ ?? null,
      defKey: d.key ?? null,
      defName: d.name ?? null,
      defVersion: d.version ?? null,
      businessKey: p.business_key_ ?? null,
      startMs: parseTs(p.start_time_),
      endMs: parseTs(p.end_time_),
      deleteReason: p.delete_reason_ ?? null,
      activities: [],
      variables: {},
      dmn: [],
      children: {},
    };
    const mine = acts.filter((a) => a.proc_inst_id_ === pid).sort((a, b) => (parseTs(a.start_time_) || 0) - (parseTs(b.start_time_) || 0));
    for (const a of mine) {
      inst.activities.push({
        id: a.act_id_,
        name: a.act_name_ ?? null,
        type: a.act_type_ ?? null,
        startMs: parseTs(a.start_time_),
        endMs: parseTs(a.end_time_),
        deleteReason: a.delete_reason_ ?? null,
        calledInstanceId: a.call_proc_inst_id_ ?? null,
      });
      if (a.call_proc_inst_id_) inst.children[a.act_id_] = a.call_proc_inst_id_;
    }
    // process-scope variables win over execution-local ones with the same name
    const scoped = vars.filter((v) => v.proc_inst_id_ === pid).sort((a, b) => Number(a.execution_id_ === pid) - Number(b.execution_id_ === pid));
    for (const v of scoped) inst.variables[v.name_] = decodeVar(v, blobs);
    attachJsonTwins(inst.variables);
    for (const r of dmnRows) {
      if (r.instance_id_ !== pid) continue;
      let ex = {};
      try {
        ex = JSON.parse(r.execution_json_ || '{}') || {};
      } catch {
        ex = {};
      }
      inst.dmn.push(parseDmnExecution(r, ex, dmnKeys));
    }
    run.instances.push(inst);
  }
  return run;
}

// Rule hits out of Flowable's DMN audit JSON, defensively: the shape differs between versions.
export function parseDmnExecution(row, ex, dmnKeys) {
  const ruleExecs = ex.ruleExecutions;
  let items = [];
  if (Array.isArray(ruleExecs)) items = ruleExecs.map((r, i) => [String(i + 1), r]);
  else if (ruleExecs && typeof ruleExecs === 'object') items = Object.entries(ruleExecs);
  const hits = [];
  for (const [k, r] of items) {
    if (!r || typeof r !== 'object') continue;
    const concl = r.conclusionResults || r.outputResults;
    const hasConcl = Array.isArray(concl) ? concl.length > 0 : Boolean(concl);
    if (r.valid === true || ((r.valid === undefined || r.valid === null) && hasConcl)) {
      const n = Number.parseInt(r.ruleNumber ?? k, 10);
      if (Number.isFinite(n)) hits.push(n);
    }
  }
  return {
    activityId: row.activity_id_ ?? null,
    key: ex.decisionKey || dmnKeys[row.decision_definition_id_] || null,
    hitPolicy: ex.hitPolicy ?? null,
    failed: ['true', 't', '1'].includes(String(row.failed_).toLowerCase()),
    error: ex.exceptionMessage ?? null,
    inputs: ex.inputVariables ?? null,
    result: ex.decisionResult ?? null,
    hitRules: [...new Set(hits)].sort((a, b) => a - b),
    startMs: parseTs(row.start_time_),
    endMs: parseTs(row.end_time_),
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// What the viewer draws

export function statusOf(inst) {
  if (inst.deleteReason) return 'CANCELED';
  return inst.endMs === null || inst.endMs === undefined ? 'RUNNING' : 'COMPLETED';
}

export function outcomeOf(inst) {
  for (const name of ['decisionResult', 'bauDecisionResult', 'challengerDecisionResult']) {
    const v = inst.variables[name];
    if (v && typeof v === 'object' && v.outcome) return { from: name, outcome: v.outcome, offerAttributes: v.offerAttributes ?? null };
  }
  return null;
}

export const durationOf = (inst) => (inst.endMs && inst.startMs ? inst.endMs - inst.startMs : null);

// Sequence flows are not in history. A flow counts as taken when both ends ran and the target started after the source did.
export function instanceOverlay(inst, flows, childPages = {}) {
  const activities = {};
  for (const a of inst.activities) {
    const e = (activities[a.id] ??= { count: 0, state: 'done', durationMs: 0, runs: [], firstStart: a.startMs, name: a.name, type: a.type });
    e.count++;
    const dur = a.endMs && a.startMs ? a.endMs - a.startMs : null;
    e.durationMs += dur || 0;
    e.runs.push({ startMs: a.startMs, endMs: a.endMs, durationMs: dur });
    if (a.endMs === null || a.endMs === undefined) e.state = 'active';
    if (a.deleteReason && !a.deleteReason.includes('completed')) e.state = 'failed';
  }
  const dmn = {};
  for (const d of inst.dmn) {
    if (!d.activityId) continue;
    dmn[d.activityId] = d;
    if (d.failed && activities[d.activityId]) activities[d.activityId].state = 'failed';
  }
  const taken = [];
  for (const [id, source, target] of flows) {
    const s = activities[source];
    const t = activities[target];
    if (!s || !t) continue;
    if (t.runs.some((r) => r.startMs && s.firstStart && r.startMs >= s.firstStart)) taken.push(id);
  }
  const children = {};
  for (const [act, instId] of Object.entries(inst.children)) if (childPages[instId]) children[act] = childPages[instId];
  return { activities, flows: taken, dmn, children };
}

// ---------------------------------------------------------------------------------------------------------------------
// BPMN text helpers (regex only, so they run anywhere)

const tagAttrs = (tag) => Object.fromEntries([...tag.matchAll(/([\w:.-]+)\s*=\s*"([^"]*)"/g)].map((m) => [m[1], m[2]]));

// [[id, sourceRef, targetRef]] of every sequence flow
export function bpmnFlows(text) {
  const flows = [];
  for (const m of text.matchAll(/<(?:[\w.-]+:)?sequenceFlow\b[^>]*>/g)) {
    const a = tagAttrs(m[0]);
    if (a.id) flows.push([a.id, a.sourceRef, a.targetRef]);
  }
  return flows;
}

// ids of the <process> elements of a BPMN text
export function bpmnProcessIds(text) {
  const ids = [];
  for (const m of text.matchAll(/<(?:[\w.-]+:)?process\b[^>]*>/g)) {
    const id = tagAttrs(m[0]).id;
    if (id) ids.push(id);
  }
  return ids;
}

// ---------------------------------------------------------------------------------------------------------------------
// Connection

export const DEFAULTS = { engine: 'mysql', user: 'flowable', database: 'flowable', password: 'flowable', dockerPath: 'docker' };

// argv (and extra environment) of the command that reads SQL on stdin and prints plain rows
export function clientCommand({ engine, container, user, database, password, dockerPath, dbCommand }) {
  if (dbCommand && dbCommand.trim()) {
    const argv = dbCommand.match(/"[^"]*"|'[^']*'|\S+/g).map((s) => s.replace(/^(["'])(.*)\1$/, '$2'));
    return { argv, display: dbCommand };
  }
  if (!container) throw new RunError('no database container configured (run "Flowable: Configure Database Connection")');
  const base = [dockerPath || 'docker', 'exec', '-i'];
  let argv;
  if (engine === 'postgres') {
    if (password) base.push('-e', 'PGPASSWORD=' + password);
    argv = [...base, container, 'psql', '-U', user, '-d', database, '-v', 'ON_ERROR_STOP=1', '-At'];
  } else {
    if (password) base.push('-e', 'MYSQL_PWD=' + password);
    argv = [...base, container, 'mysql', '-u', user, '-N', '-B', '-r', database];
  }
  return { argv, display: argv.map((a) => (password && a.endsWith('=' + password) ? a.replace(password, '***') : a)).join(' ') };
}
