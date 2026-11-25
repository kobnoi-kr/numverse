import { api } from "/js/dashboard/api.js";
import { esc, confirmDialog } from "./util.js";

function mb(n) {
  return Math.round((Number(n) || 0) / 1024 / 1024);
}

export async function renderSystem(root, { user }) {
  root.innerHTML = `<div class="loading">Loading…</div>`;
  const { res, data } = await api("/api/v1/admin/system", { method: "GET" });
  if (!res.ok) {
    root.innerHTML = `<div class="empty">โหลดไม่ได้</div>`;
    return;
  }
  const isSuper = (user.roles || []).includes("super_admin");
  const rooms = data.rooms || {};
  const db = data.db || {};
  const dbPct = Math.max(0, Math.min(100, Number(db.pct) || 0));
  const dbLevel = db.level || "ok";
  root.innerHTML = `
    <div class="stats-row">
      <div class="stat"><div class="label">Uptime</div><div class="value">${Math.floor((data.uptimeSec || 0) / 60)}m</div></div>
      <div class="stat"><div class="label">Node</div><div class="value" style="font-size:1rem">${esc(data.node)}</div></div>
      <div class="stat"><div class="label">Heap</div><div class="value">${mb(data.memory && data.memory.heapUsed)} MB</div></div>
      <div class="stat"><div class="label">Rooms</div><div class="value">${rooms.rooms || 0}</div><div class="tiny">${rooms.players || 0} players</div></div>
    </div>
    <div class="card db-meter" style="margin-top:16px">
      <div class="db-meter-head">
        <h2>Database storage</h2>
        <span class="db-meter-badge level-${esc(dbLevel)}">${esc(db.usedPretty || "—")} / ${esc(db.limitPretty || "—")}</span>
      </div>
      <div class="db-meter-track" role="meter" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${dbPct}">
        <div class="db-meter-fill level-${esc(dbLevel)}" style="width:${dbPct}%"></div>
      </div>
      <div class="db-meter-meta">
        <span>${db.ok === false ? "อ่านขนาดไม่ได้" : dbPct + "% ของขีดจำกัด"}</span>
        <span class="tiny">ตั้งค่าขีดจำกัดได้ที่ Settings</span>
      </div>
    </div>
    <div class="card" style="margin-top:16px">
      <h2>Guest &amp; Session Cleanup</h2>
      <p class="muted" id="sysCleanStats">กำลังโหลดสถิติ…</p>
      <button type="button" class="btn sm" id="sysCleanRun">รัน Cleanup ตอนนี้</button>
      <p class="tiny" id="sysCleanMsg">ตั้งค่าละเอียดได้ที่เมนู Settings</p>
    </div>
    <div class="card" style="margin-top:16px">
      <h2>Auto Backup</h2>
      <p class="muted" id="sysBackupStats">กำลังโหลด…</p>
      <button type="button" class="btn sm" id="sysBackupRun">Backup ตอนนี้</button>
      <p class="tiny" id="sysBackupMsg">เก็บไว้บนเครื่องนี้ · รันอัตโนมัติเมื่อครบกำหนด และมี Task รายวันตอน 04:00</p>
    </div>
    <div class="card" style="margin-top:16px">
      <h2>Danger zone</h2>
      <p class="muted">ลบ session ที่หมดอายุหรือถูก revoke แล้ว</p>
      <button type="button" class="btn danger sm" id="sysClear" ${isSuper ? "" : "disabled"}>Clear expired sessions</button>
      <p class="tiny" id="sysMsg">${isSuper ? "" : "ต้องเป็น super_admin"}</p>
    </div>
  `;

  const statsEl = root.querySelector("#sysCleanStats");
  const cleanMsg = root.querySelector("#sysCleanMsg");
  const cleanRun = root.querySelector("#sysCleanRun");
  async function loadCleanStats() {
    const r = await api("/api/v1/admin/system/cleanup", { method: "GET" });
    if (!r.res.ok || !statsEl) return;
    const last = r.data.lastRun;
    const lastText = last && last.at
      ? `รันล่าสุด ${new Date(last.at).toLocaleString("th-TH")}`
      : "ยังไม่เคยรัน";
    statsEl.textContent =
      `Guest ${r.data.guestTotal || 0} · ค้างรอลบ ${r.data.staleGuests || 0} · session หมดอายุ ${r.data.expiredSessions || 0}` +
      ` · activity ${r.data.activityTotal || 0} (หมดอายุ ${r.data.activityExpired || 0}) · ${lastText}`;
  }
  loadCleanStats();

  const backupStats = root.querySelector("#sysBackupStats");
  const backupMsg = root.querySelector("#sysBackupMsg");
  const backupRun = root.querySelector("#sysBackupRun");
  async function loadBackupStats() {
    const r = await api("/api/v1/admin/system/backup", { method: "GET" });
    if (!r.res.ok || !backupStats) return;
    const last = r.data.last;
    const lastText = last
      ? `ล่าสุด ${new Date(last.createdAt).toLocaleString("th-TH")} · db ${last.dumpPretty} · uploads ${last.uploadsPretty}`
      : "ยังไม่เคย backup";
    backupStats.textContent =
      `${r.data.count || 0} ชุด · เก็บ ${r.data.keep} ชุดล่าสุด · ทุก ${r.data.intervalHours} ชม. · ${lastText}` +
      (r.data.running ? " · กำลัง backup" : "");
  }
  loadBackupStats();
  if (backupRun) {
    backupRun.onclick = async () => {
      if (!(await confirmDialog("Backup ฐานข้อมูลและไฟล์อัปโหลดตอนนี้?"))) return;
      backupRun.disabled = true;
      if (backupMsg) backupMsg.textContent = "กำลัง backup…";
      const r = await api("/api/v1/admin/system/backup", { method: "POST", body: "{}" });
      backupRun.disabled = false;
      if (!r.res.ok) {
        if (backupMsg) backupMsg.textContent = (r.data && r.data.message) || "backup ไม่สำเร็จ";
        return;
      }
      if (backupMsg) backupMsg.textContent = `เสร็จแล้ว · ${r.data.id} · db ${r.data.dumpPretty}`;
      loadBackupStats();
    };
  }

  if (cleanRun) {
    cleanRun.onclick = async () => {
      if (!(await confirmDialog("รัน cleanup ตอนนี้?"))) return;
      cleanRun.disabled = true;
      if (cleanMsg) cleanMsg.textContent = "กำลัง cleanup…";
      const r = await api("/api/v1/admin/system/cleanup", { method: "POST", body: "{}" });
      cleanRun.disabled = false;
      if (!r.res.ok) {
        if (cleanMsg) cleanMsg.textContent = "cleanup ไม่สำเร็จ";
        return;
      }
      if (cleanMsg) {
        cleanMsg.textContent =
          `เสร็จแล้ว · session ${r.data.sessionsDeleted || 0} · guest ${r.data.guestsDeleted || 0} · activity ${r.data.activityDeleted || 0}`;
      }
      loadCleanStats();
    };
  }

  const btn = root.querySelector("#sysClear");
  if (btn && isSuper) {
    btn.onclick = async () => {
      if (!(await confirmDialog("ลบ expired/revoked sessions?", { danger: true }))) return;
      const r = await api("/api/v1/admin/system/clear-sessions", { method: "POST", body: "{}" });
      root.querySelector("#sysMsg").textContent = r.res.ok
        ? `ลบแล้ว ${r.data.deleted || 0} รายการ`
        : "ล้มเหลว";
    };
  }
}
