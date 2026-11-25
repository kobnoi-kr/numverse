"use strict";

const path = require("path");
const fs = require("fs");
const { spawnSync, spawn } = require("child_process");

function settings() {
  return {
    dataDir: process.env.EMBEDDED_PG_DIR || "C:\\Users\\Public\\numverse-pg",
    port: Number(process.env.EMBEDDED_PG_PORT || 54329),
    user: process.env.EMBEDDED_PG_USER || "postgres",
    password: process.env.EMBEDDED_PG_PASSWORD || "numverse",
    dbName: process.env.EMBEDDED_PG_DATABASE || "numverse",
    osUser: process.env.EMBEDDED_PG_OS_USER || "numversepg",
    osPassword: process.env.EMBEDDED_PG_OS_PASSWORD || ""
  };
}

function connectionUrl(cfg) {
  const c = cfg || settings();
  return (
    "postgresql://" +
    encodeURIComponent(c.user) +
    ":" +
    encodeURIComponent(c.password) +
    "@127.0.0.1:" +
    c.port +
    "/" +
    encodeURIComponent(c.dbName) +
    "?schema=public"
  );
}

function nativeBinDir() {
  // Prefer ASCII-only path — project folder name can break PowerShell quoting
  const preferred = process.env.EMBEDDED_PG_BIN || "C:\\Users\\Public\\numverse-native\\bin";
  if (fs.existsSync(path.join(preferred, "pg_ctl.exe"))) return preferred;
  return path.join(
    __dirname,
    "..",
    "node_modules",
    "@embedded-postgres",
    "windows-x64",
    "native",
    "bin"
  );
}

function prepareDataDir(dataDir, osUser) {
  fs.mkdirSync(dataDir, { recursive: true });
  if (osUser) {
    spawnSync("icacls", [dataDir, "/grant", osUser + ":(OI)(CI)F", "/T"], {
      stdio: "ignore",
      windowsHide: true
    });
  }
}

function psEscape(s) {
  return String(s).replace(/'/g, "''");
}

function runAsOsUser(cfg, filePath, args, opts = {}) {
  if (!cfg.osPassword) {
    throw new Error("EMBEDDED_PG_OS_PASSWORD is required to start Postgres on Windows admin accounts");
  }
  const workDir = opts.cwd || path.dirname(filePath);
  const argList = args.map((a) => "'" + psEscape(a) + "'").join(",");
  const script = [
    "$ErrorActionPreference='Stop'",
    "$pass=ConvertTo-SecureString '" + psEscape(cfg.osPassword) + "' -AsPlainText -Force",
    "$cred=New-Object System.Management.Automation.PSCredential('" + psEscape(".\\" + cfg.osUser) + "',$pass)",
    "$p=Start-Process -FilePath '" + psEscape(filePath) + "' -ArgumentList @(" + argList + ") -WorkingDirectory '" + psEscape(workDir) + "' -Credential $cred -Wait -PassThru -WindowStyle Hidden",
    "exit $p.ExitCode"
  ].join("; ");
  const res = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script], {
    encoding: "utf8",
    windowsHide: true
  });
  return res;
}

async function initialiseCluster(cfg) {
  const marker = path.join(cfg.dataDir, "PG_VERSION");
  if (fs.existsSync(marker)) return;

  console.log("Initializing embedded Postgres in " + cfg.dataDir + " …");
  const mod = require("embedded-postgres");
  const EmbeddedPostgres = mod.default || mod.EmbeddedPostgres || mod;
  const pg = new EmbeddedPostgres({
    databaseDir: cfg.dataDir,
    user: cfg.user,
    password: cfg.password,
    port: cfg.port,
    persistent: true,
    autoRehydrateSymlinks: true
  });
  await pg.initialise();

  // Ensure listen port in postgresql.conf
  const conf = path.join(cfg.dataDir, "postgresql.conf");
  if (fs.existsSync(conf)) {
    let text = fs.readFileSync(conf, "utf8");
    if (!/^port\s*=/m.test(text)) text += "\nport = " + cfg.port + "\n";
    else text = text.replace(/^port\s*=.*/m, "port = " + cfg.port);
    if (!/^listen_addresses\s*=/m.test(text)) text += "\nlisten_addresses = '127.0.0.1'\n";
    fs.writeFileSync(conf, text);
  }
}

function isListening(port) {
  const res = spawnSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-Command",
      "(Get-NetTCPConnection -State Listen -LocalPort " + port + " -ErrorAction SilentlyContinue | Measure-Object).Count"
    ],
    { encoding: "utf8", windowsHide: true }
  );
  return Number(String(res.stdout || "").trim()) > 0;
}

