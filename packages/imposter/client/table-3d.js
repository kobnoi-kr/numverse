/**
 * Imposter 3D round table — visual style matched to the Claude Imposter 3D artifact:
 * purple table + "?" center, colorful capsule seats, speech bubbles, Imposter badge.
 * three.js r128 via cdnjs; falls back if WebGL/CDN unavailable.
 */
(function () {
  "use strict";

  const THREE_URL = "https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js";
  const SEAT_COLORS = [
    0xa78bfa, // violet
    0xfb923c, // orange
    0x38bdf8, // sky
    0xf472b6, // pink
    0x4ade80, // green
    0xfacc15, // yellow
    0x818cf8, // indigo
    0x2dd4bf // teal
  ];

  function loadThree() {
    if (window.THREE) return Promise.resolve(window.THREE);
    return new Promise((resolve, reject) => {
      const existing = document.querySelector('script[data-imp-three="1"]');
      if (existing) {
        existing.addEventListener("load", () => resolve(window.THREE));
        existing.addEventListener("error", () => reject(new Error("three_load_failed")));
        return;
      }
      const s = document.createElement("script");
      s.src = THREE_URL;
      s.async = true;
      s.dataset.impThree = "1";
      s.onload = () => (window.THREE ? resolve(window.THREE) : reject(new Error("three_missing")));
      s.onerror = () => reject(new Error("three_load_failed"));
      document.head.appendChild(s);
    });
  }

  function canWebGL() {
    try {
      const c = document.createElement("canvas");
      return !!(c.getContext("webgl") || c.getContext("experimental-webgl"));
    } catch (_) {
      return false;
    }
  }

  function roundRect(ctx, x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }

  function makeSprite(drawFn, w, h, worldH) {
    const THREE = window.THREE;
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    drawFn(ctx, canvas);
    const tex = new THREE.CanvasTexture(canvas);
    tex.minFilter = THREE.LinearFilter;
    const mat = new THREE.SpriteMaterial({
      map: tex,
      transparent: true,
      depthTest: false,
      depthWrite: false
    });
    const spr = new THREE.Sprite(mat);
    const aspect = w / h;
    spr.scale.set(worldH * aspect, worldH, 1);
    spr.userData._canvas = canvas;
    spr.userData._ctx = ctx;
    spr.userData._tex = tex;
    spr.userData._w = w;
    spr.userData._h = h;
    spr.userData._worldH = worldH;
    spr.userData.redraw = function (fn) {
      const c = spr.userData._canvas;
      const x = spr.userData._ctx;
      x.clearRect(0, 0, c.width, c.height);
      fn(x, c);
      spr.userData._tex.needsUpdate = true;
      spr.scale.set(spr.userData._worldH * (c.width / c.height), spr.userData._worldH, 1);
    };
    return spr;
  }

  function drawBubble(ctx, canvas, text, name, opts) {
    const clue = String(text || "").slice(0, 20);
    const who = String(name || "").slice(0, 12);
    const isImp = !!(opts && opts.imposter);
    const accent = isImp ? "#ef4444" : "#a78bfa";
    const bg = isImp ? "rgba(127,29,29,0.94)" : "rgba(15,23,42,0.94)";
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // speech bubble
    roundRect(ctx, 8, 8, canvas.width - 16, 70, 18);
    ctx.fillStyle = bg;
    ctx.fill();
    ctx.strokeStyle = accent;
    ctx.lineWidth = 3;
    ctx.stroke();
    // tail
    ctx.beginPath();
    ctx.moveTo(canvas.width / 2 - 10, 78);
    ctx.lineTo(canvas.width / 2, 92);
    ctx.lineTo(canvas.width / 2 + 10, 78);
    ctx.closePath();
    ctx.fillStyle = bg;
    ctx.fill();
    ctx.strokeStyle = accent;
    ctx.stroke();

    ctx.fillStyle = "#fff";
    ctx.font = "700 28px system-ui,Segoe UI,sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(clue || "…", canvas.width / 2, 36);

    ctx.fillStyle = isImp ? "#fecaca" : "#c4b5fd";
    ctx.font = "600 18px system-ui,Segoe UI,sans-serif";
    ctx.fillText(who, canvas.width / 2, 58);

    if (isImp) {
      roundRect(ctx, canvas.width / 2 - 54, 98, 108, 28, 10);
      ctx.fillStyle = "#dc2626";
      ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.font = "800 16px system-ui,Segoe UI,sans-serif";
      ctx.fillText("Imposter", canvas.width / 2, 112);
    }
  }

  function drawNameplate(ctx, canvas, name, flags) {
    const label = String(name || "Player").slice(0, 14);
    const turn = flags && flags.turn;
    const you = flags && flags.you;
    const vote = flags && flags.vote;
    const out = flags && flags.out;
    let bg = "rgba(15,23,42,0.9)";
    if (vote) bg = "rgba(220,38,38,0.92)";
    else if (turn) bg = "rgba(245,158,11,0.95)";
    else if (you) bg = "rgba(34,197,94,0.9)";
    else if (out) bg = "rgba(71,85,105,0.9)";
    roundRect(ctx, 4, 4, canvas.width - 8, canvas.height - 8, 14);
    ctx.fillStyle = bg;
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.font = "700 22px system-ui,Segoe UI,sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    let t = label;
    if (you) t += " (คุณ)";
    ctx.fillText(t, canvas.width / 2, canvas.height / 2);
  }

  function createTable3d(opts) {
    const mount = opts && opts.mount;
    if (!mount || !canWebGL()) return null;

    let THREE = window.THREE;
    let ready = false;
    let disposed = false;
    let scene;
    let camera;
    let renderer;
    let tableGroup;
    let seats = new Map();
    let raycaster;
    let pointer = { x: 0, y: 0 };
    let anim = 0;
    let lastState = null;
    let onVote = typeof opts.onVote === "function" ? opts.onVote : function () {};
    let onReady = typeof opts.onReady === "function" ? opts.onReady : function () {};
    let onFallback = typeof opts.onFallback === "function" ? opts.onFallback : function () {};

    mount.classList.add("imp-table3d");
    mount.innerHTML = "";
    const canvasHost = document.createElement("div");
    canvasHost.className = "imp-table3d-canvas";
    mount.appendChild(canvasHost);

    function size() {
      const w = Math.max(300, mount.clientWidth || 720);
      const h = Math.max(300, Math.min(520, Math.round(w * 0.72)));
      return { w, h };
    }

    function buildTable() {
      const g = new THREE.Group();

      const top = new THREE.Mesh(
        new THREE.CylinderGeometry(2.15, 2.2, 0.22, 64),
        new THREE.MeshStandardMaterial({
          color: 0x6d28d9,
          roughness: 0.35,
          metalness: 0.25,
          emissive: 0x4c1d95,
          emissiveIntensity: 0.25
        })
      );
      top.position.y = 0.18;
      g.add(top);

      const rim = new THREE.Mesh(
        new THREE.TorusGeometry(2.18, 0.08, 12, 64),
        new THREE.MeshStandardMaterial({
          color: 0xc4b5fd,
          emissive: 0x7c3aed,
          emissiveIntensity: 0.55,
          roughness: 0.4
        })
      );
      rim.rotation.x = Math.PI / 2;
      rim.position.y = 0.3;
      g.add(rim);

      // center "?" disc
      const qSpr = makeSprite(
        (ctx, canvas) => {
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          ctx.beginPath();
          ctx.arc(canvas.width / 2, canvas.height / 2, 70, 0, Math.PI * 2);
          ctx.fillStyle = "rgba(15,23,42,0.85)";
          ctx.fill();
          ctx.strokeStyle = "#c4b5fd";
          ctx.lineWidth = 6;
          ctx.stroke();
          ctx.fillStyle = "#e9d5ff";
          ctx.font = "800 90px system-ui,Segoe UI,sans-serif";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText("?", canvas.width / 2, canvas.height / 2 + 4);
        },
        180,
        180,
        1.1
      );
      qSpr.position.set(0, 0.55, 0);
      g.add(qSpr);

      const floor = new THREE.Mesh(
        new THREE.CircleGeometry(5.2, 64),
        new THREE.MeshStandardMaterial({ color: 0x0f0a1e, roughness: 1 })
      );
      floor.rotation.x = -Math.PI / 2;
      floor.position.y = 0;
      g.add(floor);

      return g;
    }

    function makeFaceTexture(initial, skinHex) {
      const canvas = document.createElement("canvas");
      canvas.width = 128;
      canvas.height = 128;
      const ctx = canvas.getContext("2d");
      const skin = "#" + (skinHex >>> 0).toString(16).padStart(6, "0");
      ctx.fillStyle = skin;
      ctx.beginPath();
      ctx.arc(64, 64, 60, 0, Math.PI * 2);
      ctx.fill();
      // eyes
      ctx.fillStyle = "#1e293b";
      ctx.beginPath();
      ctx.arc(44, 58, 8, 0, Math.PI * 2);
      ctx.arc(84, 58, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.beginPath();
      ctx.arc(46, 56, 3, 0, Math.PI * 2);
      ctx.arc(86, 56, 3, 0, Math.PI * 2);
      ctx.fill();
      // smile
      ctx.strokeStyle = "#9a3412";
      ctx.lineWidth = 4;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.arc(64, 68, 18, 0.15 * Math.PI, 0.85 * Math.PI);
      ctx.stroke();
      // blush
      ctx.fillStyle = "rgba(251, 113, 133, 0.35)";
      ctx.beginPath();
      ctx.ellipse(32, 74, 10, 6, 0, 0, Math.PI * 2);
      ctx.ellipse(96, 74, 10, 6, 0, 0, Math.PI * 2);
      ctx.fill();
      if (initial) {
        ctx.fillStyle = "rgba(15,23,42,0.18)";
        ctx.font = "700 22px system-ui,sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(String(initial).slice(0, 1).toUpperCase(), 64, 100);
      }
      const tex = new THREE.CanvasTexture(canvas);
      tex.minFilter = THREE.LinearFilter;
      return tex;
    }

    function buildSeat(id, name, avatarUrl, index, total, colorHex) {
      const group = new THREE.Group();
      group.userData.seatId = String(id);

      const bodyMat = new THREE.MeshStandardMaterial({
        color: colorHex,
        roughness: 0.42,
        metalness: 0.06,
        emissive: colorHex,
        emissiveIntensity: 0.18
      });

      // Chibi body: sphere torso + legs (no CapsuleGeometry — missing in three r128)
      const torso = new THREE.Mesh(new THREE.SphereGeometry(0.42, 20, 20), bodyMat);
      torso.scale.set(1, 1.15, 0.85);
      torso.position.y = 0.78;
      group.add(torso);

      const hips = new THREE.Mesh(new THREE.SphereGeometry(0.34, 16, 16), bodyMat);
      hips.scale.set(1.05, 0.7, 0.9);
      hips.position.y = 0.42;
      group.add(hips);

      const headMat = new THREE.MeshStandardMaterial({
        color: 0xffe0c8,
        roughness: 0.7,
        metalness: 0
      });
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.36, 24, 24), headMat);
      head.position.y = 1.42;
      group.add(head);

      // Face plane on the front of the head (local +Z); seat yaw faces outward so camera sees it
      const faceMat = new THREE.MeshBasicMaterial({
        map: makeFaceTexture((name || "?").trim().slice(0, 1), 0xffe0c8),
        transparent: true,
        depthWrite: false
      });
      const face = new THREE.Mesh(new THREE.CircleGeometry(0.33, 28), faceMat);
      face.position.set(0, 1.42, 0.34);
      group.add(face);

      if (avatarUrl) {
        const loader = new THREE.TextureLoader();
        loader.setCrossOrigin("anonymous");
        loader.load(
          avatarUrl,
          (tex) => {
            tex.minFilter = THREE.LinearFilter;
            face.material.map = tex;
            face.material.needsUpdate = true;
          },
          undefined,
          () => {}
        );
      }

      // soft glow ring under seat
      const glow = new THREE.Mesh(
        new THREE.RingGeometry(0.32, 0.5, 28),
        new THREE.MeshBasicMaterial({
          color: colorHex,
          transparent: true,
          opacity: 0.4,
          side: THREE.DoubleSide
        })
      );
      glow.rotation.x = -Math.PI / 2;
      glow.position.y = 0.03;
      group.add(glow);

      const plate = makeSprite(
        (ctx, canvas) => drawNameplate(ctx, canvas, name, {}),
        220,
        48,
        0.55
      );
      plate.position.set(0, 0.12, 0.62);
      group.add(plate);

      const bubble = makeSprite(
        (ctx, canvas) => drawBubble(ctx, canvas, "", name, {}),
        260,
        140,
        1.05
      );
      bubble.visible = false;
      bubble.position.set(0, 2.2, 0);
      group.add(bubble);

      // Even spacing for 4–8; face outward (+Z local) so faces read from the camera rim
      const n = Math.max(1, total);
      const angle = (index / n) * Math.PI * 2 - Math.PI / 2;
      const radius = 2.9;
      group.position.set(Math.cos(angle) * radius, 0, Math.sin(angle) * radius);
      group.rotation.y = Math.atan2(group.position.x, group.position.z);

      group.userData.body = torso;
      group.userData.head = head;
      group.userData.face = face;
      group.userData.glow = glow;
      group.userData.plate = plate;
      group.userData.bubble = bubble;
      group.userData.name = name;
      group.userData.color = colorHex;
      group.userData.bodyMat = bodyMat;
      return group;
    }

    function rebuildSeats(state, metaPlayers) {
      for (const g of seats.values()) scene.remove(g);
      seats.clear();
      const order = (state && state.order) || [];
      const n = order.length;
      if (!n) return;
      order.forEach((id, i) => {
        const sid = String(id);
        const meta = (metaPlayers || []).find((p) => p && String(p.id) === sid);
        const name =
          (state.names && (state.names[sid] || state.names[id])) ||
          (meta && meta.name) ||
          sid;
        const av = meta && meta.avatarUrl ? String(meta.avatarUrl) : "";
        const color = SEAT_COLORS[i % SEAT_COLORS.length];
        const g = buildSeat(sid, name, av, i, n, color);
        scene.add(g);
        seats.set(sid, g);
      });
    }

    let orderSig = "";

    function paint(state, meta) {
      lastState = state || null;
      if (!ready || !state) return;
      const metaPlayers = (meta && meta.players) || [];
      const ids = (state.order || []).map(String).filter(Boolean);
      if (!ids.length) return;
      const sig = ids.join("|");
      if (sig !== orderSig || seats.size !== ids.length || ids.some((id) => !seats.has(id))) {
        rebuildSeats(state, metaPlayers);
        orderSig = sig;
      }

      // If alive missing/empty, treat everyone as alive (avoid invisible faded seats)
      const aliveSrc =
        Array.isArray(state.alive) && state.alive.length ? state.alive : ids;
      const alive = new Set(aliveSrc.map(String));
      const youId = meta && meta.youId != null ? String(meta.youId) : "";
      const turnId =
        state.phase === "CARD_PICK"
          ? state.pickTurnId
          : state.phase === "CLUE_TURN"
            ? state.clueTurnId
            : null;
      const voteOn = state.phase === "VOTING" && state.canVote;
      const finished = state.phase === "FINISHED";
      const lastClueBy = {};
      (state.clues || []).forEach((c) => {
        if (c && c.playerId != null) lastClueBy[String(c.playerId)] = c.text || "";
      });

      seats.forEach((g, sid) => {
        const out = !alive.has(sid);
        const mine = youId && sid === youId;
        const turn = turnId && sid === String(turnId);
        const canVote = voteOn && !mine && !out;
        const isImp =
          finished && state.roles && state.roles[sid] === "imposter";
        g.userData.canVote = canVote;
        g.userData.out = out;

        const base = isImp ? 0xef4444 : g.userData.color;
        g.userData.bodyMat.color.setHex(out && !isImp ? 0x64748b : base);
        g.userData.bodyMat.emissive.setHex(isImp ? 0x7f1d1d : base);
        g.userData.bodyMat.emissiveIntensity = turn || isImp ? 0.35 : 0.12;
        const fade = out && !isImp ? 0.55 : 1;
        g.userData.bodyMat.opacity = fade;
        g.userData.bodyMat.transparent = fade < 1;
        g.userData.head.material.opacity = fade;
        g.userData.head.material.transparent = fade < 1;
        if (g.userData.face) {
          g.userData.face.material.opacity = fade;
          g.userData.face.material.transparent = true;
        }
        g.userData.glow.material.color.setHex(isImp ? 0xef4444 : base);
        g.userData.glow.material.opacity = canVote ? 0.7 : turn ? 0.55 : 0.35;

        g.userData.plate.userData.redraw((ctx, canvas) =>
          drawNameplate(ctx, canvas, g.userData.name, {
            turn: !!turn,
            you: !!mine,
            vote: !!canVote,
            out: !!out && !isImp
          })
        );

        const clueText = lastClueBy[sid];
        if (clueText || isImp) {
          g.userData.bubble.visible = true;
          g.userData.bubble.userData.redraw((ctx, canvas) =>
            drawBubble(ctx, canvas, clueText || (isImp ? "Imposter" : ""), g.userData.name, {
              imposter: isImp
            })
          );
        } else {
          g.userData.bubble.visible = false;
        }
      });
    }

    function onPointer(e) {
      if (!ready || !lastState || lastState.phase !== "VOTING" || !lastState.canVote) return;
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const targets = [];
      seats.forEach((g) => {
        [g.userData.body, g.userData.head, g.userData.face, g.userData.plate, g.userData.bubble]
          .filter(Boolean)
          .forEach((m) => targets.push(m));
      });
      const hits = raycaster.intersectObjects(targets, true);
      if (!hits.length) return;
      let obj = hits[0].object;
      while (obj && !obj.userData.seatId) obj = obj.parent;
      if (!obj || !obj.userData.canVote) return;
      onVote(String(obj.userData.seatId));
    }

    function loop() {
      if (disposed) return;
      anim = requestAnimationFrame(loop);
      if (tableGroup) tableGroup.rotation.y += 0.0008;
      seats.forEach((g) => {
        if (g.userData.plate) g.userData.plate.quaternion.copy(camera.quaternion);
        if (g.userData.bubble && g.userData.bubble.visible) {
          g.userData.bubble.quaternion.copy(camera.quaternion);
        }
      });
      renderer.render(scene, camera);
    }

    function resize() {
      if (!renderer || !camera) return;
      const { w, h } = size();
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h, false);
    }

    function dispose() {
      disposed = true;
      cancelAnimationFrame(anim);
      window.removeEventListener("resize", resize);
      if (renderer && renderer.domElement) {
        renderer.domElement.removeEventListener("click", onPointer);
      }
      if (renderer) {
        renderer.dispose();
        if (renderer.domElement && renderer.domElement.parentNode) {
          renderer.domElement.parentNode.removeChild(renderer.domElement);
        }
      }
      seats.clear();
      orderSig = "";
      mount.classList.remove("is-active");
      mount.innerHTML = "";
    }

    loadThree()
      .then((T) => {
        if (disposed) return;
        THREE = T;
        const { w, h } = size();
        scene = new THREE.Scene();
        scene.background = new THREE.Color(0x12081f);
        scene.fog = new THREE.Fog(0x12081f, 8, 18);

        camera = new THREE.PerspectiveCamera(40, w / h, 0.1, 100);
        camera.position.set(0, 5.1, 7.4);
        camera.lookAt(0, 0.7, 0);

        renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
        renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
        renderer.setSize(w, h, false);
        canvasHost.appendChild(renderer.domElement);

        const hemi = new THREE.HemisphereLight(0xf5e9ff, 0x1e1033, 1.05);
        scene.add(hemi);
        const key = new THREE.DirectionalLight(0xffffff, 0.75);
        key.position.set(2.5, 9, 4);
        scene.add(key);
        const fill = new THREE.PointLight(0xa78bfa, 0.55, 20);
        fill.position.set(-2, 3, 2);
        scene.add(fill);

        tableGroup = buildTable();
        scene.add(tableGroup);

        raycaster = new THREE.Raycaster();
        renderer.domElement.addEventListener("click", onPointer);
        window.addEventListener("resize", resize);
        ready = true;
        mount.classList.add("is-active");
        onReady();
        loop();
        if (lastState) paint(lastState, opts.meta || null);
      })
      .catch(() => {
        dispose();
        onFallback();
      });

    return {
      paint,
      dispose,
      isReady: () => ready && !disposed
    };
  }

  window.NVImposterTable3D = { createTable3d, loadThree };
})();
