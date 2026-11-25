"use strict";

const fs = require("fs");
const net = require("net");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const { Client } = require("pg");

const PROJECT_ROOT = path.join(__dirname, "..", "..");
const LOCK_NAME = ".backup.lock";
const LOCK_STALE_MS = 3 * 60 * 60 * 1000;

let timer = null;
let bootTimer = null;

function backupRoot() {
  if (process.env.BACKUP_DIR && String(process.env.BACKUP_DIR).trim()) {
    return path.resolve(String(process.env.BACKUP_DIR).trim());
  }
  if (process.platform === "win32") return "C:\\Users\\Public\\numverse-backups";
  return path.join(os.homedir(), "numverse-backups");
}

function keepCount() {
  const n = Math.floor(Number(process.env.BACKUP_KEEP));
  if (!Number.isFinite(n)) return 14;
  return Math.min(365, Math.max(1, n));
}

function intervalHours() {
  const n = Number(process.env.BACKUP_INTERVAL_HOURS);
  if (!Number.isFinite(n) || n <= 0) return 24;
  return Math.min(24 * 14, n);
}

function enabled() {
  const v = String(process.env.BACKUP_ENABLED == null ? "1" : process.env.BACKUP_ENABLED)
    .trim()
    .toLowerCase();
  return v !== "0" && v !== "false" && v !== "no";
}

function safeError(err) {
  return String((err && err.message) || err).replace(/postgresql:\/\/\S+/gi, "postgresql://***");
}

function stamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return (
    d.getFullYear() +
    p(d.getMonth() + 1) +
    p(d.getDate()) +
    "-" +
    p(d.getHours()) +
    p(d.getMinutes()) +
    p(d.getSeconds())
  );
}

function prettyBytes(n) {
  const v = Number(n) || 0;
  if (v < 1024) return v + " B";
  if (v < 1024 * 1024) return (v / 1024).toFixed(1) + " KB";
  if (v < 1024 * 1024 * 1024) return (v / 1024 / 1024).toFixed(1) + " MB";
  return (v / 1024 / 1024 / 1024).toFixed(2) + " GB";
}

function databaseConfig() {
  let raw = process.env.DATABASE_URL;
  if (!raw && process.env.EMBEDDED_PG === "1") {
    try {
      raw = require("../../scripts/embedded-pg").connectionUrl();
    } catch {
      raw = "";
    }
  }
  if (!raw) return null;
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("DATABASE_URL ไม่ถูกต้อง");
  }
  const database = decodeURIComponent(url.pathname.replace(/^\//, "")).split("?")[0];
  if (!database) throw new Error("DATABASE_URL ไม่มีชื่อ database");
  return {
    host: url.hostname || "127.0.0.1",
    port: Number(url.port || 5432),
    user: decodeURIComponent(url.username || "postgres"),
    password: decodeURIComponent(url.password || ""),
    database,
    sslmode: url.searchParams.get("sslmode") || ""
  };
}

function assertReachable(host, port) {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host, port });
    let settled = false;
    let timerId = null;
    const finish = (err) => {
      if (settled) return;
      settled = true;
      if (timerId) clearTimeout(timerId);
      socket.destroy();
      if (err) {
        const code = err.code ? " (" + err.code + ")" : "";
        reject(new Error("Postgres ไม่ตอบที่ " + host + ":" + port + code));
      } else {
        resolve();
      }
    };
    timerId = setTimeout(() => finish(new Error("timeout")), 4000);
    socket.on("connect", () => finish());
    socket.on("error", finish);
  });
}

function quoteIdent(name) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new Error("ชื่อวัตถุในฐานข้อมูลไม่รองรับ: " + name);
  }
  return '"' + name + '"';
}

function encodeValue(value) {
  if (value instanceof Date) return { __t: "date", v: value.toISOString() };
  if (Buffer.isBuffer(value)) return { __t: "bytea", v: value.toString("base64") };
  if (typeof value === "bigint") return { __t: "bigint", v: value.toString() };
  if (Array.isArray(value)) return value.map(encodeValue);
  if (value && typeof value === "object") {
    const out = {};
    for (const key of Object.keys(value)) out[key] = encodeValue(value[key]);
    return out;
  }
  return value;
}

function decodeValue(value) {
  if (Array.isArray(value)) return value.map(decodeValue);
  if (value && typeof value === "object" && value.__t === "date") return value.v;
  if (value && typeof value === "object" && value.__t === "bytea") return Buffer.from(value.v, "base64");
  if (value && typeof value === "object" && value.__t === "bigint") return value.v;
  if (value && typeof value === "object") {
    const out = {};
    for (const key of Object.keys(value)) out[key] = decodeValue(value[key]);
    return out;
  }
  return value;
}

