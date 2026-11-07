const vscode = require('vscode');
const {
  listRoots, fetchRun, instanceOverlay, statusOf, durationOf, iso, bpmnFlows, bpmnProcessIds, DEFAULTS,
} = require('../core/runHistory.mjs');
const { openDb, databaseContainers } = require('./runDb.js');
const { RunPanel } = require('./runPanel.js');

const PASSWORD_KEY = 'flowableModeler.run.dbPassword';
const cfg = () => vscode.workspace.getConfiguration('flowableModeler.run');
const show = (e) => vscode.window.showErrorMessage('Flowable run: ' + (e && e.message ? e.message : String(e)));

function registerRunCommands(context, index, log) {
  const password = async () => (await context.secrets.get(PASSWORD_KEY)) || process.env.DB_PASSWORD || DEFAULTS.password;

  // Fills in the container when none is configured: the only running database container, or a pick.
  async function ensureContainer() {
    const config = cfg();
    if (config.get('host') || config.get('container') || config.get('dbCommand')) return true;
    let found;
    try {
      found = await databaseContainers(config.get('dockerPath'));
    } catch (e) {
      show(e);
      return false;
    }
    if (!found.length) {
      vscode.window.showWarningMessage('No running database container found. Run "Flowable: Configure Database Connection".');
      return false;
    }
    const pick = found.length === 1 ? found[0] : (await vscode.window.showQuickPick(found.map((f) => ({ label: f.name, description: f.image, f })), { placeHolder: 'Database container' }))?.f;
    if (!pick) return false;
    await config.update('container', pick.name, vscode.ConfigurationTarget.Global);
    await config.update('engine', pick.engine, vscode.ConfigurationTarget.Global);
    return true;
  }

  const db = async () => openDb(cfg(), await password(), log);

  async function setPassword() {
    const value = await vscode.window.showInputBox({ prompt: `Database password (empty to use the default "${DEFAULTS.password}")`, password: true, ignoreFocusOut: true });
    if (value === undefined) return false;
    if (value) await context.secrets.store(PASSWORD_KEY, value);
    else await context.secrets.delete(PASSWORD_KEY);
    return true;
  }

  async function configure() {
    const config = cfg();
    const title = 'Flowable database';
    const engine = await vscode.window.showQuickPick(['mysql', 'postgres'], { placeHolder: 'Database engine', title });
    if (!engine) return;
    const how = await vscode.window.showQuickPick(
      [
        { label: 'Direct connection', description: 'host and port, no Docker', direct: true },
        { label: 'Docker container', description: 'docker exec into a running database container', direct: false },
      ],
      { placeHolder: 'How is the database reached?', title },
    );
    if (!how) return;
    let host = '';
    let port = 0;
    let container = config.get('container');
    if (how.direct) {
      host = await vscode.window.showInputBox({ prompt: 'Database host', value: config.get('host') || 'localhost', title, ignoreFocusOut: true });
      if (!host) return;
      const text = await vscode.window.showInputBox({ prompt: 'Database port', value: String(config.get('port') || (engine === 'postgres' ? 5432 : 3306)), title, ignoreFocusOut: true, validateInput: (v) => (/^\d{1,5}$/.test(v.trim()) && Number(v) >= 1 && Number(v) <= 65535 ? null : 'A port number between 1 and 65535') });
      if (text === undefined) return;
      port = Number(text);
    } else {
      try {
        const found = (await databaseContainers(config.get('dockerPath'))).filter((f) => f.engine === engine);
        if (found.length) {
          const pick = await vscode.window.showQuickPick(found.map((f) => ({ label: f.name, description: f.image })), { placeHolder: 'Running database container', title });
          if (pick) container = pick.label;
        }
      } catch {
        /* docker not reachable: ask by hand below */
      }
      container = await vscode.window.showInputBox({ prompt: 'Docker container name', value: container, title, ignoreFocusOut: true });
      if (container === undefined) return;
    }
    const user = await vscode.window.showInputBox({ prompt: 'Database user', value: config.get('dbUser') || DEFAULTS.user, title, ignoreFocusOut: true });
    if (user === undefined) return;
    const name = await vscode.window.showInputBox({ prompt: 'Database name', value: config.get('dbName') || DEFAULTS.database, title, ignoreFocusOut: true });
    if (name === undefined) return;
    const target = vscode.ConfigurationTarget.Global;
    await config.update('engine', engine, target);
    await config.update('host', host, target);
    await config.update('port', port, target);
    if (!how.direct) await config.update('container', container, target);
    await config.update('dbUser', user, target);
    await config.update('dbName', name, target);
    if (!(await context.secrets.get(PASSWORD_KEY))) await setPassword();
    try {
      const probe = await db();
      await probe.select('ACT_HI_PROCINST', ['ID_'], 'LIMIT 1');
      vscode.window.showInformationMessage('Flowable database connection works.');
    } catch (e) {
      show(e);
    }
  }

  // BPMN files of the workspace by process id (first one wins when an id is defined twice).
  async function bpmnByProcessId() {
    const folder = (cfg().get('bpmnFolder') || '').replace(/^[\\/]+|[\\/]+$/g, '');
    const glob = folder ? `${folder}/**/*.{bpmn,bpmn20.xml}` : '**/*.{bpmn,bpmn20.xml}';
    const found = new Map();
    for (const uri of await vscode.workspace.findFiles(glob, '**/node_modules/**')) {
      const open = vscode.workspace.textDocuments.find((d) => d.uri.toString() === uri.toString());
      const text = open ? open.getText() : Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8');
      for (const id of bpmnProcessIds(text)) {
        if (found.has(id)) log(`process id ${id} is defined in several files; using ${found.get(id).uri.fsPath}`);
        else found.set(id, { uri, text });
      }
    }
    return found;
  }

  async function decisionXml(key, bpmnUri) {
    const hit = index.find(key, bpmnUri)[0];
    if (!hit) return null;
    return Buffer.from(await vscode.workspace.fs.readFile(hit.uri)).toString('utf8');
  }

  async function showRun(rootId, database) {
    const run = await fetchRun(database, rootId);
    for (const w of run.warnings) log('warning: ' + w);
    const files = await bpmnByProcessId();
    const instances = {};
    const drawable = new Set(run.instances.filter((i) => files.has(i.defKey)).map((i) => i.instanceId));
    const pages = Object.fromEntries(run.instances.map((i) => [i.instanceId, { instanceId: i.instanceId, defKey: i.defKey }]));
    const decisions = {};
    for (const inst of run.instances) {
      const file = files.get(inst.defKey);
      const base = {
        instanceId: inst.instanceId, parentInstanceId: inst.parentInstanceId, defKey: inst.defKey, defVersion: inst.defVersion,
        status: statusOf(inst), start: iso(inst.startMs), durationMs: durationOf(inst), variables: inst.variables,
        file: file ? vscode.workspace.asRelativePath(file.uri) : null,
        uri: file ? file.uri.toString() : null,
      };
      if (!file) {
        instances[inst.instanceId] = { ...base, bpmn: null, note: `no .bpmn with process id "${inst.defKey}" in the workspace` };
        continue;
      }
      const childPages = Object.fromEntries(Object.entries(pages).filter(([id]) => drawable.has(id)));
      const overlay = instanceOverlay(inst, bpmnFlows(file.text), childPages);
      const noPage = {};
      for (const [act, childId] of Object.entries(inst.children)) if (!drawable.has(childId) && pages[childId]) noPage[act] = pages[childId].defKey;
      instances[inst.instanceId] = { ...base, bpmn: file.text, overlay: { ...overlay, calledNoPage: noPage } };
      for (const d of inst.dmn) if (d.key && !(d.key in decisions)) decisions[d.key] = await decisionXml(d.key, file.uri);
    }
    const panel = new RunPanel(context, log);
    panel.open({ rootInstanceId: run.rootInstanceId, order: run.instances.map((i) => i.instanceId), instances, decisions });
  }

  const guarded = (fn) => async (...args) => {
    try {
      await fn(...args);
    } catch (e) {
      log('run error: ' + (e && e.stack ? e.stack : e));
      show(e);
    }
  };

  // Process id of the BPMN being edited: the file the command was started from (title-bar button), else the active tab
  // (the visual editor is a custom editor, so it is not the active *text* editor), else the active text editor.
  const activeProcessKey = async (uri) => {
    const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
    const target = uri instanceof vscode.Uri ? uri : input?.uri ?? vscode.window.activeTextEditor?.document.uri;
    if (!target || !/.bpmn(20.xml)?$/i.test(target.path)) return null;
    const doc = await vscode.workspace.openTextDocument(target);
    return bpmnProcessIds(doc.getText())[0] ?? null;
  };

  const reg = (id, fn) => context.subscriptions.push(vscode.commands.registerCommand(id, guarded(fn)));

  reg('flowable.configureDatabase', configure);
  reg('flowable.setDatabasePassword', async () => {
    if (await setPassword()) vscode.window.showInformationMessage('Database password saved.');
  });

  reg('flowable.visualizeLatestRun', async (uri) => {
    if (!(await ensureContainer())) return;
    const database = await db();
    const key = await activeProcessKey(uri);
    const roots = await listRoots(database, 1, key);
    if (!roots.length) {
      vscode.window.showWarningMessage(key ? `No run of process "${key}" found in the database.` : 'No process instances found in the database.');
      return;
    }
    await showRun(roots[0].id_, database);
  });

  reg('flowable.visualizeRun', async (uri) => {
    if (!(await ensureContainer())) return;
    const database = await db();
    const roots = await listRoots(database, cfg().get('listLimit') || 10, await activeProcessKey(uri));
    if (!roots.length) {
      vscode.window.showWarningMessage('No process instances found in the database.');
      return;
    }
    const pick = await vscode.window.showQuickPick(
      roots.map((r) => ({ label: r.key || '(unknown)', description: `${r.start_time_ || ''}  ${r.end_time_ ? 'done' : 'running'}`, detail: r.id_, id: r.id_ })),
      { placeHolder: 'Process run to visualize', matchOnDetail: true },
    );
    if (pick) await showRun(pick.id, database);
  });
}

module.exports = { registerRunCommands };
