"use strict";

const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const { listBackups, prettyBytes, restoreBackup, safeError } = require("../src/system/backup");

const args = process.argv.slice(2);
const withEnv = args.includes("--with-env");
const yes = args.includes("--yes");
const id = args.find((arg) => !arg.startsWith("--"));

if (!id || args.includes("--list") || args.includes("--help")) {
  const rows = listBackups().filter((row) => row.ok);
  if (!rows.length) console.log("ยังไม่มี backup");
  for (const row of rows) {
    console.log(
      row.id +
        "  " +
        row.createdAt +
        "  db " +
        prettyBytes(row.dumpBytes) +
        "  uploads " +
        prettyBytes(row.uploadsBytes)
    );
  }
  console.log("");
  console.log("กู้คืน: node scripts/restore-backup.js <id> --yes");
  console.log("รวม .env: เติม --with-env");
  console.log("หยุดเซิร์ฟเวอร์ก่อนกู้คืน จะเขียนทับข้อมูลปัจจุบัน");
  process.exit(id ? 0 : 1);
}

restoreBackup(id, { yes, withEnv })
  .then((result) => {
    if (result && result.skipped) {
      console.error("ข้าม restore: " + result.reason);
      process.exit(1);
      return;
    }
    console.log("กู้คืนแล้ว " + result.id);
    console.log("uploads: " + (result.uploadsRestored ? "เขียนกลับแล้ว" : "ไม่มีในชุดนี้"));
    console.log("env: " + (result.envRestored ? "เขียนกลับแล้ว" : "ไม่ได้แตะ .env"));
    if (result.warnings) console.log(result.warnings);
  })
  .catch((err) => {
    console.error(safeError(err));
    process.exit(1);
  });
