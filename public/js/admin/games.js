import { api } from "/js/dashboard/api.js";
import { esc, fmtDate, hasPerm } from "./util.js";

const GAMES = [
  {
    id: "secret",
    defaultName: "หาเลข",
    en: "Don't Get The Secret",
    blurb: "เกมทายเลข — ห้ามโดนเลขลับ ใช้ในคลังเกมและตอนสร้างห้อง",
    defaultBeta: false,
    defaultComingSoon: false
  },
  {
    id: "wheel",
    defaultName: "วงล้อ",
    en: "Number Wheel",
    blurb: "เกมหมุนวงล้อ — ใครโดนเลขตัวเองตกรอบ",
    defaultBeta: false,
    defaultComingSoon: false
  },
  {
    id: "snake",
    defaultName: "บันไดงู",
    en: "Snake & Ladders",
    blurb: "เกมกระดาน — ทอยลูกเต๋าถึงช่อง 100 (สูงสุด 6 คน)",
    defaultBeta: true,
    defaultComingSoon: false
  },
  {
    id: "imposter",
    defaultName: "Imposter",
    en: "Find the Imposter",
    blurb: "Classic Imposter — คำใบ้ · แชท · โหวต (Coming Soon = แอดมินทดสอบได้)",
    defaultBeta: false,
    defaultComingSoon: true
  },
  {
    id: "race2048",
    defaultName: "2048 Race",
    en: "2048 Race",
    blurb: "แข่งรวมเลขแบบ 2048 — Coming Soon ในคลังเกม",
    defaultBeta: false,
    defaultComingSoon: true
  },
  {
    id: "cardmemory",
    defaultName: "Card Memory",
    en: "Card Memory",
    blurb: "พลิกไพ่จับคู่ความจำ — Coming Soon ในคลังเกม",
    defaultBeta: false,
    defaultComingSoon: true
  },
  {
    id: "werewolf",
    defaultName: "Werewolf",
    en: "Werewolf",
    blurb: "หมาป่า · ชาวบ้าน · ความสามารถกลางคืน — Coming Soon ในคลังเกม",
    defaultBeta: false,
    defaultComingSoon: true
  }
];

function modeLabel(mode) {
  if (mode === "wheel") return "วงล้อ";
  if (mode === "secret") return "หาเลข";
  if (mode === "snake") return "บันไดงู";
  if (mode === "imposter") return "Imposter";
  if (mode === "race2048") return "2048 Race";
  if (mode === "cardmemory") return "Card Memory";
  if (mode === "werewolf") return "Werewolf";
  return mode || "—";
}

function fmtDuration(sec) {
  const n = Number(sec) || 0;
  if (n < 60) return n + " วินาที";
  const m = Math.floor(n / 60);
  const s = n % 60;
  return s ? `${m} นาที ${s} วินาที` : `${m} นาที`;
}

