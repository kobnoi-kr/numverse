import { api } from "./api.js";

function esc(s) {
  return String(s || "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

const KIND_LABEL = { title: "ยศ", frame: "กรอบ", effect: "เอฟเฟกต์" };

function usesSystemColor(item) {
  if (!item) return true;
  if (typeof item.useSystemColor === "boolean") return item.useSystemColor;
  if (item.meta && typeof item.meta.useSystemColor === "boolean") return item.meta.useSystemColor;
  return true;
}

function usesSystemEffect(item) {
  if (!item) return true;
  if (typeof item.useSystemEffect === "boolean") return item.useSystemEffect;
  if (item.meta && typeof item.meta.useSystemEffect === "boolean") return item.meta.useSystemEffect;
  return true;
}

function itemCssClass(item) {
  if (!item || !usesSystemEffect(item)) return "";
  return item.cssClass ? String(item.cssClass) : "";
}

function itemColor(item) {
  if (!item) return "#94a3b8";
  if (!usesSystemColor(item)) return "#94a3b8";
  if (item.meta && item.meta.color) return String(item.meta.color);
  if (item.cssClass === "title-weekly-1" || item.cssClass === "title-monthly-1") return "#fbbf24";
  if (item.cssClass === "title-weekly-2" || item.cssClass === "title-monthly-2") return "#cbd5e1";
  if (item.cssClass === "title-weekly-3" || item.cssClass === "title-monthly-3") return "#cd7f32";
  if (item.cssClass === "frame-gold") return "#fbbf24";
  if (item.cssClass === "frame-neon") return "#22d3ee";
  if (item.cssClass === "frame-ice") return "#93c5fd";
  if (item.cssClass === "frame-crimson") return "#ef4444";
  if (item.cssClass === "effect-sparkle") return "#a78bfa";
  if (item.cssClass === "effect-pulse") return "#34d399";
  if (item.cssClass === "effect-ring") return "#60a5fa";
  if (item.cssClass === "effect-flame") return "#f97316";
  return "#94a3b8";
}

function avHtml(user, letter) {
  if (user && user.avatarUrl) {
    return `<img class="dec-av-img" src="${esc(user.avatarUrl)}" alt="" referrerpolicy="no-referrer">`;
  }
  return `<span class="dec-av-letter">${esc(letter || "?")}</span>`;
}

function titlePillHtml(item, sizeClass) {
  const color = itemColor(item);
  const cls = [
    "dec-title-pill",
    sizeClass || "",
    item && item.cssClass ? item.cssClass : ""
  ]
    .filter(Boolean)
    .join(" ");
  return `<span class="${esc(cls)}" style="--title-color:${esc(color)};border-color:${esc(
    color
  )};color:${esc(color)}">${esc((item && item.name) || "—")}</span>`;
}

function itemImage(item) {
  if (!item) return "";
  if (item.imageUrl) return String(item.imageUrl);
  if (item.meta && item.meta.imageUrl) return String(item.meta.imageUrl);
  return "";
}

function mediaHtml(url, kind) {
  if (!url) return "";
  const cls = kind === "frame" ? "cosmetic-frame-media" : "cosmetic-effect-media";
  return `<img class="${cls}" src="${esc(url)}" alt="" decoding="async">`;
}

function thumbHtml(item, user) {
  const kind = item && item.kind;
  const color = itemColor(item);
  const letter = ((user && (user.displayName || user.username)) || "?").slice(0, 1).toUpperCase();
  const img = itemImage(item);
  if (kind === "title") {
    return titlePillHtml(item, "dec-title-pill-sm");
  }
  if (kind === "frame") {
    const cls = itemCssClass(item);
    // กรอบ = การ์ดสี่เหลี่ยม (ไม่ใช่รอบรูป)
    return `<div class="dec-card-thumb${cls ? " " + cls : ""}${img ? " has-media" : ""}" style="--dec-accent:${esc(color)}">
      ${mediaHtml(img, "frame")}
      <div class="dec-av-core">${avHtml(user, letter)}</div>
    </div>`;
  }
  if (kind === "effect") {
    const cls = itemCssClass(item);
    return `<div class="dec-effect-shell"><div class="dec-av-core${cls ? " " + cls : ""}${img ? " has-media" : ""}" style="--dec-accent:${esc(
      color
    )}">${mediaHtml(img, "effect")}${avHtml(user, letter)}</div></div>`;
  }
  return `<span class="tiny">—</span>`;
}

function equippedTitlesList(eq) {
  if (eq && Array.isArray(eq.titles) && eq.titles.length) return eq.titles.filter(Boolean);
  const out = [];
  if (eq && eq.title) out.push(eq.title);
  if (eq && Array.isArray(eq.extraTitles)) {
    for (const t of eq.extraTitles) if (t) out.push(t);
  }
  return out;
}

function isTitleEquipped(eq, itemId) {
  return equippedTitlesList(eq).some((t) => t && t.id === itemId);
}

function isLevelTitleItem(item) {
  return !!(item && String(item.id || "").startsWith("title.level."));
}

function previewHtml(user, eq) {
  const name = (user && (user.displayName || user.username)) || "ผู้เล่น";
  const uname = user && user.username ? "@" + user.username : "@—";
  const letter = String(name).slice(0, 1).toUpperCase();
  const titles = equippedTitlesList(eq);
  const frame = eq.frame;
  const effect = eq.effect;
  const frameCls = itemCssClass(frame);
  const effectCls = itemCssClass(effect);
  const frameImg = itemImage(frame);
  const effectImg = itemImage(effect);
  const pills =
    titles.length > 0
      ? titles.map((t) => titlePillHtml(t, "dec-title-pill-md")).join("")
      : titlePillHtml(null, "dec-title-pill-md");
  return `
    <div class="dec-preview-card dec-profile-card${frameCls ? " " + frameCls : ""}${frameImg ? " has-media" : ""}" style="--dec-accent:${esc(
      itemColor(frame)
    )}">
      ${mediaHtml(frameImg, "frame")}
      <div class="dec-preview-head">
        <div class="dec-effect-shell dec-preview-av">
          <div class="dec-av-core${effectCls ? " " + effectCls : ""}${effectImg ? " has-media" : ""}">
            ${mediaHtml(effectImg, "effect")}
            ${avHtml(user, letter)}
          </div>
        </div>
        <div class="dec-preview-id">
          <b class="dec-preview-name">${esc(name)}</b>
          <span class="dec-preview-user">${esc(uname)}</span>
          <div class="nv-pills dec-preview-pills">
            ${pills}
          </div>
        </div>
      </div>
      <p class="tiny muted" style="margin:12px 0 0">พรีวิว — กรอบอยู่ที่การ์ด · เอฟเฟกต์อยู่ที่วงกลมโปรไฟล์</p>
    </div>
  `;
}

export async function renderDecorate(root, { user } = {}) {
  const guest = !user || user.accountType === "guest";
  root.innerHTML = `
    <section class="page-head">
      <div>
        <h2 style="margin:0">ตกแต่งโปรไฟล์</h2>
        <p class="muted" style="margin:6px 0 0">ใส่ยศ · กรอบ · เอฟเฟกต์ — ยศเลเวล 1 ช่อง · ยศตกแต่งได้อีกสูงสุด 4</p>
      </div>
    </section>
    ${
      guest
        ? `<div class="card empty">เข้าสู่ระบบด้วยบัญชีจริงเพื่อตกแต่งโปรไฟล์</div>`
        : `<p class="msg" id="decMsg"></p>
           <div class="dec-layout">
             <div class="card">
               <h3 style="margin-top:0">ที่สวมอยู่</h3>
               <div id="decEquipped" class="dec-equipped"><div class="loading">Loading…</div></div>
             </div>
             <div class="card">
               <h3 style="margin-top:0">พรีวิวโปรไฟล์</h3>
               <div id="decPreview"><div class="loading">Loading…</div></div>
             </div>
           </div>
           <div class="card" style="margin-top:14px">
             <h3 style="margin-top:0">คลังของฉัน</h3>
             <p class="tiny muted" style="margin:0 0 10px">กดยศตกแต่งเพื่อสวม/ถอด (สูงสุด 4 ไม่นับยศเลเวล) · ยศเลเวลล็อกตามเลเวลสูงสุด ถอด/สลับไม่ได้</p>
             <div class="dec-kind-tabs" id="decKindTabs" role="tablist" aria-label="หมวดของตกแต่ง">
               <button type="button" class="dec-kind-tab on" data-kind="all" role="tab" aria-selected="true">ทั้งหมด</button>
               <button type="button" class="dec-kind-tab" data-kind="title" role="tab" aria-selected="false">ยศ</button>
               <button type="button" class="dec-kind-tab" data-kind="frame" role="tab" aria-selected="false">กรอบ</button>
               <button type="button" class="dec-kind-tab" data-kind="effect" role="tab" aria-selected="false">เอฟเฟกต์</button>
             </div>
             <div id="decOwned" class="dec-inv-grid"><div class="loading">Loading…</div></div>
           </div>`
    }
  `;
  if (guest) return;

  const msg = root.querySelector("#decMsg");
  function setMsg(text, ok) {
    msg.textContent = text || "";
    msg.classList.toggle("ok", !!ok);
  }

  let owned = [];
  let equipped = {};
  let equipSeq = 0;
  let kindFilter = "all";

  const KIND_TABS = [
    { id: "all", label: "ทั้งหมด" },
    { id: "title", label: "ยศ" },
    { id: "frame", label: "กรอบ" },
    { id: "effect", label: "เอฟเฟกต์" }
  ];

  function countByKind(kind) {
    if (kind === "all") return owned.length;
    return owned.filter((x) => x.kind === kind).length;
  }

  function paintTabs() {
    const tabs = root.querySelector("#decKindTabs");
    if (!tabs) return;
    tabs.innerHTML = KIND_TABS.map((t) => {
      const n = countByKind(t.id);
      const on = kindFilter === t.id;
      return `<button type="button" class="dec-kind-tab${on ? " on" : ""}" data-kind="${t.id}" role="tab" aria-selected="${on ? "true" : "false"}">${esc(t.label)} <em>${n}</em></button>`;
    }).join("");
    tabs.querySelectorAll("[data-kind]").forEach((btn) => {
      btn.onclick = () => {
        const next = btn.getAttribute("data-kind") || "all";
        if (next === kindFilter) return;
        kindFilter = next;
        paint();
      };
    });
  }

  function paint() {
    const eqBox = root.querySelector("#decEquipped");
    const ownBox = root.querySelector("#decOwned");
    const preview = root.querySelector("#decPreview");
    const eq = equipped || {};
    if (preview) preview.innerHTML = previewHtml(user, eq);
    paintTabs();

    if (eqBox) {
      const titles = equippedTitlesList(eq);
      const maxExtra = (eq && eq.maxExtraTitles) || 4;
      const extraCount = titles.filter((t) => t && !isLevelTitleItem(t)).length;
      const titleVisual =
        titles.length > 0
          ? `<div class="dec-eq-titles">${titles.map((t) => thumbHtml(t, user)).join("")}</div>`
          : thumbHtml(null, user);
      const titleNames =
        titles.length > 0 ? titles.map((t) => esc(t.name)).join(" · ") : "—";
      eqBox.innerHTML =
        `<div class="dec-eq-row">
            <div class="dec-eq-visual">${titleVisual}</div>
            <div class="dec-eq-meta">
              <span class="tiny">ยศ <em class="muted">ตกแต่ง ${extraCount}/${maxExtra}</em></span>
              <b>${titleNames}</b>
            </div>
          </div>` +
        ["frame", "effect"]
          .map((kind) => {
            const item = eq[kind];
            return `<div class="dec-eq-row">
            <div class="dec-eq-visual">${thumbHtml(item, user)}</div>
            <div class="dec-eq-meta">
              <span class="tiny">${KIND_LABEL[kind]}</span>
              <b>${item ? esc(item.name) : "—"}</b>
            </div>
          </div>`;
          })
          .join("");
    }

    if (!ownBox) return;
    const filtered =
      kindFilter === "all" ? owned : owned.filter((x) => x.kind === kindFilter);
    if (!owned.length) {
      ownBox.innerHTML = `<div class="empty">ยังไม่มีของตกแต่ง</div>`;
      return;
    }
    if (!filtered.length) {
      const label = KIND_LABEL[kindFilter] || "หมวดนี้";
      ownBox.innerHTML = `<div class="empty">ยังไม่มี${esc(label)}ในคลัง</div>`;
      return;
    }
    ownBox.innerHTML = filtered
      .map((item) => {
        const isOn =
          item.kind === "title"
            ? isTitleEquipped(eq, item.id)
            : (eq[item.kind] && eq[item.kind].id === item.id);
        const srcLabel =
          item.source === "level"
            ? "ยศเลเวล"
            : item.source === "ranking_weekly" || item.source === "ranking_monthly"
              ? "Ranking · หมดอายุตามรอบ"
              : item.source === "shop"
                ? "Shop"
                : item.source === "starter"
                  ? "เริ่มต้น"
                  : item.source || "";
        const expireLabel = item.expiresAt
          ? (() => {
              try {
                return (
                  "ถึง " +
                  new Date(item.expiresAt).toLocaleString("th-TH", {
                    timeZone: "Asia/Bangkok",
                    day: "numeric",
                    month: "short",
                    hour: "2-digit",
                    minute: "2-digit"
                  })
                );
              } catch {
                return "มีวันหมดอายุ";
              }
            })()
          : "";
        const tier = (item.tier || (item.meta && item.meta.tier) || "").toLowerCase();
        const tierPill =
          (item.kind === "frame" || item.kind === "effect") && tier
            ? `<span class="shop-tier-pill tier-${esc(tier)}">${esc(
                item.tierLabel || tier
              )}</span>`
            : "";
        const levelLocked = item.kind === "title" && isLevelTitleItem(item);
        const wearLabel = levelLocked
          ? isOn
            ? "ยศเลเวลสูงสุด"
            : "ยศเลเวล"
          : item.kind === "title" && isOn
            ? "ถอดยศ"
            : isOn
              ? "สวมอยู่"
              : "สวมใส่";
        return `<button type="button" class="dec-inv-card${isOn ? " on" : ""}${
          levelLocked ? " locked" : ""
        }" data-id="${esc(item.id)}" ${levelLocked ? "disabled title=\"ยศเลเวลล็อกตามเลเวลสูงสุด ถอดไม่ได้\"" : ""}>
          <div class="dec-inv-thumb">${thumbHtml(item, user)}</div>
          <span class="tiny">${esc(KIND_LABEL[item.kind] || item.kind)}</span>
          ${tierPill}
          <b>${esc(item.name)}</b>
          <span class="tiny muted">${esc(srcLabel)}</span>
          ${expireLabel ? `<span class="tiny muted">${esc(expireLabel)}</span>` : ""}
          <span class="dec-wear">${wearLabel}</span>
        </button>`;
      })
      .join("");

    ownBox.querySelectorAll("[data-id]").forEach((btn) => {
      btn.onclick = async () => {
        const id = btn.getAttribute("data-id");
        const item = owned.find((x) => x.id === id);
        if (!item) return;
        // Level titles are locked to max level — never equip/unequip from UI.
        if (item.kind === "title" && isLevelTitleItem(item)) {
          setMsg("ยศเลเวลล็อกตามเลเวลสูงสุด — ถอดหรือสลับไม่ได้", false);
          return;
        }
        // Frame/effect already on: no-op.
        // Extra titles already on: toggle off via API.
        if (item.kind !== "title" && equipped[item.kind] && equipped[item.kind].id === item.id) {
          return;
        }

        equipSeq += 1;
        const seq = equipSeq;
        const wasOn = item.kind === "title" && isTitleEquipped(equipped, item.id) && !isLevelTitleItem(item);
        setMsg(wasOn ? "ถอดยศแล้ว" : "สวมใส่แล้ว", true);

        const r = await api("/api/v1/cosmetics/equip", {
          method: "POST",
          body: JSON.stringify({ cosmeticId: id })
        });
        if (seq !== equipSeq) return;
        if (r.res.ok && r.data) {
          owned = Array.isArray(r.data.owned) ? r.data.owned : owned;
          equipped = r.data.equipped || equipped;
          if (user) user.equipped = equipped;
          const nowOn = item.kind === "title" ? isTitleEquipped(equipped, item.id) : true;
          setMsg(
            item.kind === "title" && !nowOn ? "ถอดยศแล้ว" : "สวมใส่แล้ว",
            true
          );
          paint();
          return;
        }
        const err = (r.data && r.data.error) || "";
        setMsg(
          err === "title_slots_full"
            ? "สวมยศตกแต่งได้สูงสุด 4 ยศ (ไม่นับยศเลเวล)"
            : err || "ไม่สำเร็จ",
          false
        );
        await load();
      };
    });
  }

  async function load() {
    const { res, data } = await api("/api/v1/cosmetics/me", { method: "GET" });
    const eqBox = root.querySelector("#decEquipped");
    const ownBox = root.querySelector("#decOwned");
    const preview = root.querySelector("#decPreview");
    if (!res.ok) {
      if (eqBox) eqBox.innerHTML = `<div class="empty">โหลดไม่สำเร็จ</div>`;
      if (ownBox) ownBox.innerHTML = "";
      if (preview) preview.innerHTML = "";
      return;
    }
    owned = Array.isArray(data.owned) ? data.owned : [];
    equipped = data.equipped || {};
    if (user) user.equipped = equipped;
    paint();
  }

  await load();
}