function bindValue(value, col) {
  if (value == null) return null;
  if (col.udtName === "json" || col.udtName === "jsonb") {
    return typeof value === "string" ? value : JSON.stringify(value);
  }
  if (col.udtName === "bytea") return Buffer.isBuffer(value) ? value : Buffer.from(value);
  return value;
}

async function openClient(cfg) {
  await assertReachable(cfg.host, cfg.port);
  const client = new Client({
    host: cfg.host,
    port: cfg.port,
    user: cfg.user,
    password: cfg.password,
    database: cfg.database,
    ssl:
      cfg.sslmode === "require" || cfg.sslmode === "verify-full" || cfg.sslmode === "verify-ca"
        ? { rejectUnauthorized: cfg.sslmode !== "require" }
        : undefined
  });
  await client.connect();
  return client;
}

async function listUserTables(client) {
  const res = await client.query(`
    SELECT c.relname AS name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND (
        (c.relkind = 'r' AND c.relispartition = false)
        OR c.relkind = 'p'
      )
    ORDER BY c.relname
  `);
  return res.rows.map((row) => row.name);
}

async function tableColumns(client, table) {
  const res = await client.query(
    `
    SELECT column_name, udt_name
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = $1
    ORDER BY ordinal_position
  `,
    [table]
  );
  return res.rows.map((row) => ({ name: row.column_name, udtName: row.udt_name }));
}

function endStream(stream) {
  return new Promise((resolve, reject) => {
    stream.on("error", reject);
    stream.end(resolve);
  });
}

async function dumpDatabase(client, dir) {
  const tables = await listUserTables(client);
  const dataDir = path.join(dir, "data");
  fs.mkdirSync(dataDir, { recursive: true });
  const described = [];
  let rows = 0;
  await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ, READ ONLY");
  try {
    for (const table of tables) {
      const columns = await tableColumns(client, table);
      const file = path.join(dataDir, table + ".ndjson");
      const stream = fs.createWriteStream(file, { encoding: "utf8" });
      let count = 0;
      await client.query(
        "DECLARE backup_cur NO SCROLL CURSOR FOR SELECT * FROM public." + quoteIdent(table)
      );
      while (true) {
        const batch = await client.query("FETCH 200 FROM backup_cur");
        if (!batch.rows.length) break;
        for (const row of batch.rows) {
          const encoded = {};
          for (const col of columns) encoded[col.name] = encodeValue(row[col.name]);
          stream.write(JSON.stringify(encoded) + "\n");
          count += 1;
        }
      }
      await client.query("CLOSE backup_cur");
      await endStream(stream);
      described.push({ name: table, columns, rows: count });
      rows += count;
    }
    const seqRes = await client.query(`
      SELECT c.relname AS name
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'S'
      ORDER BY c.relname
    `);
    const sequences = [];
    for (const seq of seqRes.rows) {
      const value = await client.query(
        "SELECT last_value, is_called FROM public." + quoteIdent(seq.name)
      );
      sequences.push({
        name: seq.name,
        lastValue: String(value.rows[0].last_value),
        isCalled: !!value.rows[0].is_called
      });
    }
    await client.query("COMMIT");
    fs.writeFileSync(path.join(dir, "tables.json"), JSON.stringify(described, null, 2));
    fs.writeFileSync(path.join(dir, "sequences.json"), JSON.stringify(sequences, null, 2));
    return { tables: described.length, rows, sequences: sequences.length };
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* connection already failed */
    }
    throw err;
  }
}

