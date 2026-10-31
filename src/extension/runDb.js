const { spawn } = require('child_process');
const { clientCommand, createDb, RunError, DEFAULTS } = require('../core/runHistory.mjs');

const TIMEOUT_MS = 30000;

// Runs `argv` with `sql` on stdin and resolves with what it printed.
function execSql(argv, sql) {
  return new Promise((resolve, reject) => {
    const child = spawn(argv[0], argv.slice(1), { windowsHide: true });
    let out = '';
    let err = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new RunError(`database command timed out after ${TIMEOUT_MS / 1000}s`));
    }, TIMEOUT_MS);
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(new RunError(e.code === 'ENOENT' ? `cannot start "${argv[0]}" (is the Docker CLI installed and on PATH?)` : e.message));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(out);
      else reject(new RunError((err || out).trim().slice(0, 600) || `database command exited with ${code}`));
    });
    child.stdin.on('error', () => {}); // the process died early; its exit reports why
    child.stdin.end(sql);
  });
}

// Reads the connection from the settings (+ password) and gives a read-only `db` for core/runHistory.mjs.
function openDb(config, password, log) {
  const settings = {
    engine: config.get('engine') || DEFAULTS.engine,
    container: config.get('container') || '',
    user: config.get('dbUser') || DEFAULTS.user,
    database: config.get('dbName') || DEFAULTS.database,
    dockerPath: config.get('dockerPath') || DEFAULTS.dockerPath,
    dbCommand: config.get('dbCommand') || '',
    password,
  };
  const { argv, display } = clientCommand(settings);
  log(`database command: ${display}`);
  return createDb(settings.engine, (sql) => execSql(argv, sql));
}

// Names of running containers whose image looks like a database, for the configure command.
async function databaseContainers(dockerPath) {
  const out = await execSql([dockerPath || 'docker', 'ps', '--format', '{{.Names}}\t{{.Image}}'], '');
  return out
    .split(/\r?\n/)
    .filter(Boolean)
    .map((l) => l.split('\t'))
    .filter(([, image]) => /mysql|mariadb|postgres/i.test(image || ''))
    .map(([name, image]) => ({ name, image, engine: /postgres/i.test(image) ? 'postgres' : 'mysql' }));
}

module.exports = { openDb, databaseContainers, execSql };
