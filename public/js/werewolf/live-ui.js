(function () {
  "use strict";

  function esc(s) {
    return String(s || "").replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
    );
  }

  function phaseLabel(phase) {
    const map = {
      ROLE_REVEAL: "เปิดบทบาท",
      NIGHT: "กลางคืน",
      MORNING: "เช้า",
      DISCUSSION: "พูดคุย",
      VOTING: "โหวต",
      EXECUTION: "ผลโหวต",
      HUNTER_SHOT: "นักล่ายิง",
      FINISHED: "จบเกม"
    };
    return map[phase] || phase || "—";
  }

  function formatLeft(ms) {
    const s = Math.max(0, Math.ceil((ms || 0) / 1000));
    const m = Math.floor(s / 60);
    const r = s % 60;
    return m > 0 ? m + ":" + String(r).padStart(2, "0") : String(s) + "s";
  }

  function createLiveUi(opts) {
    const root = opts.root;
    const send = opts.send || function () {};
    let lastPrivate = null;
    let lastPublic = null;
    let lastMeta = { players: [], youId: "" };
    let lastCountdownSec = -1;
    let localDeadline = 0;
    let clockKey = 0;
    let witchMode = null;
    let pickedId = null;
    let village3d = null;
    let village3dFailed = false;

    root.innerHTML = `
      <div class="ww-root">
        <div class="ww-stage-wrap" data-ww="stage">
          <div class="ww-village hidden" data-ww="village3d" aria-label="หมู่บ้านหมาป่า 3D"></div>
          <div class="ww-hud">
            <div class="ww-phase">
              <div class="ww-phase-badge" data-ww="phaseBadge">DAY</div>
              <h2 class="ww-phase-title" data-ww="phaseTitle">—</h2>
              <div class="ww-timer" data-ww="timer">—</div>
            </div>
            <p class="sub" data-ww="sub"></p>
            <button type="button" class="ww-fs-btn" data-ww="fsBtn" title="ขยายเพื่อเล่นเต็มจอ" aria-label="ขยายเพื่อเล่นเต็มจอ">⛶ เต็มจอ</button>
          </div>
          <div class="ww-dock">
            <div class="ww-you-card hidden" data-ww="youCard"></div>
            <div class="ww-action hidden" data-ww="action"></div>
            <ul class="ww-log" data-ww="log"></ul>
            <ul class="ww-tallies hidden" data-ww="tallies"></ul>
          </div>
          <div class="ww-role-modal hidden" data-ww="roleModal" role="dialog" aria-modal="true"></div>
        </div>
        <div class="ww-roster" data-ww="roster" role="list"></div>
      </div>
    `;

    const el = {
      stage: root.querySelector('[data-ww="stage"]'),
      village3d: root.querySelector('[data-ww="village3d"]'),
      phaseBadge: root.querySelector('[data-ww="phaseBadge"]'),
      phaseTitle: root.querySelector('[data-ww="phaseTitle"]'),
      timer: root.querySelector('[data-ww="timer"]'),
      sub: root.querySelector('[data-ww="sub"]'),
      fsBtn: root.querySelector('[data-ww="fsBtn"]'),
      youCard: root.querySelector('[data-ww="youCard"]'),
      action: root.querySelector('[data-ww="action"]'),
      roleModal: root.querySelector('[data-ww="roleModal"]'),
      roster: root.querySelector('[data-ww="roster"]'),
      log: root.querySelector('[data-ww="log"]'),
      tallies: root.querySelector('[data-ww="tallies"]')
    };

    let roleExpanded = false;

    function isNativeFs() {
      return document.fullscreenElement === el.stage || document.webkitFullscreenElement === el.stage;
    }

    function isFs() {
      return isNativeFs() || el.stage.classList.contains("is-fs-fallback");
    }

    function syncFsBtn() {
      const on = isFs();
      el.fsBtn.textContent = on ? "✕ ออกจากเต็มจอ" : "⛶ เต็มจอ";
      el.fsBtn.title = on ? "ออกจากโหมดเต็มจอ" : "ขยายเพื่อเล่นเต็มจอ";
      el.fsBtn.setAttribute("aria-label", el.fsBtn.title);
      el.stage.classList.toggle("is-fs", on);
    }

    function toggleFullscreen() {
      if (el.stage.classList.contains("is-fs-fallback")) {
        el.stage.classList.remove("is-fs-fallback");
        syncFsBtn();
        return;
      }
      if (isNativeFs()) {
        const exit = document.exitFullscreen || document.webkitExitFullscreen;
        if (exit) exit.call(document);
        return;
      }
      const req = el.stage.requestFullscreen || el.stage.webkitRequestFullscreen;
      if (req) {
        Promise.resolve(req.call(el.stage)).catch(function () {
          el.stage.classList.add("is-fs-fallback");
          syncFsBtn();
        });
      } else {
        el.stage.classList.add("is-fs-fallback");
        syncFsBtn();
      }
    }

    el.fsBtn.addEventListener("click", toggleFullscreen);
    document.addEventListener("fullscreenchange", syncFsBtn);
    document.addEventListener("webkitfullscreenchange", syncFsBtn);

    function alivePlayers() {
      const pub = lastPublic;
      if (!pub) return [];
      const alive = new Set(pub.alive || []);
      return (lastMeta.players || []).filter((p) => alive.has(String(p.id)));
    }

    function handleHousePick(id) {
      const pub = lastPublic;
      const priv = lastPrivate;
      if (!pub || !priv) return;
      const sid = String(id);
      const youId = String(lastMeta.youId || "");

      if (pub.phase === "NIGHT" && pub.canNightAct && priv.alive) {
        const role = priv.role;
        let type = null;
        if (role === "werewolf") type = "attack";
        else if (role === "seer") type = "inspect";
        else if (role === "guardian") type = "protect";
        else if (role === "witch") type = witchMode;
        if (!type) return;
        if (role === "werewolf" && (sid === youId || (priv.peers || []).includes(sid))) return;
        if ((role === "seer" || role === "witch") && sid === youId && type !== "heal") return;
        pickedId = sid;
        witchMode = null;
        send({ t: "ww:night", type: type, targetId: sid });
        paintAction();
        syncVillage();
        return;
      }

      if (pub.phase === "VOTING" && pub.canVote) {
        if (sid === youId) return;
        pickedId = sid;
        send({ t: "ww:vote", targetId: sid });
        paintAction();
        syncVillage();
        return;
      }

      if (pub.phase === "HUNTER_SHOT" && pub.canHunterShot) {
        pickedId = sid;
        send({ t: "ww:hunter", targetId: sid });
        paintAction();
        syncVillage();
      }
    }

    function ensureVillage() {
      if (village3d || village3dFailed || !window.NVWerewolfVillage3D) return village3d;
      const host = el.village3d;
      if (!host) return null;
      village3d = window.NVWerewolfVillage3D.create(host, {
        onPick: handleHousePick,
        onFail() {
          village3d = null;
          village3dFailed = true;
          host.classList.add("hidden");
          paintRoster();
        }
      });
      return village3d;
    }

    function syncVillage() {
      const v = ensureVillage();
      if (!v || !lastPublic) return;
      el.roster.classList.add("hidden");
      v.update(lastPublic, { pickedId: pickedId });
    }

    function roleDetailHtml(priv) {
      const peers =
        priv.peers && priv.peers.length
          ? `<p class="ww-peers">หมาป่าด้วยกัน: ${priv.peers
              .map((id) => esc((lastPublic && lastPublic.names && lastPublic.names[id]) || id))
              .join(", ")}</p>`
          : "";
      const inspect =
        priv.inspectResult
          ? `<p class="ww-inspect">${esc(priv.inspectResult.name)} คือ ${
              priv.inspectResult.isWerewolf ? "ฝ่ายหมาป่า" : "ไม่ใช่หมาป่า"
            }</p>`
          : "";
      return `
        <article class="ww-role-card" style="--ww-role:${esc(priv.color || "#64748b")}">
          <img class="ww-role-art" src="${esc(priv.image)}" alt="${esc(priv.nameEn)}" width="420" height="420" decoding="async">
          <div class="ww-role-meta">
            <p class="ww-role-team">${priv.team === "werewolf" ? "ฝ่ายหมาป่า" : "ฝ่ายหมู่บ้าน"}</p>
            <h3>${esc(priv.nameTh)} <span class="muted">(${esc(priv.nameEn)})</span></h3>
            <p>${esc(priv.blurb)}</p>
            ${peers}${inspect}
          </div>
        </article>
      `;
    }

    function paintRoleModal() {
      const priv = lastPrivate;
      if (!roleExpanded || !priv || !priv.role) {
        el.roleModal.classList.add("hidden");
        el.roleModal.innerHTML = "";
        return;
      }
      const canConfirm = lastPublic && lastPublic.phase === "ROLE_REVEAL" && lastPublic.canConfirm;
      el.roleModal.classList.remove("hidden");
      el.roleModal.innerHTML =
        roleDetailHtml(priv) +
        (canConfirm
          ? `<button type="button" class="btn ww-role-close" data-ww="roleConfirm">ยืนยันบทบาท</button>`
          : `<button type="button" class="btn ww-role-close" data-ww="roleClose">ปิด</button>`);
      const confirmBtn = el.roleModal.querySelector('[data-ww="roleConfirm"]');
      if (confirmBtn) {
        confirmBtn.onclick = () => {
          roleExpanded = false;
          paintRoleModal();
          send({ t: "ww:confirm" });
        };
      }
      const closeBtn = el.roleModal.querySelector('[data-ww="roleClose"]');
      if (closeBtn) {
        closeBtn.onclick = () => {
          roleExpanded = false;
          paintRoleModal();
        };
      }
      el.roleModal.onclick = (e) => {
        if (e.target === el.roleModal && !canConfirm) {
          roleExpanded = false;
          paintRoleModal();
        }
      };
    }

    function paintYouCard() {
      const priv = lastPrivate;
      if (!priv || !priv.role) {
        el.youCard.classList.add("hidden");
        el.youCard.innerHTML = "";
        roleExpanded = false;
        paintRoleModal();
        return;
      }
      el.youCard.classList.remove("hidden");
      const note =
        priv.inspectResult
          ? `<span class="ww-chip-note">${esc(priv.inspectResult.name)} ${
              priv.inspectResult.isWerewolf ? "หมาป่า" : "ไม่ใช่หมาป่า"
            }</span>`
          : !priv.alive
            ? `<span class="ww-chip-note">ตายแล้ว</span>`
            : "";
      el.youCard.innerHTML = `
        <button type="button" class="ww-role-chip" style="--ww-role:${esc(priv.color || "#64748b")}" data-ww="roleChip" title="ดูบทบาทของคุณ">
          <img class="ww-chip-art" src="${esc(priv.image)}" alt="" width="48" height="48" decoding="async">
          <span class="ww-chip-meta">
            <b>${esc(priv.nameTh)}</b>
            <span>${priv.team === "werewolf" ? "ฝ่ายหมาป่า" : "ฝ่ายหมู่บ้าน"}</span>
            ${note}
          </span>
        </button>
      `;
      el.youCard.querySelector('[data-ww="roleChip"]').onclick = () => {
        roleExpanded = !roleExpanded;
        paintRoleModal();
      };
      paintRoleModal();
    }

    function paintRoster() {
      const pub = lastPublic;
      if (!pub) {
        el.roster.innerHTML = "";
        return;
      }
      if (ensureVillage()) {
        el.roster.classList.add("hidden");
        return;
      }
      el.roster.classList.remove("hidden");
      const alive = new Set(pub.alive || []);
      const youId = String(lastMeta.youId || "");
      el.roster.innerHTML = (pub.order || [])
        .map((id) => {
          const name = (pub.names && pub.names[id]) || id;
          const dead = !alive.has(id);
          const voted = (pub.votedIds || []).includes(id);
          const role =
            pub.phase === "FINISHED" && pub.roles
              ? (pub.roleCatalog || []).find((r) => r.id === pub.roles[id])
              : null;
          return `<div class="ww-seat${dead ? " is-dead" : ""}${id === youId ? " is-you" : ""}" role="listitem">
            <span class="ww-seat-name">${esc(name)}${id === youId ? " (คุณ)" : ""}</span>
            <span class="ww-seat-meta">${dead ? "ตาย" : voted && pub.phase === "VOTING" ? "โหวตแล้ว" : "มีชีวิต"}${
              role ? " · " + esc(role.nameTh) : ""
            }</span>
          </div>`;
        })
        .join("");
    }

    function paintLog() {
      const rows = (lastPublic && lastPublic.log) || [];
      el.log.innerHTML = rows
        .slice(-4)
        .reverse()
        .map((row) => `<li class="ww-log-item ww-log-${esc(row.kind || "info")}">${esc(row.text)}</li>`)
        .join("");
    }

    function paintTallies() {
      const tallies = lastPublic && lastPublic.voteTallies;
      if (!tallies || !Array.isArray(tallies.entries)) {
        el.tallies.classList.add("hidden");
        el.tallies.innerHTML = "";
        return;
      }
      el.tallies.classList.remove("hidden");
      el.tallies.innerHTML = tallies.entries
        .map((e) => `<li>${esc(e.name)} · ${e.count} เสียง</li>`)
        .concat(tallies.abstain ? [`<li>งดโหวต · ${tallies.abstain}</li>`] : [])
        .join("");
    }

    function targetButtons(extraFilter) {
      const list = alivePlayers().filter((p) => {
        if (typeof extraFilter === "function" && !extraFilter(p)) return false;
        return true;
      });
      if (!list.length) return `<p class="hint">ไม่มีเป้าหมาย</p>`;
      return `<div class="ww-targets">${list
        .map(
          (p) =>
            `<button type="button" class="btn ghost ww-target" data-id="${esc(p.id)}">${esc(p.name)}</button>`
        )
        .join("")}</div>`;
    }

    function use3dPick() {
      return !!ensureVillage() && !village3dFailed;
    }

    function paintAction() {
      const pub = lastPublic;
      const priv = lastPrivate;
      el.action.classList.add("hidden");
      el.action.innerHTML = "";
      if (!pub || !priv) return;
      const youId = String(lastMeta.youId || "");
      const tap = use3dPick();

      if (pub.phase === "ROLE_REVEAL" && pub.canConfirm) {
        roleExpanded = true;
        paintRoleModal();
        el.action.classList.remove("hidden");
        el.action.innerHTML = `<p class="label">ดูบทบาทของคุณแล้วกดยืนยัน</p><button type="button" class="btn" data-ww-act="confirm">ยืนยันบทบาท</button>`;
        el.action.querySelector('[data-ww-act="confirm"]').onclick = () => {
          roleExpanded = false;
          paintRoleModal();
          send({ t: "ww:confirm" });
        };
        return;
      }

      if (pub.phase === "NIGHT" && pub.canNightAct && priv.alive) {
        el.action.classList.remove("hidden");
        const role = priv.role;
        if (role === "werewolf") {
          el.action.innerHTML = tap
            ? `<p class="label">แตะบ้านเพื่อเลือกเหยื่อ</p>`
            : `<p class="label">เลือกเหยื่อ</p>${targetButtons((p) => String(p.id) !== youId && !(priv.peers || []).includes(String(p.id)))}`;
          if (!tap) {
            el.action.querySelectorAll(".ww-target").forEach((btn) => {
              btn.onclick = () => send({ t: "ww:night", type: "attack", targetId: btn.getAttribute("data-id") });
            });
          }
        } else if (role === "seer") {
          el.action.innerHTML = tap
            ? `<p class="label">แตะบ้านเพื่อตรวจว่าเป็นหมาป่าหรือไม่</p>`
            : `<p class="label">ตรวจผู้เล่น</p>${targetButtons((p) => String(p.id) !== youId)}`;
          if (!tap) {
            el.action.querySelectorAll(".ww-target").forEach((btn) => {
              btn.onclick = () => send({ t: "ww:night", type: "inspect", targetId: btn.getAttribute("data-id") });
            });
          }
        } else if (role === "guardian") {
          el.action.innerHTML = tap
            ? `<p class="label">แตะบ้านเพื่อปกป้อง</p>`
            : `<p class="label">ปกป้องใคร</p>${targetButtons()}`;
          if (!tap) {
            el.action.querySelectorAll(".ww-target").forEach((btn) => {
              btn.onclick = () => send({ t: "ww:night", type: "protect", targetId: btn.getAttribute("data-id") });
            });
          }
        } else if (role === "witch") {
          const healLeft = Number(priv.witchHealLeft) || 0;
          const poisonLeft = Number(priv.witchPoisonLeft) || 0;
          el.action.innerHTML = `
            <p class="label">ยาแม่มด · ชุบชีวิตเหลือ ${healLeft} · พิษเหลือ ${poisonLeft}${
              witchMode ? " — แตะบ้านเป้าหมาย" : ""
            }</p>
            <div class="ww-witch-actions">
              <button type="button" class="btn ghost" data-ww-act="pass">ไม่ใช้ยา</button>
              ${healLeft ? `<button type="button" class="btn ghost${witchMode === "heal" ? " on" : ""}" data-ww-act="heal">ใช้ยาชุบชีวิต</button>` : ""}
              ${poisonLeft ? `<button type="button" class="btn ghost${witchMode === "poison" ? " on" : ""}" data-ww-act="poison">ใช้ยาพิษ</button>` : ""}
            </div>
            <div data-ww="witchTargets"></div>
          `;
          const box = el.action.querySelector('[data-ww="witchTargets"]');
          el.action.querySelector('[data-ww-act="pass"]').onclick = () => {
            witchMode = null;
            send({ t: "ww:night", type: "pass" });
          };
          const healBtn = el.action.querySelector('[data-ww-act="heal"]');
          const poisonBtn = el.action.querySelector('[data-ww-act="poison"]');
          if (healBtn) {
            healBtn.onclick = () => {
              if (tap) {
                witchMode = witchMode === "heal" ? null : "heal";
                paintAction();
                return;
              }
              box.innerHTML = `<p class="label">เลือกผู้ถูกชุบ</p>${targetButtons()}`;
              box.querySelectorAll(".ww-target").forEach((btn) => {
                btn.onclick = () => send({ t: "ww:night", type: "heal", targetId: btn.getAttribute("data-id") });
              });
            };
          }
          if (poisonBtn) {
            poisonBtn.onclick = () => {
              if (tap) {
                witchMode = witchMode === "poison" ? null : "poison";
                paintAction();
                return;
              }
              box.innerHTML = `<p class="label">เลือกผู้ถูกวางยา</p>${targetButtons((p) => String(p.id) !== youId)}`;
              box.querySelectorAll(".ww-target").forEach((btn) => {
                btn.onclick = () => send({ t: "ww:night", type: "poison", targetId: btn.getAttribute("data-id") });
              });
            };
          }
        }
        return;
      }

      if (pub.phase === "NIGHT" && priv.nightSubmitted) {
        el.action.classList.remove("hidden");
        el.action.innerHTML = `<p class="hint">ส่งแอ็กชันแล้ว รอผู้เล่นอื่น…</p>`;
        return;
      }

      if (pub.phase === "NIGHT" && !pub.canNightAct) {
        el.action.classList.remove("hidden");
        el.action.innerHTML = `<p class="hint">คุณหลับอยู่ รอเช้า…</p>`;
        return;
      }

      if (pub.phase === "VOTING" && pub.canVote) {
        el.action.classList.remove("hidden");
        el.action.innerHTML = tap
          ? `<p class="label">แตะบ้านของคนที่สงสัยเพื่อโหวตออก</p>
             <button type="button" class="btn ghost" data-ww-act="abstain">งดโหวต</button>`
          : `<p class="label">โหวตผู้ต้องสงสัย</p>
             ${targetButtons((p) => String(p.id) !== youId)}
             <button type="button" class="btn ghost" data-ww-act="abstain">งดโหวต</button>`;
        if (!tap) {
          el.action.querySelectorAll(".ww-target").forEach((btn) => {
            btn.onclick = () => send({ t: "ww:vote", targetId: btn.getAttribute("data-id") });
          });
        }
        el.action.querySelector('[data-ww-act="abstain"]').onclick = () => send({ t: "ww:vote", targetId: null });
        return;
      }

      if (pub.phase === "HUNTER_SHOT" && pub.canHunterShot) {
        el.action.classList.remove("hidden");
        el.action.innerHTML = tap
          ? `<p class="label">แตะบ้านเพื่อยิงครั้งสุดท้าย</p>
             <button type="button" class="btn ghost" data-ww-act="skipShot">ไม่ยิง</button>`
          : `<p class="label">ยิงครั้งสุดท้าย</p>
             ${targetButtons()}
             <button type="button" class="btn ghost" data-ww-act="skipShot">ไม่ยิง</button>`;
        if (!tap) {
          el.action.querySelectorAll(".ww-target").forEach((btn) => {
            btn.onclick = () => send({ t: "ww:hunter", targetId: btn.getAttribute("data-id") });
          });
        }
        el.action.querySelector('[data-ww-act="skipShot"]').onclick = () => send({ t: "ww:hunter", targetId: null });
      }
    }

    function paintHeader() {
      const pub = lastPublic;
      if (!pub) return;
      const nightish = pub.phase === "NIGHT" || pub.phase === "ROLE_REVEAL";
      el.phaseBadge.textContent = nightish ? "NIGHT" : pub.phase === "FINISHED" ? "END" : "DAY";
      el.phaseBadge.classList.toggle("is-night", nightish);
      el.phaseTitle.textContent = phaseLabel(pub.phase) + " · รอบ " + (pub.round || 1);
      const left = localDeadline ? Math.max(0, localDeadline - Date.now()) : pub.phaseLeft || 0;
      el.timer.textContent = pub.phaseEndsAt ? formatLeft(left) : "—";
      const morning = pub.morning;
      if (pub.phase === "MORNING" && morning) {
        el.sub.textContent = morning.died && morning.died.length
          ? "ผู้จากไป: " + morning.died.map((d) => d.name).join(", ")
          : "เช้านี้หมู่บ้านปลอดภัย";
      } else if (pub.phase === "FINISHED") {
        el.sub.textContent = (pub.winner === "village" ? "ฝ่ายหมู่บ้านชนะ" : "ฝ่ายหมาป่าชนะ") + (pub.winReason ? " · " + pub.winReason : "");
      } else {
        el.sub.textContent = "ผู้เล่นมีชีวิต " + (pub.alive || []).length + " / " + (pub.playerCount || 0);
      }
      root.classList.toggle("ww-night", nightish);
      root.classList.toggle("ww-day", !nightish);
    }

    function tickClock() {
      if (!lastPublic || !localDeadline) return;
      const sec = Math.max(0, Math.ceil((localDeadline - Date.now()) / 1000));
      paintHeader();
      if (sec !== lastCountdownSec && sec <= 5 && sec >= 1 && typeof opts.onCountdown === "function") {
        opts.onCountdown(sec);
      }
      lastCountdownSec = sec;
    }

    function paint(pub, priv, meta) {
      const prevPhase = lastPublic && lastPublic.phase;
      lastPublic = pub || null;
      lastPrivate = priv || null;
      lastMeta = meta || lastMeta;
      if (pub && pub.phase !== prevPhase) {
        pickedId = null;
        witchMode = null;
      }
      if (pub && pub.phaseEndsAt) {
        if (pub.phaseEndsAt !== clockKey) {
          clockKey = pub.phaseEndsAt;
          localDeadline = pub.phaseEndsAt;
          lastCountdownSec = -1;
        }
      } else {
        clockKey = 0;
        localDeadline = 0;
      }
      paintHeader();
      paintYouCard();
      paintAction();
      syncVillage();
      paintRoster();
      paintLog();
      paintTallies();
    }

    const timer = setInterval(tickClock, 250);

    return {
      paint,
      halt() {
        clearInterval(timer);
        document.removeEventListener("fullscreenchange", syncFsBtn);
        document.removeEventListener("webkitfullscreenchange", syncFsBtn);
        if (isFs()) {
          const exit = document.exitFullscreen || document.webkitExitFullscreen;
          if (exit) exit.call(document);
        }
        el.stage.classList.remove("is-fs-fallback");
        if (village3d) {
          village3d.destroy();
          village3d = null;
        }
      }
    };
  }

  window.NVWerewolf = { createLiveUi };
})();