function ensurePortConfig(cfg) {
  const conf = path.join(cfg.dataDir, "postgresql.conf");
  if (!fs.existsSync(conf)) return;
  let text = fs.readFileSync(conf, "utf8");
  if (!/^port\s*=/m.test(text)) text += "\nport = " + cfg.port + "\n";
  else text = text.replace(/^#?\s*port\s*=.*/m, "port = " + cfg.port);
  if (!/^listen_addresses\s*=/m.test(text)) text += "\nlisten_addresses = '127.0.0.1'\n";
  else text = text.replace(/^#?\s*listen_addresses\s*=.*/m, "listen_addresses = '127.0.0.1'");
  fs.writeFileSync(conf, text);
}

function startCluster(cfg) {
  if (isListening(cfg.port)) {
    console.log("Postgres already listening on " + cfg.port);
    return;
  }
  ensurePortConfig(cfg);
  const bin = nativeBinDir();
  const pgCtl = path.join(bin, "pg_ctl.exe");
  const logFile = path.join(cfg.dataDir, "pg.log");
  console.log("Starting embedded Postgres on 127.0.0.1:" + cfg.port + " as " + cfg.osUser + " …");
  const res = runAsOsUser(cfg, pgCtl, ["-D", cfg.dataDir, "-l", logFile, "start"], {
    cwd: bin
  });
  // Wait until port is open (pg_ctl -w can hang under Start-Process -Credential)
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    if (isListening(cfg.port)) break;
    spawnSync("powershell.exe", ["-NoProfile", "-Command", "Start-Sleep -Milliseconds 400"], {
      windowsHide: true
    });
  }
  if (!isListening(cfg.port)) {
    const log = fs.existsSync(logFile) ? fs.readFileSync(logFile, "utf8").slice(-2000) : "";
    throw new Error(
      "pg_ctl start failed (code " + res.status + ")\n" +
        String(res.stderr || "") +
        "\n" +
        String(res.stdout || "") +
        "\n" +
        log
    );
  }
  console.log("Postgres is accepting connections on " + cfg.port);
}

function createDbIfNeeded(cfg) {
  const bin = nativeBinDir();
  const createdb = path.join(bin, "createdb.exe");
  const envFile = path.join(cfg.dataDir, "pgpass.conf");
  // Use psql via os user
  const res = runAsOsUser(
    cfg,
    path.join(bin, "psql.exe"),
    [
      "-h",
      "127.0.0.1",
      "-p",
      String(cfg.port),
      "-U",
      cfg.user,
      "-d",
      "postgres",
      "-tAc",
      "SELECT 1 FROM pg_database WHERE datname='" + cfg.dbName + "'"
    ],
    { cwd: bin }
  );
  const out = String(res.stdout || "").trim();
  if (out === "1") return;
  console.log("Created database " + cfg.dbName);
  const createRes = runAsOsUser(
    cfg,
    createdb,
    ["-h", "127.0.0.1", "-p", String(cfg.port), "-U", cfg.user, cfg.dbName],
    { cwd: bin }
  );
  if (createRes.status !== 0) {
    const msg = String(createRes.stderr || createRes.stdout || "");
    if (!/already exists/i.test(msg)) {
      throw new Error("createdb failed: " + msg);
    }
  }
}

async function startEmbeddedPostgres() {
  const cfg = settings();
  prepareDataDir(cfg.dataDir, cfg.osUser);
  await initialiseCluster(cfg);
  // Re-grant after init creates files
  prepareDataDir(cfg.dataDir, cfg.osUser);
  startCluster(cfg);

  await ensureAppDatabase(cfg);

  process.env.DATABASE_URL = connectionUrl(cfg);
  return {
    pg: {
      async stop() {
        const bin = nativeBinDir();
        runAsOsUser(cfg, path.join(bin, "pg_ctl.exe"), ["-D", cfg.dataDir, "stop", "-m", "fast"], { cwd: bin });
      }
    },
    url: process.env.DATABASE_URL,
    dataDir: cfg.dataDir
  };
}

async function ensureAppDatabase(cfg) {
  const { Client } = require("pg");
  const adminUrl =
    "postgresql://" +
    encodeURIComponent(cfg.user) +
    ":" +
    encodeURIComponent(cfg.password) +
    "@127.0.0.1:" +
    cfg.port +
    "/postgres";
  const client = new Client({ connectionString: adminUrl });
  await client.connect();
  try {
    const found = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [cfg.dbName]);
    if (!found.rowCount) {
      await client.query("CREATE DATABASE \"" + cfg.dbName.replace(/"/g, "") + "\"");
      console.log("Created database " + cfg.dbName);
    }
  } finally {
    await client.end();
  }
}

module.exports = { startEmbeddedPostgres, connectionUrl, settings, nativeBinDir };
