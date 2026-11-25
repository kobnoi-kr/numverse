import { api } from "/js/dashboard/api.js";
import { esc, hasPerm, confirmDialog } from "./util.js";

function isMaintOn(s) {
  const msg = String(s.maintenance_message || "").trim();
  if (Object.prototype.hasOwnProperty.call(s, "maintenance_enabled")) {
    const v = s.maintenance_enabled;
    const on = v === true || v === "true" || v === 1 || v === "1";
    return on && !!msg;
  }
  return !!msg;
}

export async function renderSettings(root, { user }) {
  async function load() {
    root.innerHTML = `<div class="loading">Loading…</div>`;
    const { res, data } = await api("/api/v1/admin/settings", { method: "GET" });
    if (!res.ok) {
      root.innerHTML = `<div class="empty">โหลดไม่ได้</div>`;
      return;
    }
    const s = data.settings || {};
    const canManage = hasPerm(user, "settings.manage");
    const msg = String(s.maintenance_message || "");
    const enabled = isMaintOn(s);

    const defaultDeployMsg =
      "มีการอัปเดตระบบ กรุณาหยุดการเล่น/ออกจากห้องชั่วคราว — ระบบจะปิดปรับปรุงในไม่ช้า";

    root.innerHTML = `
      <div class="card">
        <h2>สถานะเซิร์ฟเวอร์</h2>
        <div class="row-between" style="align-items:center;gap:12px;flex-wrap:wrap;margin-top:4px">
          <div>
            <div class="status-pill ${enabled ? "warn" : "ok"}" style="font-size:0.95rem;padding:6px 12px">
              ${enabled ? "ปิดปรับปรุงอยู่" : "เซิร์ฟเปิดปกติ"}
            </div>
            <p class="tiny" style="margin:8px 0 0">
              ${
                enabled
                  ? "ผู้เล่นทั่วไปเข้าเล่นไม่ได้ — กดปุ่มเขียวเพื่อเปิดเซิร์ฟกลับ"
                  : "ผู้เล่นเข้าเล่นได้ตามปกติ — กดปุ่มส้มเพื่อปิดปรับปรุง"
              }
            </p>
          </div>
          ${
            canManage
              ? enabled
                ? `<button type="button" class="btn sm" id="sOpenServer" style="background:#16a34a;border-color:#16a34a">เปิดเซิร์ฟ</button>`
                : `<button type="button" class="btn sm" id="sCloseServer" style="background:#d97706;border-color:#d97706">ปิดเซิร์ฟ (Maintenance)</button>`
              : ""
          }
        </div>
        <p class="tiny" id="sToggleMsg" style="margin-top:10px"></p>
      </div>

      <div class="card" style="margin-top:16px">
        <h2>แจ้งเตือนก่อน Deploy</h2>
        <p class="muted" style="margin-top:0">
          กดปุ่มนี้ก่อนกด Deploy บน Render — ผู้เล่นทุกคนจะเห็น popup นับถอยหลัง
          ให้หยุดการกระทำ / ออกจากห้อง แล้วระบบจะปิดปรับปรุงอัตโนมัติ
        </p>
        <ol class="tiny" style="margin:8px 0 12px;padding-left:18px;color:var(--nv-text-2);line-height:1.55">
          <li>กด “แจ้งเตือน Deploy”</li>
          <li>รอจนนับถอยหลังจบ (ผู้เล่นถูกเตะออก)</li>
          <li>ค่อยกด Deploy บน Render</li>
          <li>หลังขึ้นแล้วกลับมาหน้านี้ กด “เปิดเซิร์ฟ”</li>
        </ol>
        <label class="tiny" style="display:block;margin-bottom:8px">เวลานับถอยหลัง (วินาที)
          <select class="input" id="sDeploySec" ${canManage && !enabled ? "" : "disabled"} style="margin-top:6px;max-width:160px">
            <option value="15">15 วินาที</option>
            <option value="30" selected>30 วินาที</option>
            <option value="60">60 วินาที</option>
            <option value="90">90 วินาที</option>
          </select>
        </label>
        ${
          canManage && !enabled
            ? `<button type="button" class="btn sm" id="sDeployWarn" style="background:#dc2626;border-color:#dc2626">แจ้งเตือน Deploy + ปิดเซิร์ฟ</button>`
            : canManage && enabled
              ? `<p class="tiny" style="color:#fcd34d;margin:0">เซิร์ฟปิดอยู่แล้ว — Deploy ได้เลย แล้วค่อยกดเปิดเซิร์ฟหลังเสร็จ</p>`
              : ""
        }
        <p class="tiny" id="sDeployMsg" style="margin-top:10px"></p>
      </div>

      <div class="card" style="margin-top:16px">
        <h2>ข้อความปิดปรับปรุง</h2>
        <p class="muted" style="margin-top:0">ข้อความนี้จะโชว์ให้ผู้เล่นตอนเซิร์ฟปิด / ตอนแจ้งเตือน Deploy</p>
        <textarea class="input" id="sMaint" rows="3" ${canManage ? "" : "disabled"} placeholder="${esc(defaultDeployMsg)}">${esc(msg)}</textarea>
        ${canManage ? `<button type="button" class="btn ghost sm" id="sSaveMsg" style="margin-top:10px">บันทึกข้อความ</button>` : ""}
        <p class="tiny" id="sMsgMsg"></p>
      </div>

      <div class="card" style="margin-top:16px">
        <h2>Max rooms display</h2>
        <p class="muted" style="margin-top:0">จำนวนห้องสูงสุดที่โชว์ในลิสต์ล็อบบี้</p>
        <input class="input" id="sMax" type="number" min="1" max="200" value="${Number(s.max_rooms_display) || 50}" ${canManage ? "" : "disabled"}/>
        ${canManage ? `<button type="button" class="btn ghost sm" id="sSaveMax" style="margin-top:10px">บันทึก</button>` : ""}
        <p class="tiny" id="sMsgMax"></p>
      </div>

      <div class="card" style="margin-top:16px">
        <h2>Guest &amp; Session Cleanup</h2>
        <p class="muted" style="margin-top:0">ลบ session หมดอายุ และ guest ที่ไม่ได้ใช้งาน เพื่อไม่ให้ฐานข้อมูลพอง</p>
        <div class="row-between" style="gap:12px;flex-wrap:wrap;margin-top:8px">
          <label class="tiny" style="display:flex;align-items:center;gap:8px">
            <input type="checkbox" id="sGuestClean" ${s.guest_cleanup_enabled === false || s.guest_cleanup_enabled === "false" ? "" : "checked"} ${canManage ? "" : "disabled"}/>
            ลบ guest ค้างอัตโนมัติ
          </label>
          <label class="tiny" style="display:flex;align-items:center;gap:8px">
            <input type="checkbox" id="sSessClean" ${s.session_cleanup_enabled === false || s.session_cleanup_enabled === "false" ? "" : "checked"} ${canManage ? "" : "disabled"}/>
            ลบ session หมดอายุอัตโนมัติ
          </label>
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px;margin-top:12px">
          <label class="tiny">Guest idle (วัน)
            <input class="input" id="sGuestIdle" type="number" min="1" max="365" value="${Number(s.guest_idle_days) || 1}" ${canManage ? "" : "disabled"}/>
          </label>
          <label class="tiny">อายุ session guest (วัน)
            <input class="input" id="sGuestSess" type="number" min="1" max="90" value="${Number(s.guest_session_days) || 1}" ${canManage ? "" : "disabled"}/>
          </label>
          <label class="tiny">รอบ cleanup (นาที)
            <input class="input" id="sCleanEvery" type="number" min="5" max="1440" value="${Number(s.cleanup_interval_minutes) || 60}" ${canManage ? "" : "disabled"}/>
          </label>
          <label class="tiny">จำกัดสร้าง guest / IP / ชม. (0=ไม่จำกัด)
            <input class="input" id="sGuestRate" type="number" min="0" max="1000" value="${Number.isFinite(Number(s.guest_create_per_ip_hour)) ? Number(s.guest_create_per_ip_hour) : 40}" ${canManage ? "" : "disabled"}/>
          </label>
          <label class="tiny">เก็บประวัติห้อง/เกม (วัน)
            <input class="input" id="sGameHistDays" type="number" min="1" max="365" value="${Number.isFinite(Number(s.game_history_retention_days)) ? Number(s.game_history_retention_days) : 30}" ${canManage ? "" : "disabled"}/>
          </label>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">
          ${canManage ? `<button type="button" class="btn ghost sm" id="sSaveClean">บันทึก Cleanup</button>` : ""}
          ${canManage ? `<button type="button" class="btn sm" id="sRunClean">รัน Cleanup ตอนนี้</button>` : ""}
        </div>
        <p class="tiny" id="sMsgClean" style="margin-top:8px"></p>
        <p class="tiny" id="sCleanStats" style="margin-top:4px;color:var(--nv-muted)"></p>
      </div>

      <div class="card" style="margin-top:16px">
        <h2>User Activity Log</h2>
        <p class="muted" style="margin-top:0">บันทึกเฉพาะ login, สร้าง/เข้าห้อง, ban, จบแมตช์ — แล้วลบของเก่าตามจำนวนวัน</p>
        <label class="tiny" style="display:flex;align-items:center;gap:8px;margin-top:8px">
          <input type="checkbox" id="sActLog" ${s.activity_log_enabled === false || s.activity_log_enabled === "false" ? "" : "checked"} ${canManage ? "" : "disabled"}/>
          เปิดบันทึก activity
        </label>
        <label class="tiny" style="display:block;margin-top:10px">เก็บ log กี่วัน
          <input class="input" id="sActDays" type="number" min="1" max="365" value="${Number.isFinite(Number(s.activity_log_retention_days)) ? Number(s.activity_log_retention_days) : 30}" ${canManage ? "" : "disabled"}/>
        </label>
        ${canManage ? `<button type="button" class="btn ghost sm" id="sSaveAct" style="margin-top:10px">บันทึก Activity Log</button>` : ""}
        <p class="tiny" id="sMsgAct" style="margin-top:8px"></p>
      </div>

      <div class="card" style="margin-top:16px">
        <h2>Database meter</h2>
        <p class="muted" style="margin-top:0">ขีดจำกัดสำหรับหลอดใน Overview (ค่าเริ่มต้น 1024 MB = Render free Postgres)</p>
        <label class="tiny" style="display:block;margin-top:10px">ขีดจำกัด DB (MB)
          <input class="input" id="sDbLimit" type="number" min="64" max="1048576" value="${Number.isFinite(Number(s.db_size_limit_mb)) ? Number(s.db_size_limit_mb) : 1024}" ${canManage ? "" : "disabled"}/>
        </label>
        ${canManage ? `<button type="button" class="btn ghost sm" id="sSaveDb" style="margin-top:10px">บันทึกขีดจำกัด DB</button>` : ""}
        <p class="tiny" id="sMsgDb" style="margin-top:8px"></p>
      </div>
    `;

    async function patchSettings(settings, msgEl) {
      if (msgEl) msgEl.textContent = "กำลังบันทึก…";
      const r = await api("/api/v1/admin/settings", {
        method: "PATCH",
        body: JSON.stringify({ settings })
      });
      return r;
    }

    const openBtn = root.querySelector("#sOpenServer");
    if (openBtn) {
      openBtn.onclick = async () => {
        openBtn.disabled = true;
        const r = await patchSettings(
          { maintenance_enabled: false },
          root.querySelector("#sToggleMsg")
        );
        if (!r.res.ok) {
          root.querySelector("#sToggleMsg").textContent = "เปิดเซิร์ฟไม่สำเร็จ";
          openBtn.disabled = false;
          return;
        }
        root.querySelector("#sToggleMsg").textContent = "เปิดเซิร์ฟแล้ว — ผู้เล่นเข้าได้ตามปกติ";
        await load();
      };
    }

    const closeBtn = root.querySelector("#sCloseServer");
    if (closeBtn) {
      closeBtn.onclick = async () => {
        const message = root.querySelector("#sMaint").value.trim() || "ระบบปิดปรับปรุงชั่วคราว กรุณากลับมาใหม่ภายหลัง";
        closeBtn.disabled = true;
        const r = await patchSettings(
          { maintenance_enabled: true, maintenance_message: message, maintenance_countdown_sec: 15 },
          root.querySelector("#sToggleMsg")
        );
        if (!r.res.ok) {
          root.querySelector("#sToggleMsg").textContent = "ปิดเซิร์ฟไม่สำเร็จ";
          closeBtn.disabled = false;
          return;
        }
        root.querySelector("#sToggleMsg").textContent =
          "ปิดเซิร์ฟแล้ว — แจ้งเตือนนับถอยหลัง 15 วิ แล้วเตะทุกคนออกจากห้อง";
        await load();
      };
    }

    const deployBtn = root.querySelector("#sDeployWarn");
    if (deployBtn) {
      deployBtn.onclick = async () => {
        const sec = Number(root.querySelector("#sDeploySec")?.value) || 30;
        const message =
          root.querySelector("#sMaint").value.trim() || defaultDeployMsg;
        if (
          !(await confirmDialog(
            `แจ้งเตือนผู้เล่นทุกคน และปิดเซิร์ฟใน ${sec} วินาที?\n\nหลังนับจบ ค่อยกด Deploy บน Render`,
            { danger: true }
          ))
        ) {
          return;
        }
        deployBtn.disabled = true;
        const r = await patchSettings(
          {
            maintenance_enabled: true,
            maintenance_message: message,
            maintenance_countdown_sec: sec
          },
          root.querySelector("#sDeployMsg")
        );
        if (!r.res.ok) {
          root.querySelector("#sDeployMsg").textContent = "แจ้งเตือนไม่สำเร็จ";
          deployBtn.disabled = false;
          return;
        }
        root.querySelector("#sDeployMsg").textContent =
          `แจ้งแล้ว — นับถอยหลัง ${sec} วิ แล้วเตะทุกคนออก จากนั้นค่อย Deploy`;
        await load();
      };
    }

    const saveMsg = root.querySelector("#sSaveMsg");
    if (saveMsg) {
      saveMsg.onclick = async () => {
        const message = root.querySelector("#sMaint").value.trim();
        const r = await patchSettings(
          { maintenance_message: message },
          root.querySelector("#sMsgMsg")
        );
        root.querySelector("#sMsgMsg").textContent = r.res.ok ? "บันทึกข้อความแล้ว" : "บันทึกไม่สำเร็จ";
      };
    }

    const saveMax = root.querySelector("#sSaveMax");
    if (saveMax) {
      saveMax.onclick = async () => {
        const r = await patchSettings(
          { max_rooms_display: Number(root.querySelector("#sMax").value) || 50 },
          root.querySelector("#sMsgMax")
        );
        root.querySelector("#sMsgMax").textContent = r.res.ok ? "บันทึกแล้ว" : "บันทึกไม่สำเร็จ";
      };
    }

    async function refreshCleanStats() {
      const el = root.querySelector("#sCleanStats");
      if (!el) return;
      const r = await api("/api/v1/admin/system/cleanup", { method: "GET" });
      if (!r.res.ok) {
        el.textContent = "";
        return;
      }
      const last = r.data.lastRun;
      const lastText = last && last.at
        ? `รันล่าสุด ${new Date(last.at).toLocaleString("th-TH")} · ลบ session ${last.sessionsDeleted || 0} · guest ${last.guestsDeleted || 0}`
        : "ยังไม่เคยรัน cleanup";
      el.textContent =
        `Guest ${r.data.guestTotal || 0} · ค้างรอลบ ${r.data.staleGuests || 0} · session หมดอายุ ${r.data.expiredSessions || 0}` +
        ` · activity ${r.data.activityTotal || 0} (หมดอายุ ${r.data.activityExpired || 0})` +
        ` · ประวัติเกม ${r.data.gameTotal || 0} (หมดอายุ ${r.data.gameExpired || 0}) · ${lastText}`;
    }
    refreshCleanStats();

    const saveClean = root.querySelector("#sSaveClean");
    if (saveClean) {
      saveClean.onclick = async () => {
        const r = await patchSettings(
          {
            guest_cleanup_enabled: !!root.querySelector("#sGuestClean").checked,
            session_cleanup_enabled: !!root.querySelector("#sSessClean").checked,
            guest_idle_days: Number(root.querySelector("#sGuestIdle").value) || 1,
            guest_session_days: Number(root.querySelector("#sGuestSess").value) || 1,
            cleanup_interval_minutes: Number(root.querySelector("#sCleanEvery").value) || 60,
            guest_create_per_ip_hour: Number(root.querySelector("#sGuestRate").value) || 0,
            game_history_retention_days: Number(root.querySelector("#sGameHistDays").value) || 30
          },
          root.querySelector("#sMsgClean")
        );
        root.querySelector("#sMsgClean").textContent = r.res.ok ? "บันทึก Cleanup แล้ว" : "บันทึกไม่สำเร็จ";
        if (r.res.ok) refreshCleanStats();
      };
    }

    const saveAct = root.querySelector("#sSaveAct");
    if (saveAct) {
      saveAct.onclick = async () => {
        const r = await patchSettings(
          {
            activity_log_enabled: !!root.querySelector("#sActLog").checked,
            activity_log_retention_days: Number(root.querySelector("#sActDays").value) || 30
          },
          root.querySelector("#sMsgAct")
        );
        root.querySelector("#sMsgAct").textContent = r.res.ok ? "บันทึก Activity Log แล้ว" : "บันทึกไม่สำเร็จ";
        if (r.res.ok) refreshCleanStats();
      };
    }

    const saveDb = root.querySelector("#sSaveDb");
    if (saveDb) {
      saveDb.onclick = async () => {
        const r = await patchSettings(
          { db_size_limit_mb: Number(root.querySelector("#sDbLimit").value) || 1024 },
          root.querySelector("#sMsgDb")
        );
        root.querySelector("#sMsgDb").textContent = r.res.ok ? "บันทึกขีดจำกัด DB แล้ว" : "บันทึกไม่สำเร็จ";
      };
    }

    const runClean = root.querySelector("#sRunClean");
    if (runClean) {
      runClean.onclick = async () => {
        if (!(await confirmDialog("รัน cleanup ตอนนี้? จะลบ session หมดอายุและ guest ที่ค้างตามค่าที่ตั้งไว้"))) return;
        runClean.disabled = true;
        root.querySelector("#sMsgClean").textContent = "กำลัง cleanup…";
        const r = await api("/api/v1/admin/system/cleanup", { method: "POST", body: "{}" });
        runClean.disabled = false;
        if (!r.res.ok) {
          root.querySelector("#sMsgClean").textContent = r.data && r.data.skipped
            ? "กำลังรันอยู่แล้ว ลองใหม่ภายหลัง"
            : "cleanup ไม่สำเร็จ";
          return;
        }
        root.querySelector("#sMsgClean").textContent =
          `เสร็จแล้ว · session ${r.data.sessionsDeleted || 0} · guest ${r.data.guestsDeleted || 0} · activity ${r.data.activityDeleted || 0}`;
        refreshCleanStats();
      };
    }
  }

  await load();
}
