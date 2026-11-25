"use strict";

const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const { backupStatus, installWindowsTask, runBackup, safeError } = require("../src/system/backup");

const arg = process.argv[2] || "";

if (arg === "--help" || arg === "-h") {
  console.log("node scripts/backup.js              backup ทันที");
  console.log("node scripts/backup.js --status     ดูชุดล่าสุด");
  console.log("node scripts/backup.js --install-task   ตั้ง Task รายวัน 04:00");
  process.exit(0);
}

if (arg === "--status") {
  console.log(JSON.stringify(backupStatus(), null, 2));
  process.exit(0);
}

if (arg === "--install-task") {
  try {
    const result = installWindowsTask();
    console.log("ตั้ง Task " + result.task + " ทุกวันเวลา " + result.at);
    console.log(result.command);
    if (result.output) console.log(result.output);
    process.exit(0);
  } catch (err) {
    console.error(safeError(err));
    process.exit(1);
  }
}

runBackup({ reason: "cli" })
  .then((result) => {
    if (result && result.skipped) {
      console.error("ข้าม backup: " + result.reason);
      process.exit(1);
      return;
    }
    console.log("backup แล้ว " + result.id);
    console.log("ที่เก็บ: " + result.dir);
    console.log("database " + result.dumpPretty + " · uploads " + result.uploadsPretty);
    if (result.pruned && result.pruned.length) {
      console.log("ลบชุดเก่า: " + result.pruned.join(", "));
    }
  })
  .catch((err) => {
    console.error(safeError(err));
    process.exit(1);
  });
