(function () {
  "use strict";

  function esc(s) {
    return String(s || "").replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
    );
  }

  function phaseLabel(phase) {
    const map = {
      CARD_PICK: "จั่วการ์ด",
      ROLE_REVEAL: "เปิดบทบาท",
      CLUE_TURN: "ให้คำใบ้",
      DISCUSSION: "พูดคุย",
      VOTING: "โหวต",
      VOTE_RESULT: "ผลโหวต",
      GUESS: "Imposter ทายคำ",
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

  function initialOf(name) {
    const t = String(name || "?").trim();
    return t ? t.slice(0, 1).toUpperCase() : "?";
  }

  function createLiveUi(opts) {
    const root = opts.root;
    const send = opts.send || function () {};
    let lastPrivate = null;
    let lastPublic = null;
    let lastMeta = { players: [], youId: "" };
    let pickedVote = null;
    let popupOpen = false;
    let cluePopupOpen = false;
    let guessPopupOpen = false;
    let clueDismissedKey = "";
    let lastCountdownSec = -1;
    let clockKey = 0;
    let localDeadline = 0;

    root.innerHTML = `
      <div class="imp-root">
        <div class="imp-phase">
          <h2 class="imp-phase-title" data-imp="phaseTitle">—</h2>
          <div class="imp-timer" data-imp="timer">—</div>
        </div>
        <p class="sub" data-imp="sub"></p>
        <div class="imp-card-grid hidden" data-imp="cardGrid" role="group" aria-label="การ์ดบทบาท"></div>
        <div class="imp-you-profile hidden" data-imp="youProfile" aria-live="polite"></div>
        <div class="imp-table3d" data-imp="table3d" aria-label="โต๊ะผู้เล่น 3D"></div>
        <div class="imp-roster" data-imp="roster" role="list" aria-label="ผู้เล่นในห้อง"></div>
        <button class="btn imp-clue-reopen hidden" type="button" data-imp="clueReopen">เขียนคำใบ้</button>
        <ul class="imp-clue-board" data-imp="clues"></ul>
        <button class="btn ghost hidden" type="button" data-imp="abstain">งดโหวต</button>
        <ul class="imp-tallies hidden" data-imp="tallies"></ul>
      </div>
    `;

    let table3d = null;
    let table3dActive = false;

    // Mount overlays on body so they are never clipped by stage/layout.
    let overlay = document.getElementById("impRoleOverlay");
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.id = "impRoleOverlay";
      overlay.className = "imp-overlay hidden";
      overlay.setAttribute("role", "dialog");
      overlay.setAttribute("aria-modal", "true");
      overlay.innerHTML = `
        <div class="imp-popup" data-imp-pop="popup">
          <div class="imp-pop-timer" data-imp-pop="timer">—</div>
          <h2 data-imp-pop="popTitle"></h2>
          <div class="imp-word" data-imp-pop="popWord"></div>
          <p class="imp-hint" data-imp-pop="popHint"></p>
          <button type="button" class="btn" data-imp-pop="popOk">เข้าใจแล้ว</button>
        </div>`;
      document.body.appendChild(overlay);
    }

    let clueOverlay = document.getElementById("impClueOverlay");
    if (!clueOverlay) {
      clueOverlay = document.createElement("div");
      clueOverlay.id = "impClueOverlay";
      clueOverlay.className = "imp-overlay hidden";
      clueOverlay.setAttribute("role", "dialog");
      clueOverlay.setAttribute("aria-modal", "true");
      clueOverlay.setAttribute("aria-labelledby", "impClueTitle");
      clueOverlay.innerHTML = `
        <div class="imp-popup imp-clue-popup">
          <div class="imp-pop-timer" data-imp-clue="timer">—</div>
          <h2 id="impClueTitle">ให้คำใบ้</h2>
          <p class="imp-hint" data-imp-clue="round">พิมพ์คำใบ้สั้นๆ โดยไม่พูดคำศัพท์ตรงๆ</p>
          <form class="imp-clue-popup-form" data-imp-clue="form" autocomplete="off">
            <input data-imp-clue="input" maxlength="32" placeholder="พิมพ์คำใบ้ 1 คำ/สั้นๆ" aria-label="คำใบ้">
            <div class="imp-clue-popup-actions">
              <button class="btn imp-clue-side" type="button" data-imp-clue="peek">ดูคำใบ้คนอื่น</button>
              <button class="btn imp-clue-side" type="button" data-imp-clue="skip">ข้าม</button>
              <button class="btn" type="submit">ส่งคำใบ้</button>
            </div>
          </form>
        </div>`;
      document.body.appendChild(clueOverlay);
    }

    let guessOverlay = document.getElementById("impGuessOverlay");
    if (!guessOverlay) {
      guessOverlay = document.createElement("div");
      guessOverlay.id = "impGuessOverlay";
      guessOverlay.className = "imp-overlay hidden";
      guessOverlay.setAttribute("role", "dialog");
      guessOverlay.setAttribute("aria-modal", "true");
      guessOverlay.setAttribute("aria-labelledby", "impGuessTitle");
      guessOverlay.innerHTML = `
        <div class="imp-popup imp-clue-popup is-imposter">
          <div class="imp-pop-timer" data-imp-guess="timer">—</div>
          <h2 id="impGuessTitle">ทายคำศัพท์</h2>
          <p class="imp-hint">คุณถูกจับแล้ว — ทายคำให้ถูกเพื่อให้ Imposter ชนะ</p>
          <form class="imp-clue-popup-form" data-imp-guess="form" autocomplete="off">
            <input data-imp-guess="input" maxlength="48" placeholder="ทายคำศัพท์" aria-label="ทายคำ">
            <div class="imp-clue-popup-actions">
              <button class="btn" type="submit">ทายคำ</button>
            </div>
          </form>
        </div>`;
      document.body.appendChild(guessOverlay);
    }

    const $ = (k) => root.querySelector('[data-imp="' + k + '"]');
    const $p = (k) => overlay.querySelector('[data-imp-pop="' + k + '"]');
    const $c = (k) => clueOverlay.querySelector('[data-imp-clue="' + k + '"]');
    const $g = (k) => guessOverlay.querySelector('[data-imp-guess="' + k + '"]');
    const popup = $p("popup");
    const clueForm = $c("form");
    const clueInput = $c("input");
    const guessForm = $g("form");
    const guessInput = $g("input");
    const tableMount = $("table3d");
    const rosterEl = $("roster");

    function setTableMode(on) {
      table3dActive = !!on;
      if (tableMount) tableMount.classList.toggle("is-active", table3dActive);
      if (rosterEl) rosterEl.classList.toggle("imp-roster-fallback", !table3dActive);
      if (rosterEl) rosterEl.classList.toggle("hidden", table3dActive);
    }
    setTableMode(false);

    if (
      tableMount &&
      window.NVImposterTable3D &&
      typeof window.NVImposterTable3D.createTable3d === "function"
    ) {
      table3d = window.NVImposterTable3D.createTable3d({
        mount: tableMount,
        onVote(targetId) {
          pickedVote = targetId;
          send({ t: "imposter:vote", targetId });
          if (lastPublic) paintRoster(lastPublic);
          if (table3d && lastPublic) {
            table3d.paint(lastPublic, {
              players: lastMeta.players,
              youId: String((opts.youId && opts.youId()) || lastMeta.youId || "")
            });
          }
        },
        onReady() {
          setTableMode(true);
          if (lastPublic) {
            table3d.paint(lastPublic, {
              players: lastMeta.players,
              youId: String((opts.youId && opts.youId()) || lastMeta.youId || "")
            });
          }
        },
        onFallback() {
          table3d = null;
          setTableMode(false);
        }
      });
      if (!table3d) setTableMode(false);
    }

    function confirmRole() {
      popupOpen = false;
      overlay.classList.add("hidden");
      send({ t: "imposter:confirm" });
    }

    function clueTurnKey(state) {
      if (!state) return "";
      return [state.cluePass || state.round || 0, state.clueIndex || 0, state.clueTurnId || ""].join(":");
    }

    function replayPop(el) {
      if (!el) return;
      const card = el.querySelector(".imp-popup");
      el.classList.remove("is-pop");
      if (card) card.classList.remove("is-pop");
      void el.offsetWidth;
      el.classList.add("is-pop");
      if (card) card.classList.add("is-pop");
    }

    function syncClueReopen(state) {
      const btn = $("clueReopen");
      if (!btn) return;
      const on = !!(
        state &&
        state.phase === "CLUE_TURN" &&
        state.yourTurn &&
        clueOverlay.classList.contains("hidden")
      );
      btn.classList.toggle("hidden", !on);
      btn.setAttribute("aria-expanded", on ? "false" : "true");
    }

    function hideCluePopup() {
      cluePopupOpen = false;
      clueOverlay.classList.add("hidden");
      clueOverlay.classList.remove("is-pop");
      const card = clueOverlay.querySelector(".imp-popup");
      if (card) card.classList.remove("is-pop");
    }

    function syncClueSub(state) {
      const el = $("sub");
      if (!el || !state || state.phase !== "CLUE_TURN" || !state.yourTurn) return;
      el.textContent = clueOverlay.classList.contains("hidden")
        ? "ถึงตาคุณให้คำใบ้ — กดเขียนคำใบ้เมื่อพร้อม หรือดูคำใบ้ด้านล่าง"
        : "ถึงตาคุณให้คำใบ้ — กรอกในหน้าต่าง หรือกดดูคำใบ้คนอื่น";
    }

    function dismissCluePopup() {
      if (lastPublic && lastPublic.phase === "CLUE_TURN" && lastPublic.yourTurn) {
        clueDismissedKey = clueTurnKey(lastPublic);
      }
      hideCluePopup();
      syncClueReopen(lastPublic);
      syncClueSub(lastPublic);
    }

    function showCluePopup() {
      const wasHidden = clueOverlay.classList.contains("hidden");
      clueDismissedKey = "";
      clueOverlay.classList.remove("hidden");
      if (wasHidden) replayPop(clueOverlay);
      cluePopupOpen = true;
      if (wasHidden) {
        setTimeout(() => {
          try {
            clueInput.focus();
          } catch (_) {}
        }, 40);
      }
      syncClueReopen(lastPublic);
      syncClueSub(lastPublic);
    }

    function hideGuessPopup() {
      guessPopupOpen = false;
      guessOverlay.classList.add("hidden");
      guessOverlay.classList.remove("is-pop");
      const card = guessOverlay.querySelector(".imp-popup");
      if (card) card.classList.remove("is-pop");
    }

    function showGuessPopup() {
      const wasHidden = guessOverlay.classList.contains("hidden");
      guessOverlay.classList.remove("hidden");
      if (wasHidden) replayPop(guessOverlay);
      if (!guessPopupOpen) {
        guessPopupOpen = true;
        setTimeout(() => {
          try {
            guessInput.focus();
          } catch (_) {}
        }, 40);
      }
    }

    clueForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const text = (clueInput.value || "").trim();
      if (!text) return;
      send({ t: "imposter:clue", text });
      dismissCluePopup();
    });
    $c("skip").onclick = () => {
      send({ t: "imposter:skipClue" });
      clueInput.value = "";
      dismissCluePopup();
    };
    $c("peek").onclick = () => dismissCluePopup();
    clueOverlay.addEventListener("click", (e) => {
      if (e.target === clueOverlay) dismissCluePopup();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape" || clueOverlay.classList.contains("hidden")) return;
      if (!lastPublic || lastPublic.phase !== "CLUE_TURN" || !lastPublic.yourTurn) return;
      e.preventDefault();
      dismissCluePopup();
    });
    $("clueReopen").onclick = () => {
      if (!lastPublic || lastPublic.phase !== "CLUE_TURN" || !lastPublic.yourTurn) return;
      showCluePopup();
    };
    $("abstain").onclick = () => {
      pickedVote = null;
      send({ t: "imposter:vote", targetId: null });
    };
    guessForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const word = (guessInput.value || "").trim();
      if (!word) return;
      send({ t: "imposter:guess", word });
      guessInput.value = "";
      hideGuessPopup();
    });
    $p("popOk").onclick = confirmRole;

    function playerMeta(id) {
      const list = lastMeta.players || [];
      return list.find((p) => p && String(p.id) === String(id)) || null;
    }

    function avatarHtml(meta, name, cls) {
      const av = meta && meta.avatarUrl ? String(meta.avatarUrl) : "";
      if (av) {
        return `<img class="${cls}" src="${esc(av)}" alt="" loading="lazy">`;
      }
      return `<div class="${cls} is-ph" aria-hidden="true">${esc(initialOf(name))}</div>`;
    }

    function fillRoleCopy(priv, titleEl, wordEl, hintEl) {
      const isImp = priv.role === "imposter";
      if (isImp) {
        titleEl.textContent = "YOU ARE THE IMPOSTER";
        wordEl.textContent = priv.category ? "หมวด: " + priv.category : "คุณคือ Imposter!";
        hintEl.textContent = priv.category
          ? "คุณเห็นแค่หมวดหมู่ — สังเกตคำใบ้แล้วกลมกลืน"
          : "พยายามสังเกตคำใบ้ของผู้เล่นคนอื่น และกลมกลืนไปกับพวกเขา";
      } else {
        titleEl.textContent = "YOUR WORD";
        wordEl.textContent = priv.word || "—";
        hintEl.textContent = "จดจำคำศัพท์ของคุณ และให้คำใบ้โดยไม่พูดคำศัพท์ตรง ๆ";
      }
      return isImp;
    }

    function showPopup(priv) {
      if (!priv || !priv.role) return;
      const wasHidden = overlay.classList.contains("hidden");
      const isImp = fillRoleCopy(priv, $p("popTitle"), $p("popWord"), $p("popHint"));
      popup.classList.toggle("is-imposter", isImp);
      overlay.classList.remove("hidden");
      popupOpen = true;
      if (wasHidden) replayPop(overlay);
    }

    function paintYouProfile(state, priv) {
      const box = $("youProfile");
      if (!box) return;
      const youId = String((opts.youId && opts.youId()) || lastMeta.youId || "");
      const show = !!(priv && priv.role && youId);
      box.classList.toggle("hidden", !show);
      if (!show) {
        box.innerHTML = "";
        return;
      }
      const isImp = priv.role === "imposter";
      const meta = playerMeta(youId);
      const name = (state.names && state.names[youId]) || (meta && meta.name) || "คุณ";
      const needConfirm = state.phase === "ROLE_REVEAL" && !priv.confirmed;
      const secretLabel = isImp ? "บทบาท" : "คำศัพท์";
      const secretValue = isImp ? "Imposter" : priv.word || "—";
      const catRow =
        isImp && priv.category
          ? `<div class="imp-you-stat"><span class="label">หมวดหมู่</span><b>${esc(priv.category)}</b></div>`
          : "";
      box.classList.toggle("is-imposter", isImp);
      box.innerHTML = `
        <div class="imp-you-head">
          ${avatarHtml(meta, name, "imp-you-av")}
          <div class="imp-you-id">
            <p class="imp-you-kicker">${isImp ? "คุณคือ Imposter" : "ผู้เล่นปกติ"}</p>
            <h3>${esc(name)}</h3>
            <p class="sub">โปรไฟล์ของคุณ · คนอื่นมองไม่เห็นข้อมูลนี้</p>
          </div>
        </div>
        <div class="imp-you-stats">
          <div class="imp-you-stat${isImp ? " is-danger" : ""}">
            <span class="label">${secretLabel}</span>
            <b>${esc(secretValue)}</b>
          </div>
          ${catRow}
        </div>
        ${
          needConfirm
            ? `<button type="button" class="btn sm" data-imp="roleOk">เข้าใจแล้ว</button>`
            : ""
        }
      `;
      const ok = box.querySelector('[data-imp="roleOk"]');
      if (ok) ok.onclick = confirmRole;
    }

    function paintRoster(state) {
      const roster = $("roster");
      if (!roster) return;
      const aliveSet = new Set(state.alive || []);
      const youId = String((opts.youId && opts.youId()) || lastMeta.youId || "");
      const turnId =
        state.phase === "CARD_PICK"
          ? state.pickTurnId
          : state.phase === "CLUE_TURN"
            ? state.clueTurnId
            : null;
      const voteOn = state.phase === "VOTING" && state.canVote;
      roster.classList.toggle("is-voting", state.phase === "VOTING");
      roster.innerHTML = (state.order || [])
        .map((id) => {
          const sid = String(id);
          const meta = playerMeta(sid);
          const name = (state.names && state.names[sid]) || (meta && meta.name) || sid;
          const out = !aliveSet.has(sid);
          const mine = youId && sid === youId;
          const turn = turnId && sid === String(turnId);
          const canVoteTarget = voteOn && !mine && !out;
          const picked = pickedVote === sid;
          const tag = canVoteTarget ? "button" : "div";
          const cls =
            "imp-seat" +
            (out ? " is-out" : "") +
            (mine ? " is-you" : "") +
            (turn ? " is-turn" : "") +
            (canVoteTarget ? " is-voteable" : "") +
            (picked ? " is-picked" : "");
          let badge = "";
          if (state.phase === "FINISHED" && state.roles && state.roles[sid]) {
            badge =
              state.roles[sid] === "imposter"
                ? `<span class="imp-seat-badge is-imp">Imposter</span>`
                : `<span class="imp-seat-badge">ปกติ</span>`;
          } else if (picked) {
            badge = `<span class="imp-seat-badge is-picked">โหวตแล้ว</span>`;
          } else if (out) {
            badge = `<span class="imp-seat-badge">ตกรอบ</span>`;
          } else if (canVoteTarget) {
            badge = `<span class="imp-seat-badge is-vote">กดเพื่อโหวต</span>`;
          } else if (turn) {
            badge = `<span class="imp-seat-badge is-turn">ตานี้</span>`;
          }
          const voteAttr = canVoteTarget ? ` type="button" data-vote="${esc(sid)}"` : "";
          return `
            <${tag} class="${cls}" role="listitem"${voteAttr}>
              ${avatarHtml(meta, name, "imp-seat-av")}
              <div class="imp-seat-meta">
                <span class="imp-seat-name">${esc(name)}${mine ? " (คุณ)" : ""}</span>
                ${badge}
              </div>
            </${tag}>`;
        })
        .join("");

      if (voteOn) {
        roster.querySelectorAll("[data-vote]").forEach((btn) => {
          btn.onclick = () => {
            pickedVote = btn.getAttribute("data-vote");
            send({ t: "imposter:vote", targetId: pickedVote });
            paintRoster(state);
          };
        });
      }
    }

    function paintCards(state) {
      const grid = $("cardGrid");
      if (!grid) return;
      const show = state.phase === "CARD_PICK";
      grid.classList.toggle("hidden", !show);
      if (!show) {
        grid.innerHTML = "";
        return;
      }
      const canPick = !!state.canPickCard;
      grid.innerHTML = (state.cards || [])
        .map((c) => {
          const taken = !!c.taken;
          const cls = "imp-face-card" + (taken ? " is-taken" : canPick ? " is-pickable" : "");
          const label = taken ? esc(c.takenByName || "จั่วแล้ว") : "??";
          const disabled = taken || !canPick ? " disabled" : "";
          return `<button type="button" class="${cls}" data-card="${c.id}"${disabled} aria-label="${
            taken ? "การ์ดถูกจั่วแล้ว" : "จั่วการ์ด"
          }"><span class="imp-face-inner">${label}</span></button>`;
        })
        .join("");
      grid.querySelectorAll("[data-card]").forEach((btn) => {
        btn.onclick = () => {
          if (!canPick || btn.disabled) return;
          send({ t: "imposter:pickCard", cardId: Number(btn.getAttribute("data-card")) });
        };
      });
    }

    function paint(state, priv, meta) {
      lastPublic = state || null;
      if (priv) lastPrivate = priv;
      if (meta) {
        lastMeta = {
          players: Array.isArray(meta.players) ? meta.players : lastMeta.players || [],
          youId: meta.youId != null ? String(meta.youId) : lastMeta.youId || ""
        };
      }
      if (!state) return;

      const clueLap = state.phase === "CLUE_TURN";
      $("phaseTitle").textContent = clueLap
        ? phaseLabel(state.phase) +
          " · รอบ " +
          (state.cluePass || 1) +
          "/" +
          (state.maxRounds || 1)
        : phaseLabel(state.phase);
      renderClock();
      const clueRound = $c("round");
      if (clueRound) {
        clueRound.textContent = clueLap
          ? "รอบ " +
            (state.cluePass || 1) +
            "/" +
            (state.maxRounds || 1) +
            " · พิมพ์คำใบ้สั้นๆ โดยไม่พูดคำศัพท์ตรงๆ"
          : "พิมพ์คำใบ้สั้นๆ โดยไม่พูดคำศัพท์ตรงๆ";
      }

      const turnName =
        state.phase === "CARD_PICK"
          ? state.pickTurnId && state.names
            ? state.names[state.pickTurnId] || "—"
            : ""
          : state.clueTurnId && state.names
            ? state.names[state.clueTurnId] || "—"
            : "";
      let sub = "";
      if (state.phase === "CARD_PICK")
        sub = state.canPickCard
          ? "ถึงตาคุณ — เลือกการ์ด 1 ใบ (ซ่อนไว้ ไม่รู้ว่าเป็น Imposter หรือคนปกติ)"
          : "รอ " + turnName + " จั่วการ์ด";
      else if (state.phase === "ROLE_REVEAL") sub = "ดูบทบาทของคุณด้านล่าง / หน้าต่างกลางจอ";
      else if (state.phase === "CLUE_TURN") {
        const closed = !!(state.yourTurn && clueDismissedKey === clueTurnKey(state));
        sub = state.yourTurn
          ? closed
            ? "ถึงตาคุณให้คำใบ้ — กดเขียนคำใบ้เมื่อพร้อม หรือดูคำใบ้ด้านล่าง"
            : "ถึงตาคุณให้คำใบ้ — กรอกในหน้าต่าง หรือกดดูคำใบ้คนอื่น"
          : "รอ " + turnName + " ให้คำใบ้";
      }
      else if (state.phase === "DISCUSSION") sub = "คุยกันผ่านแชทในห้อง";
      else if (state.phase === "VOTING")
        sub = state.canVote
          ? table3dActive
            ? "คลิกตัวละครหรือป้ายชื่อบนโต๊ะเพื่อโหวต (โหวตตัวเองไม่ได้)"
            : "กดที่โปรไฟล์ผู้ต้องสงสัยเพื่อโหวต (โหวตตัวเองไม่ได้)"
          : "รอผลโหวตจากผู้เล่นคนอื่น";
      else if (state.phase === "VOTE_RESULT") sub = "สรุปผลโหวต";
      else if (state.phase === "GUESS")
        sub = state.canGuess
          ? "ถึงตาคุณทายคำ — กรอกในหน้าต่างกลางจอ"
          : "รอ Imposter ที่ถูกจับทายคำศัพท์";
      else if (state.phase === "FINISHED") sub = state.winReason || "";
      $("sub").textContent = sub;

      paintCards(state);
      paintYouProfile(state, lastPrivate);
      if (state.phase !== "VOTING") pickedVote = null;
      paintRoster(state);
      if (table3d && table3dActive) {
        table3d.paint(state, {
          players: lastMeta.players,
          youId: String((opts.youId && opts.youId()) || lastMeta.youId || "")
        });
      }

      const showPass = (state.maxRounds || 1) > 1;
      $("clues").innerHTML = (state.clues || [])
        .map((c) => {
          const who =
            (showPass ? "รอบ " + (c.pass || 1) + " · " : "") + (c.name || "");
          return `<li><span class="who">${esc(who)}</span><span class="text">${esc(c.text)}</span></li>`;
        })
        .join("");

      const clueOn = state.phase === "CLUE_TURN" && state.yourTurn;
      if (!clueOn) {
        clueDismissedKey = "";
        clueInput.value = "";
        hideCluePopup();
      } else if (clueDismissedKey !== clueTurnKey(state)) {
        showCluePopup();
      }
      syncClueReopen(state);

      const voteOn = state.phase === "VOTING" && state.canVote;
      $("abstain").classList.toggle("hidden", !voteOn);

      const tallies = state.voteTallies && state.voteTallies.entries;
      $("tallies").classList.toggle(
        "hidden",
        !(state.phase === "VOTE_RESULT" || state.phase === "FINISHED") || !tallies
      );
      if (tallies) {
        $("tallies").innerHTML = tallies
          .map((t) => `<li><span>${esc(t.name)}</span><b>${t.count} โหวต</b></li>`)
          .join("");
      }

      const guessOn = state.phase === "GUESS" && state.canGuess;
      if (guessOn) showGuessPopup();
      else hideGuessPopup();

      if (
        state.phase === "ROLE_REVEAL" &&
        lastPrivate &&
        lastPrivate.role &&
        !lastPrivate.confirmed
      ) {
        if (!popupOpen || overlay.classList.contains("hidden")) showPopup(lastPrivate);
      } else {
        popupOpen = false;
        overlay.classList.add("hidden");
      }
    }

    function paintTimers(text, urgent) {
      [$("timer"), $c("timer"), $g("timer"), $p("timer")].forEach((el) => {
        if (!el) return;
        el.textContent = text;
        el.classList.toggle("is-urgent", urgent);
      });
    }

    function syncClock(state) {
      const ends = state && state.phaseEndsAt ? state.phaseEndsAt : 0;
      if (!ends) {
        clockKey = 0;
        localDeadline = 0;
        return 0;
      }
      if (ends !== clockKey) {
        clockKey = ends;
        const reported = Number(state.phaseLeft);
        const remain = Number.isFinite(reported) ? Math.max(0, reported) : 0;
        localDeadline = Date.now() + remain;
        lastCountdownSec = -1;
      }
      return Math.max(0, localDeadline - Date.now());
    }

    function renderClock() {
      const timer = $("timer");
      if (!timer) return;
      if (!lastPublic || !lastPublic.phaseEndsAt) {
        lastCountdownSec = -1;
        paintTimers("—", false);
        return;
      }
      const left = syncClock(lastPublic);
      const text = formatLeft(left);
      const sec = left > 0 ? Math.ceil(left / 1000) : 0;
      const phase = lastPublic.phase;
      const countdownPhase =
        phase === "CARD_PICK" ||
        phase === "ROLE_REVEAL" ||
        phase === "CLUE_TURN" ||
        phase === "DISCUSSION" ||
        phase === "VOTING" ||
        phase === "GUESS";
      const urgent = countdownPhase && sec > 0 && sec <= 5;
      paintTimers(text, urgent);
      if (!urgent) {
        lastCountdownSec = -1;
        return;
      }
      if (sec === lastCountdownSec) return;
      lastCountdownSec = sec;
      if (typeof opts.onCountdown === "function") opts.onCountdown(sec);
    }
    function tickClock() {
      renderClock();
    }
    setInterval(tickClock, 250);

    function halt() {
      lastPublic = null;
      clockKey = 0;
      localDeadline = 0;
      lastCountdownSec = -1;
      clueDismissedKey = "";
      hideCluePopup();
      hideGuessPopup();
      popupOpen = false;
      overlay.classList.add("hidden");
      paintTimers("—", false);
      if (table3d && typeof table3d.dispose === "function") {
        try {
          table3d.dispose();
        } catch (_) {}
      }
      table3d = null;
      setTableMode(false);
    }

    return {
      paint,
      halt,
      setYouId(fn) {
        opts.youId = fn;
      }
    };
  }

  window.NVImposter = { createLiveUi };
})();
