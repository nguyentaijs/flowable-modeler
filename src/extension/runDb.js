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

// Direct connection with a bundled driver: one short-lived read-only connection per query. The queries return their
// rows as a single JSON value, so the first cell is handed back as text, like the command-line clients print it.
async function driverSql(settings, sql) {
  const { engine, host, port, user, password, database } = settings;
  try {
    if (engine === 'postgres') {
      const { Client } = require('pg');
      const client = new Client({ host, port: port || 5432, user, password, database, connectionTimeoutMillis: 10000, statement_timeout: TIMEOUT_MS, options: '-c default_transaction_read_only=on' });
      await client.connect();
      try {
        const res = await client.query({ text: sql, rowMode: 'array' });
        const cell = res.rows[0] && res.rows[0][0];
        return typeof cell === 'string' ? cell : JSON.stringify(cell ?? []);
      } finally {
        await client.end().catch(() => {});
      }
    }
    const mysql = require('mysql2/promise');
    const conn = await mysql.createConnection({ host, port: port || 3306, user, password, database, connectTimeout: 10000, rowsAsArray: true, jsonStrings: true });
    try {
      await conn.query('SET SESSION TRANSACTION READ ONLY');
      const [rows] = await Promise.race([
        conn.query(sql),
        new Promise((_, reject) => setTimeout(() => reject(new Error(`query timed out after ${TIMEOUT_MS / 1000}s`)), TIMEOUT_MS)),
      ]);
      const cell = rows[0] && rows[0][0];
      return typeof cell === 'string' ? cell : JSON.stringify(cell ?? []);
    } finally {
      await conn.end().catch(() => {});
    }
  } catch (e) {
    throw new RunError(`${host}:${port || (engine === 'postgres' ? 5432 : 3306)}: ${e.message}`);
  }
}

// Reads the connection from the settings (+ password) and gives a read-only `db` for core/runHistory.mjs.
function openDb(config, password, log) {
  const settings = {
    host: config.get('host') || '',
    port: config.get('port') || 0,
    engine: config.get('engine') || DEFAULTS.engine,
    container: config.get('container') || '',
    user: config.get('dbUser') || DEFAULTS.user,
    database: config.get('dbName') || DEFAULTS.database,
    dockerPath: config.get('dockerPath') || DEFAULTS.dockerPath,
    dbCommand: config.get('dbCommand') || '',
    password,
  };
  if (settings.host && !settings.dbCommand) {
    log(`database: ${settings.engine}://${settings.user}@${settings.host}:${settings.port || (settings.engine === 'postgres' ? 5432 : 3306)}/${settings.database}`);
    return createDb(settings.engine, (sql) => driverSql(settings, sql));
  }
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