async function restoreDatabase(client, dir) {
  const tablesPath = path.join(dir, "tables.json");
  if (!fs.existsSync(tablesPath)) throw new Error("backup นี้ไม่มี tables.json");
  const tables = JSON.parse(fs.readFileSync(tablesPath, "utf8"));
  const sequences = fs.existsSync(path.join(dir, "sequences.json"))
    ? JSON.parse(fs.readFileSync(path.join(dir, "sequences.json"), "utf8"))
    : [];
  await client.query("BEGIN");
  try {
    await client.query("SET LOCAL session_replication_role = replica");
    if (tables.length) {
      const list = tables.map((table) => "public." + quoteIdent(table.name)).join(", ");
      await client.query("TRUNCATE " + list + " RESTART IDENTITY CASCADE");
    }
    let rows = 0;
    for (const table of tables) {
      const file = path.join(dir, "data", table.name + ".ndjson");
      if (!fs.existsSync(file)) continue;
      const lines = fs.readFileSync(file, "utf8").split(/\n/).filter(Boolean);
      const cols = table.columns || [];
      const colSql = cols.map((col) => quoteIdent(col.name)).join(", ");
      for (let i = 0; i < lines.length; i += 100) {
        const chunk = lines.slice(i, i + 100).map((line) => decodeValue(JSON.parse(line)));
        const params = [];
        const tuples = [];
        for (const row of chunk) {
          const placeholders = [];
          for (const col of cols) {
            params.push(bindValue(row[col.name], col));
            placeholders.push("$" + params.length);
          }
          tuples.push("(" + placeholders.join(", ") + ")");
          rows += 1;
        }
        if (!tuples.length) continue;
        await client.query(
          "INSERT INTO public." + quoteIdent(table.name) + " (" + colSql + ") VALUES " + tuples.join(", "),
          params
        );
      }
    }
    for (const seq of sequences) {
      await client.query("SELECT setval($1::regclass, $2::bigint, $3)", [
        "public." + quoteIdent(seq.name),
        seq.lastValue,
        !!seq.isCalled
      ]);
    }
    await client.query("COMMIT");
    return { tables: tables.length, rows };
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* ignore */
    }
    throw err;
  }
}

function dirSize(root) {
  let total = 0;
  if (!fs.existsSync(root)) return 0;
  const stack = [root];
  while (stack.length) {
    const cur = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(cur, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const ent of entries) {
      const p = path.join(cur, ent.name);
      if (ent.isDirectory()) stack.push(p);
      else if (ent.isFile()) {
        try {
          total += fs.statSync(p).size;
        } catch {
          /* skip unreadable files */
        }
      }
    }
  }
  return total;
}

function lockPath() {
  return path.join(backupRoot(), LOCK_NAME);
}

function pidAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err && err.code === "EPERM";
  }
}

function readLock() {
  try {
    return JSON.parse(fs.readFileSync(lockPath(), "utf8"));
  } catch {
    return null;
  }
}

function acquireLock() {
  fs.mkdirSync(backupRoot(), { recursive: true });
  const payload = JSON.stringify({ pid: process.pid, at: new Date().toISOString() });
  try {
    const fd = fs.openSync(lockPath(), "wx");
    fs.writeFileSync(fd, payload);
    fs.closeSync(fd);
    return true;
  } catch (err) {
    if (err.code !== "EEXIST") throw err;
    const info = readLock();
    const age = info && info.at ? Date.now() - Date.parse(info.at) : LOCK_STALE_MS + 1;
    if (info && pidAlive(info.pid) && age < LOCK_STALE_MS) return false;
    fs.rmSync(lockPath(), { force: true });
    const fd = fs.openSync(lockPath(), "wx");
    fs.writeFileSync(fd, payload);
    fs.closeSync(fd);
    return true;
  }
}

function releaseLock() {
  const info = readLock();
  if (info && info.pid && info.pid !== process.pid) return;
  fs.rmSync(lockPath(), { force: true });
}

function readManifest(dir) {
  try {
    const data = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8"));
    if (!data || typeof data !== "object") return null;
    return data;
  } catch {
    return null;
  }
}

function listBackups() {
  const root = backupRoot();
  if (!fs.existsSync(root)) return [];
  const out = [];
  for (const name of fs.readdirSync(root)) {
    if (name.startsWith(".")) continue;
    if (name === "run-backup.cmd") continue;
    const dir = path.join(root, name);
    let st;
    try {
      st = fs.statSync(dir);
    } catch {
      continue;
    }
    if (!st.isDirectory()) continue;
    const manifest = readManifest(dir);
    out.push({
      id: name,
      dir,
      createdAt: (manifest && manifest.createdAt) || st.mtime.toISOString(),
      ok: !!(manifest && manifest.ok),
      dumpBytes: (manifest && manifest.dumpBytes) || 0,
      uploadsBytes: (manifest && manifest.uploadsBytes) || 0,
      rows: (manifest && manifest.rows) || 0,
      envCopied: !!(manifest && manifest.envCopied),
      reason: (manifest && manifest.reason) || ""
    });
  }
  out.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
  return out;
}

function latestBackup() {
  const rows = listBackups().filter((row) => row.ok);
  return rows[0] || null;
}