export async function renderGames(root, { user }) {
  root.innerHTML = `<div class="loading">Loading…</div>`;
  const [catRes, histRes] = await Promise.all([
    api("/api/v1/admin/games/catalog", { method: "GET" }),
    api("/api/v1/admin/games/history?limit=40", { method: "GET" })
  ]);
  if (!catRes.res.ok) {
    root.innerHTML = `<div class="empty">โหลดไม่ได้</div>`;
    return;
  }
  const catalog = catRes.data.catalog || {};
  const games = (histRes.data && histRes.data.games) || [];
  const canManage = hasPerm(user, "games.manage");

  root.innerHTML = `
    <div class="card">
      <h2>จัดการเกมในคลัง</h2>
      <p class="muted" style="margin-top:0">
        หน้านี้คุมว่าเกมไหน <b>โชว์ใน Game Library</b> ชื่อที่ผู้เล่นเห็น ป้าย <b>Beta</b> และ <b>Coming Soon</b>
        — Coming Soon = ผู้เล่นทั่วไปกดเล่นไม่ได้ (แอดมิน + ผู้ได้รับเชิญทดสอบได้) จนเอาติ๊กออก
      </p>
      <div class="game-admin-grid" id="gCat">
        ${GAMES.map((g) => {
          const row = catalog[g.id] || {};
          const name = (row.name && String(row.name).trim()) || g.defaultName;
          const on = row.enabled !== false;
          const beta =
            row.beta != null ? !!row.beta : !!g.defaultBeta;
          const comingSoon =
            row.comingSoon != null ? !!row.comingSoon : !!g.defaultComingSoon;
          const badges =
            (beta ? ` <span class="pill warn">Beta</span>` : "") +
            (comingSoon ? ` <span class="pill soon">Coming Soon</span>` : "");
          return `<div class="card nested game-admin-card">
            <div class="row-between" style="align-items:flex-start">
              <div>
                <div class="tiny">รหัสเกม: <code>${esc(g.id)}</code></div>
                <h3 style="margin:4px 0 2px">${esc(g.defaultName)}${badges}</h3>
                <div class="tiny">${esc(g.en)}</div>
              </div>
              <label class="switch-row" title="เปิด = โชว์ในคลังเกม">
                <input type="checkbox" data-id="${g.id}" data-field="enabled" ${on ? "checked" : ""} ${canManage ? "" : "disabled"}/>
                <span>${on ? "เปิดในคลัง" : "ปิดจากคลัง"}</span>
              </label>
            </div>
            <p class="tiny" style="margin:10px 0 8px">${esc(g.blurb)}</p>
            <label class="switch-row" style="margin:0 0 8px" title="โชว์ป้าย Beta ใน Game Library">
              <input type="checkbox" data-id="${g.id}" data-field="beta" ${beta ? "checked" : ""} ${canManage ? "" : "disabled"}/>
              <span>เกม Beta</span>
            </label>
            <label class="switch-row" style="margin:0 0 10px" title="โชว์ป้าย Coming Soon — ผู้เล่นทั่วไปกดเล่นไม่ได้ แอดมิน/ผู้ได้รับเชิญทดสอบได้">
              <input type="checkbox" data-id="${g.id}" data-field="comingSoon" ${comingSoon ? "checked" : ""} ${canManage ? "" : "disabled"}/>
              <span>Coming Soon (แอดมิน + ผู้ได้รับเชิญ)</span>
            </label>
            <label class="field">
              <span>ชื่อที่แสดงให้ผู้เล่น</span>
              <div class="toolbar" style="margin-top:6px">
                <input class="input" data-id="${g.id}" data-field="name" value="${esc(name)}" ${canManage ? "" : "disabled"} placeholder="${esc(g.defaultName)}"/>
                ${
                  canManage
                    ? `<button type="button" class="btn ghost sm" data-reset="${g.id}">คืนชื่อเดิม</button>`
                    : ""
                }
              </div>
            </label>
          </div>`;
        }).join("")}
      </div>
      ${canManage ? `<button type="button" class="btn sm" id="gSave" style="margin-top:14px">บันทึกการตั้งค่าเกม</button>` : ""}
      <p class="tiny" id="gMsg"></p>
    </div>

    <div class="card" style="margin-top:16px" id="gTesterCard">
      <h2>เชิญผู้เล่นทดสอบ Coming Soon</h2>
      <p class="muted" style="margin-top:0">
        ผู้ที่ได้รับเชิญจะกดเล่นเกม Coming Soon ได้จากคลังเกม (บัญชีที่สมัครแล้วเท่านั้น)
      </p>
      <div class="toolbar" style="flex-wrap:wrap;gap:8px;align-items:flex-end">
        <label class="field" style="margin:0;min-width:160px">
          <span>เกม</span>
          <select id="gTesterGame" class="input">
            ${GAMES.map((g) => `<option value="${esc(g.id)}">${esc(g.defaultName)}</option>`).join("")}
          </select>
        </label>
        <label class="field" style="margin:0;flex:1;min-width:180px">
          <span>Friend code / username</span>
          <input id="gTesterQ" class="input" placeholder="เช่น NV-XXXX หรือชื่อผู้ใช้" ${canManage ? "" : "disabled"}/>
        </label>
        ${
          canManage
            ? `<button type="button" class="btn sm" id="gTesterInvite">เชิญทดสอบ</button>`
            : ""
        }
      </div>
      <p class="tiny" id="gTesterMsg" style="margin-top:8px"></p>
      <div id="gTesterList" style="margin-top:12px"></div>
    </div>

    <div style="margin-top:16px">
      <div class="page-head" style="margin-bottom:10px">
        <div>
          <h2 style="margin:0">เกมที่จบแล้วล่าสุด</h2>
          <p class="muted tiny" style="margin:6px 0 0">ประวัติจากห้องที่เล่นจบแล้ว (ดูอย่างเดียว · ลบอัตโนมัติหลัง 30 วัน)</p>
        </div>
      </div>
      ${
        games.length
          ? `<div class="history-card-grid">
            ${games
              .map(
                (g) => `<article class="history-card">
                <div class="room-card-top">
                  <div class="room-card-title">
                    <b>${esc(g.roomName || "ห้องไม่มีชื่อ")}</b>
                    <div class="tiny">รหัส ${esc(g.roomCode)}</div>
                  </div>
                  <span class="history-mode">${esc(modeLabel(g.gameMode))}</span>
                </div>
                <div class="room-card-meta">
                  <span><em>ผู้เล่น</em> ${g.playerCount} คน</span>
                  <span><em>นาน</em> ${esc(fmtDuration(g.durationSec))}</span>
                  <span><em>จบเมื่อ</em> ${esc(fmtDate(g.endedAt))}</span>
                </div>
              </article>`
              )
              .join("")}
          </div>`
          : `<div class="card empty">ยังไม่มีประวัติเกมที่จบ</div>`
      }
    </div>
  `;

  root.querySelectorAll("[data-field='enabled']").forEach((box) => {
    box.onchange = () => {
      const label = box.parentElement && box.parentElement.querySelector("span");
      if (label) label.textContent = box.checked ? "เปิดในคลัง" : "ปิดจากคลัง";
    };
  });

  root.querySelectorAll("[data-reset]").forEach((btn) => {
    btn.onclick = () => {
      const id = btn.getAttribute("data-reset");
      const g = GAMES.find((x) => x.id === id);
      const input = root.querySelector(`input[data-id="${id}"][data-field="name"]`);
      if (g && input) input.value = g.defaultName;
    };
  });

  const save = root.querySelector("#gSave");
  if (save) {
    save.onclick = async () => {
      const next = {};
      for (const g of GAMES) {
        const en = root.querySelector(`input[data-id="${g.id}"][data-field="enabled"]`);
        const beta = root.querySelector(`input[data-id="${g.id}"][data-field="beta"]`);
        const soon = root.querySelector(`input[data-id="${g.id}"][data-field="comingSoon"]`);
        const nameEl = root.querySelector(`input[data-id="${g.id}"][data-field="name"]`);
        const name = ((nameEl && nameEl.value) || "").trim() || g.defaultName;
        next[g.id] = {
          enabled: !!(en && en.checked),
          beta: !!(beta && beta.checked),
          comingSoon: !!(soon && soon.checked),
          name
        };
      }
      const r = await api("/api/v1/admin/games/catalog", {
        method: "PATCH",
        body: JSON.stringify({ catalog: next })
      });
      root.querySelector("#gMsg").textContent = r.res.ok
        ? "บันทึกแล้ว — ผู้เล่นจะเห็นตามนี้ในคลังเกม"
        : "บันทึกไม่สำเร็จ";
      if (r.res.ok) renderGames(root, { user });
    };
  }

  const testerGame = root.querySelector("#gTesterGame");
  const testerList = root.querySelector("#gTesterList");
  const testerMsg = root.querySelector("#gTesterMsg");
  const testerQ = root.querySelector("#gTesterQ");

  async function loadTesters() {
    if (!testerGame || !testerList) return;
    const gameId = testerGame.value;
    testerList.innerHTML = `<div class="tiny muted">กำลังโหลด…</div>`;
    const r = await api("/api/v1/admin/games/testers?gameId=" + encodeURIComponent(gameId), {
      method: "GET"
    });
    if (!r.res.ok) {
      testerList.innerHTML = `<div class="empty">โหลดรายชื่อไม่ได้</div>`;
      return;
    }
    const testers = (r.data && r.data.testers) || [];
    if (!testers.length) {
      testerList.innerHTML = `<div class="empty">ยังไม่มีผู้ได้รับเชิญสำหรับเกมนี้</div>`;
      return;
    }
    testerList.innerHTML = `<ul class="invite-list" style="list-style:none;padding:0;margin:0">
      ${testers
        .map((t) => {
          const u = t.user || {};
          const label =
            (u.displayName || u.username || t.userId || "?") +
            (u.friendCode ? ` · ${u.friendCode}` : "") +
            (u.username ? ` · @${u.username}` : "");
          return `<li class="row-between" style="padding:8px 0;border-bottom:1px solid rgba(255,255,255,.06)">
            <div>
              <div>${esc(label)}</div>
              <div class="tiny muted">${t.invitedAt ? esc(fmtDate(t.invitedAt)) : ""}</div>
            </div>
            ${
              canManage
                ? `<button type="button" class="btn ghost sm" data-revoke="${esc(t.userId)}">ถอนเชิญ</button>`
                : ""
            }
          </li>`;
        })
        .join("")}
    </ul>`;
    testerList.querySelectorAll("[data-revoke]").forEach((btn) => {
      btn.onclick = async () => {
        const userId = btn.getAttribute("data-revoke");
        const del = await api("/api/v1/admin/games/testers", {
          method: "DELETE",
          body: JSON.stringify({ gameId: testerGame.value, userId })
        });
        if (testerMsg) {
          testerMsg.textContent = del.res.ok ? "ถอนเชิญแล้ว" : "ถอนเชิญไม่สำเร็จ";
        }
        if (del.res.ok) loadTesters();
      };
    });
  }

  if (testerGame) {
    testerGame.onchange = () => loadTesters();
    loadTesters();
  }
  const inviteBtn = root.querySelector("#gTesterInvite");
  if (inviteBtn) {
    inviteBtn.onclick = async () => {
      const q = ((testerQ && testerQ.value) || "").trim();
      if (!q) {
        if (testerMsg) testerMsg.textContent = "ใส่ friend code หรือ username ก่อน";
        return;
      }
      const r = await api("/api/v1/admin/games/testers", {
        method: "POST",
        body: JSON.stringify({ gameId: testerGame.value, q })
      });
      if (!r.res.ok) {
        if (testerMsg) {
          testerMsg.textContent =
            r.data && r.data.error === "user_not_found"
              ? "ไม่พบผู้เล่น"
              : r.data && r.data.error === "registered_only"
                ? "เชิญได้เฉพาะบัญชีที่สมัครแล้ว"
                : "เชิญไม่สำเร็จ";
        }
        return;
      }
      if (testerMsg) {
        testerMsg.textContent = r.data && r.data.already ? "ผู้เล่นนี้ถูกเชิญแล้ว" : "เชิญทดสอบแล้ว";
      }
      if (testerQ) testerQ.value = "";
      loadTesters();
    };
  }
}
