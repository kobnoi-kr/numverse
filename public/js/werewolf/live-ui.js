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

    root.innerHTML = `
      <div class="ww-root">
        <div class="ww-phase">
          <div class="ww-phase-badge" data-ww="phaseBadge">DAY</div>
          <h2 class="ww-phase-title" data-ww="phaseTitle">—</h2>
          <div class="ww-timer" data-ww="timer">—</div>
        </div>
        <p class="sub" data-ww="sub"></p>
        <div class="ww-you-card hidden" data-ww="youCard"></div>
        <div class="ww-action hidden" data-ww="action"></div>
        <div class="ww-roster" data-ww="roster" role="list"></div>
        <ul class="ww-log" data-ww="log"></ul>
        <ul class="ww-tallies hidden" data-ww="tallies"></ul>
      </div>
    `;

    const el = {
      phaseBadge: root.querySelector('[data-ww="phaseBadge"]'),
      phaseTitle: root.querySelector('[data-ww="phaseTitle"]'),
      timer: root.querySelector('[data-ww="timer"]'),
      sub: root.querySelector('[data-ww="sub"]'),
      youCard: root.querySelector('[data-ww="youCard"]'),
      action: root.querySelector('[data-ww="action"]'),
      roster: root.querySelector('[data-ww="roster"]'),
      log: root.querySelector('[data-ww="log"]'),
      tallies: root.querySelector('[data-ww="tallies"]')
    };

    function alivePlayers() {
      const pub = lastPublic;
      if (!pub) return [];
      const alive = new Set(pub.alive || []);
      return (lastMeta.players || []).filter((p) => alive.has(String(p.id)));
    }

    function paintYouCard() {
      const priv = lastPrivate;
      if (!priv || !priv.role) {
        el.youCard.classList.add("hidden");
        el.youCard.innerHTML = "";
        return;
      }
      el.youCard.classList.remove("hidden");
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
      el.youCard.innerHTML = `
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

    function paintRoster() {
      const pub = lastPublic;
      if (!pub) {
        el.roster.innerHTML = "";
        return;
      }
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
        .slice()
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

    function targetButtons(onPick, extraFilter) {
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

    function paintAction() {
      const pub = lastPublic;
      const priv = lastPrivate;
      el.action.classList.add("hidden");
      el.action.innerHTML = "";
      if (!pub || !priv) return;
      const youId = String(lastMeta.youId || "");

      if (pub.phase === "ROLE_REVEAL" && pub.canConfirm) {
        el.action.classList.remove("hidden");
        el.action.innerHTML = `<button type="button" class="btn" data-ww-act="confirm">ยืนยันบทบาท</button>`;
        el.action.querySelector('[data-ww-act="confirm"]').onclick = () => send({ t: "ww:confirm" });
        return;
      }

      if (pub.phase === "NIGHT" && pub.canNightAct && priv.alive) {
        el.action.classList.remove("hidden");
        const role = priv.role;
        if (role === "werewolf") {
          el.action.innerHTML = `<p class="label">เลือกเหยื่อ</p>${targetButtons(null, (p) => String(p.id) !== youId && !(priv.peers || []).includes(String(p.id)))}`;
          el.action.querySelectorAll(".ww-target").forEach((btn) => {
            btn.onclick = () => send({ t: "ww:night", type: "attack", targetId: btn.getAttribute("data-id") });
          });
        } else if (role === "seer") {
          el.action.innerHTML = `<p class="label">ตรวจผู้เล่น</p>${targetButtons(null, (p) => String(p.id) !== youId)}`;
          el.action.querySelectorAll(".ww-target").forEach((btn) => {
            btn.onclick = () => send({ t: "ww:night", type: "inspect", targetId: btn.getAttribute("data-id") });
          });
        } else if (role === "guardian") {
          el.action.innerHTML = `<p class="label">ปกป้องใคร</p>${targetButtons()}`;
          el.action.querySelectorAll(".ww-target").forEach((btn) => {
            btn.onclick = () => send({ t: "ww:night", type: "protect", targetId: btn.getAttribute("data-id") });
          });
        } else if (role === "witch") {
          const healLeft = Number(priv.witchHealLeft) || 0;
          const poisonLeft = Number(priv.witchPoisonLeft) || 0;
          el.action.innerHTML = `
            <p class="label">ยาแม่มด · ชุบชีวิตเหลือ ${healLeft} · พิษเหลือ ${poisonLeft}</p>
            <div class="ww-witch-actions">
              <button type="button" class="btn ghost" data-ww-act="pass">ไม่ใช้ยา</button>
              ${healLeft ? `<button type="button" class="btn ghost" data-ww-act="heal">ใช้ยาชุบชีวิต</button>` : ""}
              ${poisonLeft ? `<button type="button" class="btn ghost" data-ww-act="poison">ใช้ยาพิษ</button>` : ""}
            </div>
            <div data-ww="witchTargets"></div>
          `;
          const box = el.action.querySelector('[data-ww="witchTargets"]');
          el.action.querySelector('[data-ww-act="pass"]').onclick = () => send({ t: "ww:night", type: "pass" });
          const healBtn = el.action.querySelector('[data-ww-act="heal"]');
          const poisonBtn = el.action.querySelector('[data-ww-act="poison"]');
          if (healBtn) {
            healBtn.onclick = () => {
              box.innerHTML = `<p class="label">เลือกผู้ถูกชุบ</p>${targetButtons()}`;
              box.querySelectorAll(".ww-target").forEach((btn) => {
                btn.onclick = () => send({ t: "ww:night", type: "heal", targetId: btn.getAttribute("data-id") });
              });
            };
          }
          if (poisonBtn) {
            poisonBtn.onclick = () => {
              box.innerHTML = `<p class="label">เลือกผู้ถูกวางยา</p>${targetButtons(null, (p) => String(p.id) !== youId)}`;
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

      if (pub.phase === "VOTING" && pub.canVote) {
        el.action.classList.remove("hidden");
        el.action.innerHTML = `
          <p class="label">โหวตผู้ต้องสงสัย</p>
          ${targetButtons(null, (p) => String(p.id) !== youId)}
          <button type="button" class="btn ghost" data-ww-act="abstain">งดโหวต</button>
        `;
        el.action.querySelectorAll(".ww-target").forEach((btn) => {
          btn.onclick = () => send({ t: "ww:vote", targetId: btn.getAttribute("data-id") });
        });
        el.action.querySelector('[data-ww-act="abstain"]').onclick = () => send({ t: "ww:vote", targetId: null });
        return;
      }

      if (pub.phase === "HUNTER_SHOT" && pub.canHunterShot) {
        el.action.classList.remove("hidden");
        el.action.innerHTML = `
          <p class="label">ยิงครั้งสุดท้าย</p>
          ${targetButtons()}
          <button type="button" class="btn ghost" data-ww-act="skipShot">ไม่ยิง</button>
        `;
        el.action.querySelectorAll(".ww-target").forEach((btn) => {
          btn.onclick = () => send({ t: "ww:hunter", targetId: btn.getAttribute("data-id") });
        });
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
      lastPublic = pub || null;
      lastPrivate = priv || null;
      lastMeta = meta || lastMeta;
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
      paintRoster();
      paintLog();
      paintTallies();
    }

    const timer = setInterval(tickClock, 250);

    return {
      paint,
      halt() {
        clearInterval(timer);
      }
    };
  }

  window.NVWerewolf = { createLiveUi };
})();