function pruneBackups() {
  const keep = keepCount();
  const rows = listBackups();
  const removed = [];
  const good = rows.filter((row) => row.ok);
  for (const row of good.slice(keep)) {
    fs.rmSync(row.dir, { recursive: true, force: true });
    removed.push(row.id);
  }
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  for (const row of rows) {
    if (row.ok) continue;
    if (Date.parse(row.createdAt) > cutoff) continue;
    fs.rmSync(row.dir, { recursive: true, force: true });
    removed.push(row.id);
  }
  return removed;
}

function backupStatus() {
  const last = latestBackup();
  const all = listBackups();
  const lock = readLock();
  return {
    enabled: enabled(),
    dir: backupRoot(),
    keep: keepCount(),
    intervalHours: intervalHours(),
    count: all.filter((row) => row.ok).length,
    running: !!(lock && pidAlive(lock.pid)),
    last: last
      ? {
          id: last.id,
          createdAt: last.createdAt,
          dumpBytes: last.dumpBytes,
          dumpPretty: prettyBytes(last.dumpBytes),
          uploadsBytes: last.uploadsBytes,
          uploadsPretty: prettyBytes(last.uploadsBytes),
          rows: last.rows,
          envCopied: last.envCopied,
          reason: last.reason
        }
      : null
  };
}

function shouldRunScheduled() {
  if (!enabled()) return false;
  if (!process.env.DATABASE_URL && process.env.EMBEDDED_PG !== "1") return false;
  const last = latestBackup();
  if (!last) return true;
  const age = Date.now() - Date.parse(last.createdAt);
  return age >= intervalHours() * 60 * 60 * 1000;
}

async function runBackup(opts = {}) {
  const reason = opts.reason || "manual";
  const cfg = databaseConfig();
  if (!cfg) throw new Error("ไม่มี DATABASE_URL — ยัง backup ไม่ได้");
  if (!acquireLock()) return { ok: false, skipped: true, reason: "locked" };

  const id = stamp();
  const dir = path.join(backupRoot(), id);
  fs.mkdirSync(dir, { recursive: true });
  let client = null;
  try {
    client = await openClient(cfg);
    const dumped = await dumpDatabase(client, dir);

    const uploadsSrc = path.join(PROJECT_ROOT, "public", "uploads");
    let uploadsBytes = 0;
    let uploadsCopied = false;
    if (fs.existsSync(uploadsSrc)) {
      fs.cpSync(uploadsSrc, path.join(dir, "uploads"), { recursive: true, force: true });
      uploadsBytes = dirSize(path.join(dir, "uploads"));
      uploadsCopied = true;
    }

    const envSrc = path.join(PROJECT_ROOT, ".env");
    let envCopied = false;
    if (fs.existsSync(envSrc)) {
      fs.copyFileSync(envSrc, path.join(dir, "env.bak"));
      envCopied = true;
    }

    const dumpBytes = dirSize(path.join(dir, "data")) + dirSize(path.join(dir, "tables.json"));
    const manifest = {
      id,
      createdAt: new Date().toISOString(),
      ok: true,
      reason,
      format: "ndjson-v1",
      database: cfg.database,
      host: cfg.host,
      port: cfg.port,
      tables: dumped.tables,
      rows: dumped.rows,
      sequences: dumped.sequences,
      dumpBytes,
      uploadsBytes,
      uploadsCopied,
      envCopied,
      node: process.version
    };
    fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(manifest, null, 2));
    const pruned = pruneBackups();
    return {
      ok: true,
      id,
      dir,
      rows: dumped.rows,
      tables: dumped.tables,
      dumpBytes,
      dumpPretty: prettyBytes(dumpBytes),
      uploadsBytes,
      uploadsPretty: prettyBytes(uploadsBytes),
      envCopied,
      pruned
    };
  } catch (err) {
    try {
      fs.writeFileSync(
        path.join(dir, "manifest.json"),
        JSON.stringify(
          {
            id,
            createdAt: new Date().toISOString(),
            ok: false,
            reason,
            error: safeError(err)
          },
          null,
          2
        )
      );
    } catch {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    throw err;
  } finally {
    if (client) {
      try {
        await client.end();
      } catch {
        /* ignore */
      }
    }
    releaseLock();
  }
}

function resolveBackupDir(id) {
  if (!id || !/^[\w.-]+$/.test(id)) throw new Error("รหัส backup ไม่ถูกต้อง");
  const root = path.resolve(backupRoot());
  const dir = path.resolve(root, id);
  const rel = path.relative(root, dir);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) throw new Error("รหัส backup ไม่ถูกต้อง");
  if (!fs.existsSync(path.join(dir, "manifest.json"))) throw new Error("ไม่พบ backup " + id);
  return dir;
}

