import { api, playUrl } from "./api.js";

function esc(s) {
  return String(s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function statusPill(room) {
  if (!room.joinable && room.phase === "lobby") return '<span class="pill bad">เต็ม</span>';
  if (room.phase === "lobby") return '<span class="pill ok">รอผู้เล่น</span>';
  if (room.phase === "over") return '<span class="pill">จบแล้ว</span>';
  return '<span class="pill busy">กำลังเล่น</span>';
}
function modeLabel(mode) {
  if (mode === "wheel") return "วงล้อ";
  if (mode === "snake") return "บันไดงู";
  if (mode === "imposter") return "Imposter";
  if (mode === "cardmemory") return "Memory Card";
  if (mode === "werewolf") return "Werewolf";
  return "หาเลข";
}

function ensureJoinCodeModal() {
  let modal = document.getElementById("dashJoinModal");
  if (modal) return modal;
  modal = document.createElement("div");
  modal.id = "dashJoinModal";
  modal.className = "modal hidden";
  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-modal", "true");
  modal.innerHTML = `
    <div class="modal-card">
      <h3>เข้าห้องส่วนตัว</h3>
      <p class="muted" id="dashJoinHint">ใส่รหัสห้อง 6 หลัก</p>
      <form id="dashJoinForm" class="form-grid" autocomplete="off">
        <label>รหัสห้อง
          <input id="dashJoinCode" class="input" inputmode="numeric" maxlength="6" placeholder="เช่น 123456" aria-label="รหัสห้อง">
        </label>
        <p class="msg" id="dashJoinMsg"></p>
        <div class="modal-actions">
          <button type="button" class="btn ghost" id="dashJoinCancel">ยกเลิก</button>
          <button type="submit" class="btn">เข้าห้อง</button>
        </div>
      </form>
    </div>
  `;
  document.body.appendChild(modal);
  modal.addEventListener("click", (e) => {
    if (e.target === modal) modal.classList.add("hidden");
  });
  modal.querySelector("#dashJoinCancel").onclick = () => modal.classList.add("hidden");
  modal.querySelector("#dashJoinForm").onsubmit = (e) => {
    e.preventDefault();
    const code = modal.querySelector("#dashJoinCode").value.replace(/\D/g, "").slice(0, 6);
    const msg = modal.querySelector("#dashJoinMsg");
    if (!/^\d{6}$/.test(code)) {
      msg.textContent = "ใส่รหัส 6 หลัก";
      return;
    }
    const name = localStorage.getItem("dpn-name") || "";
    location.href = playUrl({ code, name });
  };
  return modal;
}

function openPrivateJoinModal(roomTitle) {
  const modal = ensureJoinCodeModal();
  const hint = modal.querySelector("#dashJoinHint");
  const input = modal.querySelector("#dashJoinCode");
  const msg = modal.querySelector("#dashJoinMsg");
  hint.textContent = roomTitle
    ? `ห้อง “${roomTitle}” ล็อกอยู่ · ใส่รหัส 6 หลัก`
    : "ใส่รหัสห้อง 6 หลักเพื่อเข้าห้องส่วนตัว";
  msg.textContent = "";
  input.value = "";
  modal.classList.remove("hidden");
  requestAnimationFrame(() => input.focus());
}

function isStaff(user) {
  const roles = (user && user.roles) || [];
  return roles.includes("admin") || roles.includes("super_admin") || roles.includes("moderator");
}

export async function renderRooms(root, { openCreate, user } = {}) {
  const staff = isStaff(user);
  root.innerHTML = `
    <section class="page-head">
      <div>
        <h2 style="margin:0">My Rooms</h2>
        <p class="muted" style="margin:6px 0 0">ห้องเล่นบอร์ดเกม — สร้าง เชิญเพื่อน หรือเข้าด้วยรหัส</p>
      </div>
      <button type="button" class="btn" id="roomsCreate">สร้างห้อง</button>
    </section>

    <div class="card join-card">
      <h3 style="margin-top:0">เข้าร่วมด้วย Room Code</h3>
      <form id="joinForm" class="join-row" autocomplete="off">
        <input id="joinCode" inputmode="numeric" maxlength="6" placeholder="รหัส 6 หลัก" aria-label="รหัสห้อง">
        <button class="btn" type="submit">เข้าห้อง</button>
      </form>
      <p class="msg" id="joinMsg"></p>
    </div>

    <div class="card">
      <h3 style="margin-top:0">ห้องที่กำลังเปิด</h3>
      <div id="liveRooms"><div class="loading">Loading…</div></div>
    </div>

    <section style="margin-top:4px">
      <div class="page-head" style="margin-bottom:10px">
        <div>
          <h3 style="margin:0">ประวัติเกม</h3>
          <p class="muted tiny" style="margin:6px 0 0">ห้องที่คุณสร้างแล้วเล่นจบ — เก็บ 30 วัน (สร้างแล้วลบ/ออกโดยยังไม่จบจะไม่ขึ้นที่นี่)</p>
        </div>
      </div>
      <div id="pastRooms"><div class="loading">Loading…</div></div>
    </section>
  `;

  root.querySelector("#roomsCreate").onclick = () => openCreate && openCreate();
  root.querySelector("#joinForm").onsubmit = (e) => {
    e.preventDefault();
    const code = root.querySelector("#joinCode").value.replace(/\D/g, "").slice(0, 6);
    const msg = root.querySelector("#joinMsg");
    if (!/^\d{6}$/.test(code)) {
      msg.textContent = "ใส่รหัส 6 หลัก";
      return;
    }
    const name = localStorage.getItem("dpn-name") || "";
    location.href = playUrl({ code, name });
  };

  const mine = await api("/api/v1/rooms/mine", { method: "GET" });
  const pub = await api("/api/v1/rooms/public", { method: "GET" });
  const liveBox = root.querySelector("#liveRooms");
  const pastBox = root.querySelector("#pastRooms");

  let live = (mine.data && mine.data.live) || [];
  if (!live.length && pub.res.ok) {
    live = ((pub.data && pub.data.rooms) || []).filter((r) => r.visibility === "public");
  }

  if (!live.length) {
    liveBox.innerHTML = `<div class="empty">ยังไม่มีห้องออนไลน์ <button class="btn sm" id="emptyCreate" style="margin-top:10px">สร้างห้อง</button></div>`;
    const b = liveBox.querySelector("#emptyCreate");
    if (b) b.onclick = () => openCreate && openCreate();
  } else {
    liveBox.innerHTML = `
      <div class="room-card-list">
        ${live
          .map((r) => {
            const priv = r.visibility === "private";
            const hasCode = /^\d{6}$/.test(String(r.code || ""));
            const adminBypass = staff && priv && hasCode;
            const codeLabel = priv
              ? adminBypass
                ? "🔒 " + r.code + " · แอดมิน"
                : "🔒 ล็อก"
              : r.code || "—";
            let actions = "";
            if (r.joinable) {
              if (priv && !adminBypass) {
                actions = `<button class="btn sm" data-private-join="1" data-title="${esc(r.title || "Room")}">ใส่รหัส</button>`;
              } else if (hasCode) {
                actions = `<button class="btn sm" data-join="${esc(r.code)}">เข้าร่วม</button>
                     <button class="btn ghost sm" data-copy="${esc(r.code)}">คัดลอกรหัส</button>`;
              } else {
                actions = `<button class="btn sm" data-private-join="1" data-title="${esc(r.title || "Room")}">ใส่รหัส</button>`;
              }
            } else if (r.phase !== "lobby" && r.phase !== "over") {
              if (hasCode) {
                actions = `<a class="btn ${adminBypass ? "sm" : "ghost sm"}" href="${playUrl({ code: r.code, watch: true })}">${adminBypass ? "เข้าชม" : "ดูสด"}</a>`;
              } else {
                actions = `<button class="btn ghost sm" disabled>ส่วนตัว</button>`;
              }
            } else {
              actions = `<button class="btn sm" disabled>เต็ม</button>`;
            }
            return `
          <article class="room-card">
            <div class="room-card-top">
              <div class="room-card-title">
                <b>${esc(r.title || "Room")}</b>
                <div class="tiny">${codeLabel} · ${priv ? "Private" : "Public"}</div>
              </div>
              ${statusPill(r)}
            </div>
            <div class="room-card-meta">
              <span><em>โฮสต์</em> ${esc(r.host || "—")}</span>
              <span><em>ผู้เล่น</em> ${r.count}/${r.max}</span>
              <span><em>เกม</em> ${modeLabel(r.cat)}</span>
            </div>
            <div class="room-card-actions">${actions}</div>
          </article>`;
          })
          .join("")}
      </div>`;
  }

  liveBox.querySelectorAll("[data-join]").forEach((btn) => {
    btn.onclick = () => {
      location.href = playUrl({ code: btn.getAttribute("data-join") });
    };
  });
  liveBox.querySelectorAll("[data-private-join]").forEach((btn) => {
    btn.onclick = () => openPrivateJoinModal(btn.getAttribute("data-title") || "");
  });
  liveBox.querySelectorAll("[data-copy]").forEach((btn) => {
    btn.onclick = async () => {
      const code = btn.getAttribute("data-copy");
      const link = location.origin + playUrl({ code });
      try {
        await navigator.clipboard.writeText(link);
        btn.textContent = "คัดลอกแล้ว";
      } catch {
        btn.textContent = code;
      }
    };
  });

  const created = (mine.data && mine.data.created) || [];
  if (!created.length) {
    pastBox.innerHTML = `<div class="card empty">ยังไม่มีประวัติเกม<br><span class="tiny">สร้างห้องแล้วเล่นจนจบอย่างน้อย 1 รอบ ถึงจะมีประวัติ</span></div>`;
  } else {
    pastBox.innerHTML = `
      <div class="history-card-grid">
        ${created
          .map(
            (g) => `
          <article class="history-card">
            <div class="room-card-top">
              <div class="room-card-title">
                <b>${esc(g.title)}</b>
                <div class="tiny">${esc(g.code)} · ${g.visibility === "private" ? "Private" : "Public"}</div>
              </div>
              <span class="history-mode">${modeLabel(g.gameMode)}</span>
            </div>
            <div class="room-card-meta">
              <span><em>ผู้เล่น</em> ${g.playerCount}</span>
              <span><em>เมื่อ</em> ${g.endedAt ? esc(new Date(g.endedAt).toLocaleString("th-TH")) : "—"}</span>
            </div>
            <div class="room-card-actions">
              <button class="btn ghost sm" data-recreate="${esc(g.gameMode)}">สร้างใหม่</button>
            </div>
          </article>`
          )
          .join("")}
      </div>`;
    pastBox.querySelectorAll("[data-recreate]").forEach((btn) => {
      btn.onclick = () => openCreate && openCreate({ cat: btn.getAttribute("data-recreate") });
    });
  }
}
