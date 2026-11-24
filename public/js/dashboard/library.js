import { api, playUrl } from "./api.js";

function esc(s) {
  return String(s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

const FALLBACK = [
  {
    id: "secret",
    name: "หาเลข",
    nameEn: "Don't Get The Secret",
    category: "numbers",
    categoryLabel: "ตัวเลข",
    maxPlayers: 12,
    description: "ห้ามโดนเลขลับ — ทายช่วงและหลบเลขที่ถูกสุ่มไว้",
    howTo: "ตั้งช่วงตัวเลข แล้วผลัดกันเลือกเลข ใครโดนเลขลับจะแพ้รอบนั้น",
    popular: true
  },
  {
    id: "wheel",
    name: "วงล้อ",
    nameEn: "Number Wheel",
    category: "wheel",
    categoryLabel: "วงล้อ",
    maxPlayers: 12,
    description: "หมุนวงล้อสุ่มเลข ใครโดนเลขของตัวเองจะออกจากเกม",
    howTo: "หมุนวงล้อทีละครั้ง ถ้าวงล้อชี้เลขของคุณจะตกรอบ",
    popular: true
  },
  {
    id: "snake",
    name: "บันไดงู",
    nameEn: "Snake & Ladders",
    category: "board",
    categoryLabel: "กระดาน",
    maxPlayers: 6,
    description: "ทอยลูกเต๋า ปีนบันได เลี่ยงงู — ใครถึงช่อง 100 ก่อนชนะ",
    howTo: "ผลัดกันทอยลูกเต๋า เดินตามกระดาน เจอบันไดขึ้น เจองูลง ต้องทอยพอดีถึง 100 — เปิดเล่นอัตโนมัติได้ สูงสุด 6 คน",
    popular: true,
    beta: true
  },
  {
    id: "imposter",
    name: "Imposter",
    nameEn: "Find the Imposter",
    category: "social",
    categoryLabel: "สืบหา",
    maxPlayers: 8,
    description: "หาคนที่เป็น Imposter — คุย โหวต และจับคนร้ายก่อนสายเกินแก้",
    howTo:
      "ผู้เล่น 4–8 คน จั่วการ์ดปิดตาทีละคน ได้บทบาททีมปกติหรือ Imposter\nทีมปกติเห็นคำศัพท์ Imposter ไม่เห็นคำ หรือเห็นแค่หมวด ถ้าโฮสต์เปิดไว้\nจากนั้นให้คำใบ้ทีละคน วนจากคนแรกถึงคนท้ายตามจำนวนรอบที่ตั้ง ห้ามพิมพ์คำศัพท์ตรงๆ ข้ามตาได้\nครบรอบแล้วคุยในแชทช่วง Discussion แล้วโหวตครั้งเดียว โหวตตัวเองไม่ได้\nโหวตผิด โหวตเสมอ หรือ Imposter เหลือเท่ากับหรือมากกว่าทีมปกติ ฝ่าย Imposter ชนะ\nจับ Imposter คนสุดท้ายได้ ต้องทายคำใน 30 วินาที ทายถูก Imposter ชนะ ทายผิดหรือหมดเวลาทีมปกติชนะ\nถ้ายังเหลือ Imposter อีกคน จะเริ่มให้คำใบ้รอบใหม่\nการ์ดนางฟ้าใช้ในเกมนี้ไม่ได้",
    popular: false,
    comingSoon: true
  },
  {
    id: "race2048",
    name: "2048 Race",
    nameEn: "2048 Race",
    category: "puzzle",
    categoryLabel: "พัซเซิล",
    maxPlayers: 8,
    description: "แข่งรวมเลขแบบ 2048 — ใครถึงเป้าก่อนหรือได้คะแนนสูงสุดชนะ",
    howTo: "รายละเอียดกติกาจะเปิดพร้อมตัวเกม",
    popular: false,
    comingSoon: true
  },
  {
    id: "cardmemory",
    name: "Card Memory",
    nameEn: "Card Memory",
    category: "memory",
    categoryLabel: "ความจำ",
    maxPlayers: 8,
    description: "พลิกไพ่จับคู่ — จำตำแหน่งให้แม่น ใครจับคู่ได้มากสุดชนะ",
    howTo:
      "ผู้เล่น 2–8 คน เปิดการ์ดทีละ 2 ใบ จำตำแหน่งแล้วจับคู่ภาพที่เหมือนกัน\nจับคู่ถูกได้คะแนน จับคู่ผิดการ์ดจะคว่ำกลับแล้วเปลี่ยนเทิร์น\nโฮสต์เลือกขนาดกระดาน เวลาต่อเทิร์น คะแนนต่อคู่ และกติกาเปลี่ยนเทิร์นได้\nจับคู่ครบแล้วคนคะแนนสูงสุดชนะ",
    popular: false,
    comingSoon: true
  },
  {
    id: "werewolf",
    name: "Werewolf",
    nameEn: "Werewolf",
    category: "social",
    categoryLabel: "สืบหา",
    maxPlayers: 8,
    description: "หมู่บ้านแห่งความลับ — หาหมาป่าก่อนที่หมู่บ้านจะพัง",
    howTo:
      "ผู้เล่น 5–8 คน ได้บทบาทลับ: หมาป่า ชาวบ้าน ผู้หยั่งรู้ แม่มด ผู้พิทักษ์ นักล่า\nกลางคืนใช้ความสามารถตามบทบาท กลางวันคุยและโหวตกำจัดผู้ต้องสงสัย\nฝ่ายหมู่บ้านชนะเมื่อหมาป่าถูกกำจัดครบ ฝ่ายหมาป่าชนะเมื่อจำนวนหมาป่าไม่น้อยกว่าฝ่ายตรงข้าม\nการ์ดนางฟ้าใช้ในเกมนี้ไม่ได้",
    popular: false,
    comingSoon: true
  }
];

function thumbFor(id) {
  if (id === "secret") return "🔢";
  if (id === "wheel") return "🎡";
  if (id === "snake") return "🐍";
  if (id === "imposter") return "🕵️";
  if (id === "race2048") return "🏁";
  if (id === "cardmemory") return "🃏";
  if (id === "werewolf") {
    return `<img src="/images/werewolf/werewolf.png" alt="" width="72" height="72" decoding="async">`;
  }
  return "🎮";
}

function rememberCreateCat(id) {
  const mode =
    id === "wheel"
      ? "wheel"
      : id === "snake"
        ? "snake"
          : id === "imposter"
            ? "imposter"
            : id === "cardmemory"
              ? "cardmemory"
              : id === "werewolf"
                ? "werewolf"
                : id === "secret"
            ? "secret"
            : "";
  if (!mode) return;
  // Create preference only — does NOT drive the "เล่นล่าสุด" badge
  try {
    const uid = (() => {
      try {
        return (window.__nvUserId && String(window.__nvUserId)) || "guest";
      } catch (_) {
        return "guest";
      }
    })();
    localStorage.setItem("nv-create-cat:" + uid, mode);
  } catch (_) {}
}

function isElevatedAdmin(user) {
  const roles = (user && user.roles) || [];
  return roles.includes("admin") || roles.includes("super_admin") || roles.includes("moderator");
}

export async function renderLibrary(root, { openCreate, lastPlayedMode, user } = {}) {
  const catRes = await api("/api/v1/games/catalog", { method: "GET" });
  const games = (catRes.data && catRes.data.games) || FALLBACK;
  const admin = isElevatedAdmin(user);
  // Badge is per-account last finished game only
  const lastMode =
    user && user.accountType === "registered" && lastPlayedMode
      ? lastPlayedMode === "wheel" ||
        lastPlayedMode === "snake" ||
        lastPlayedMode === "secret" ||
        lastPlayedMode === "imposter" ||
        lastPlayedMode === "cardmemory" ||
        lastPlayedMode === "werewolf"
        ? lastPlayedMode
        : ""
      : "";
  try {
    if (user && user.id) window.__nvUserId = user.id;
  } catch (_) {}

  root.innerHTML = `
    <section class="page-head">
      <div>
        <h2 style="margin:0">Game Library</h2>
        <p class="muted" style="margin:6px 0 0">จุดรวมบอร์ดเกม — เลือกเกมกระดานแล้วสร้างห้อง</p>
      </div>
    </section>
    <div class="lib-toolbar">
      <input id="libSearch" type="search" placeholder="ค้นหาเกม…" aria-label="ค้นหาเกม">
    </div>
    <div class="lib-grid" id="libGrid"></div>
    <div class="card hidden" id="libDetail"></div>
  `;

  const grid = root.querySelector("#libGrid");
  const detail = root.querySelector("#libDetail");
  let q = "";

  function canPlay(g) {
    if (!g) return false;
    if (typeof g.canPlay === "boolean") return g.canPlay;
    if (!g.comingSoon) return true;
    return admin;
  }

  function playLabel(g) {
    if (g && g.comingSoon && canPlay(g)) {
      if (admin) return "ทดสอบ (แอดมิน)";
      if (g.testInvite) return "ทดสอบ (เชิญ)";
      return "ทดสอบ";
    }
    return "เล่นเลย";
  }

  function filtered() {
    const qq = q.trim().toLowerCase();
    let list = games.slice();
    if (qq) {
      list = list.filter((g) =>
        [g.name, g.nameEn, g.description, g.categoryLabel].join(" ").toLowerCase().includes(qq)
      );
    }
    if (lastMode) {
      list.sort((a, b) => Number(b.id === lastMode) - Number(a.id === lastMode));
    }
    return list;
  }

  function startPlay(id) {
    const g = games.find((x) => x.id === id);
    if (!canPlay(g)) return;
    rememberCreateCat(id);
    if (openCreate) openCreate({ cat: id, lockCat: true });
    else location.href = playUrl({ create: "public", setup: { cat: id } });
  }

  function paint() {
    const list = filtered();
    if (!list.length) {
      grid.innerHTML = `<div class="empty">ไม่พบเกมที่ตรงเงื่อนไข</div>`;
      return;
    }
    grid.innerHTML = list
      .map((g) => {
        const soon = !!g.comingSoon;
        const playable = canPlay(g);
        return `
      <article class="lib-card${g.id === lastMode ? " is-recent" : ""}${soon ? " is-soon" : ""}" data-id="${esc(g.id)}">
        <div class="lib-thumb">${thumbFor(g.id)}</div>
        <div class="lib-body">
          <div class="lib-top">
            <h3>${esc(g.name)}</h3>
            <div class="lib-pills">
              ${soon ? `<span class="pill soon">Coming Soon</span>` : ""}
              ${g.beta ? `<span class="pill warn">Beta</span>` : ""}
              ${g.id === lastMode ? `<span class="pill recent">เล่นล่าสุด</span>` : ""}
            </div>
          </div>
          <p class="muted">${esc(g.description)}</p>
          <div class="tiny">ผู้เล่นสูงสุด ${g.maxPlayers || 12}</div>
          <div class="lib-actions">
            ${
              playable
                ? `<button type="button" class="btn sm" data-play="${esc(g.id)}"${
                    soon
                      ? g.testInvite
                        ? ' title="Coming Soon — คุณได้รับคำเชิญทดสอบ"'
                        : ' title="Coming Soon — แอดมิน/ผู้ได้รับเชิญทดสอบได้"'
                      : ""
                  }>${esc(playLabel(g))}</button>`
                : `<button type="button" class="btn sm" disabled title="ยังไม่เปิดเล่น">เร็วๆ นี้</button>`
            }
            <button type="button" class="btn ghost sm" data-info="${esc(g.id)}">รายละเอียด</button>
          </div>
        </div>
      </article>`;
      })
      .join("");

    grid.querySelectorAll("[data-play]").forEach((btn) => {
      btn.onclick = () => startPlay(btn.getAttribute("data-play"));
    });
    grid.querySelectorAll("[data-info]").forEach((btn) => {
      btn.onclick = () => {
        const g = games.find((x) => x.id === btn.getAttribute("data-info"));
        if (!g) return;
        const soon = !!g.comingSoon;
        const playable = canPlay(g);
        detail.classList.remove("hidden");
        detail.innerHTML = `
          <h2 style="margin-top:0">${esc(g.name)}${
            soon ? ` <span class="pill soon">Coming Soon</span>` : ""
          }${g.beta ? ` <span class="pill warn">Beta</span>` : ""}</h2>
          <p class="muted">${esc(g.description)}</p>
          <h3>วิธีเล่น</h3>
          <p class="lib-howto">${esc(g.howTo)}</p>
          ${
            soon && playable && g.testInvite
              ? `<p class="tiny">Coming Soon — คุณได้รับคำเชิญทดสอบจากแอดมิน</p>`
              : soon && admin
                ? `<p class="tiny">Coming Soon — แอดมิน/ผู้ได้รับเชิญทดสอบได้ จนเอาติ๊กออกในหน้าจัดการเกม</p>`
                : soon
                  ? `<p class="tiny">เกมนี้ยัง Coming Soon — ต้องได้รับคำเชิญทดสอบจากแอดมิน</p>`
                  : ""
          }
          <div class="lib-actions">
            ${
              playable
                ? `<button type="button" class="btn" data-play2="${esc(g.id)}">${
                    soon && admin
                      ? "ทดสอบสร้างห้อง (แอดมิน)"
                      : soon && g.testInvite
                        ? "ทดสอบสร้างห้อง (เชิญ)"
                        : "สร้างห้องเกมนี้"
                  }</button>`
                : `<button type="button" class="btn" disabled>เร็วๆ นี้</button>`
            }
          </div>`;
        const play2 = detail.querySelector("[data-play2]");
        if (play2) {
          play2.onclick = () => startPlay(g.id);
        }
        detail.scrollIntoView({ behavior: "smooth", block: "nearest" });
      };
    });
  }

  root.querySelector("#libSearch").oninput = (e) => {
    q = e.target.value || "";
    paint();
  };
  paint();
}