async function restoreBackup(id, opts = {}) {
  if (!opts.yes) throw new Error("ต้องยืนยันด้วย --yes");
  const cfg = databaseConfig();
  if (!cfg) throw new Error("ไม่มี DATABASE_URL — ยัง restore ไม่ได้");
  const dir = resolveBackupDir(id);
  const manifest = readManifest(dir);
  if (!manifest || manifest.ok === false) throw new Error("backup นี้ใช้กู้คืนไม่ได้");
  if (!acquireLock()) return { ok: false, skipped: true, reason: "locked" };
  let client = null;
  try {
    client = await openClient(cfg);
    const restored = await restoreDatabase(client, dir);

    const uploadsSrc = path.join(dir, "uploads");
    let uploadsRestored = false;
    if (fs.existsSync(uploadsSrc)) {
      fs.cpSync(uploadsSrc, path.join(PROJECT_ROOT, "public", "uploads"), { recursive: true, force: true });
      uploadsRestored = true;
    }

    let envRestored = false;
    if (opts.withEnv) {
      const envBak = path.join(dir, "env.bak");
      if (!fs.existsSync(envBak)) throw new Error("backup นี้ไม่มี env.bak");
      fs.copyFileSync(envBak, path.join(PROJECT_ROOT, ".env"));
      envRestored = true;
    }

    return {
      ok: true,
      id,
      rows: restored.rows,
      tables: restored.tables,
      uploadsRestored,
      envRestored
    };
  } finally {
    if (client) {
      try {
        await client.end();
      } catch {
        /* ignore */
      }
    }
    releaseLock();
  }
}

function installWindowsTask() {
  if (process.platform !== "win32") {
    throw new Error("ติดตั้ง Task Scheduler ได้บน Windows เท่านั้น");
  }
  const root = backupRoot();
  fs.mkdirSync(root, { recursive: true });
  const cmdPath = path.join(root, "run-backup.cmd");
  const nodeExe = process.execPath;
  const script = path.join(PROJECT_ROOT, "scripts", "backup.js");
  fs.writeFileSync(cmdPath, "@echo off\r\n\"" + nodeExe + "\" \"" + script + "\"\r\n");
  const created = spawnSync(
    "schtasks",
    [
      "/Create",
      "/F",
      "/TN",
      "NumverseBackup",
      "/SC",
      "DAILY",
      "/ST",
      "04:00",
      "/RU",
      "SYSTEM",
      "/RL",
      "HIGHEST",
      "/TR",
      cmdPath
    ],
    { encoding: "utf8", windowsHide: true }
  );
  if (created.status !== 0) {
    throw new Error("schtasks ล้มเหลว: " + (created.stderr || created.stdout || "exit " + created.status));
  }
  return {
    ok: true,
    task: "NumverseBackup",
    at: "04:00",
    command: cmdPath,
    output: String(created.stdout || "").trim()
  };
}

function startBackupScheduler() {
  if (timer || bootTimer) return;
  if (!enabled()) {
    console.log("[backup] disabled (BACKUP_ENABLED=0)");
    return;
  }
  if (!process.env.DATABASE_URL && process.env.EMBEDDED_PG !== "1") {
    console.log("[backup] no DATABASE_URL — scheduler idle");
    return;
  }
  const tick = () => {
    if (!shouldRunScheduled()) return;
    runBackup({ reason: "schedule" })
      .then((result) => {
        if (result && result.ok) {
          console.log("[backup] saved " + result.id + " (" + result.dumpPretty + ", " + result.rows + " rows)");
        } else if (result && result.skipped) {
          console.log("[backup] skipped: " + result.reason);
        }
      })
      .catch((err) => {
        console.error("[backup] failed:", safeError(err));
      });
  };
  bootTimer = setTimeout(tick, 90 * 1000);
  timer = setInterval(tick, 30 * 60 * 1000);
  if (bootTimer.unref) bootTimer.unref();
  if (timer.unref) timer.unref();
  console.log(
    "[backup] scheduler on → " + backupRoot() + " (every " + intervalHours() + "h, keep " + keepCount() + ")"
  );
}

module.exports = {
  backupRoot,
  backupStatus,
  installWindowsTask,
  listBackups,
  prettyBytes,
  restoreBackup,
  runBackup,
  safeError,
  startBackupScheduler
};
