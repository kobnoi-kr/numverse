/**
 * Imposter 3D round table (three.js r128 via cdnjs).
 * Fallback: returns null / calls onFallback so live-ui keeps the 2D roster.
 */
(function () {
  "use strict";

  const THREE_URL = "https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js";

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

  function makeLabel(text, opts) {
    const THREE = window.THREE;
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    const padX = 18;
    const padY = 10;
    const font = (opts && opts.font) || "700 28px system-ui,Segoe UI,sans-serif";
    ctx.font = font;
    const tw = Math.ceil(ctx.measureText(text).width);
    canvas.width = Math.max(64, tw + padX * 2);
    canvas.height = 48;
    ctx.font = font;
    ctx.fillStyle = (opts && opts.bg) || "rgba(8,12,22,0.88)";
    roundRect(ctx, 0, 0, canvas.width, canvas.height, 12);
    ctx.fill();
    ctx.fillStyle = (opts && opts.fg) || "#fff";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, canvas.width / 2, canvas.height / 2);
    const tex = new THREE.CanvasTexture(canvas);
    tex.minFilter = THREE.LinearFilter;
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
    const spr = new THREE.Sprite(mat);
    const scale = (opts && opts.scale) || 0.9;
    spr.scale.set((canvas.width / canvas.height) * scale, scale, 1);
    spr.userData._canvas = canvas;
    spr.userData._ctx = ctx;
    spr.userData._tex = tex;
    spr.userData.setText = function (next, style) {
      const c = spr.userData._canvas;
      const x = spr.userData._ctx;
      x.font = (style && style.font) || font;
      const w = Math.ceil(x.measureText(next).width);
      c.width = Math.max(64, w + padX * 2);
      c.height = 48;
      x.font = (style && style.font) || font;
      x.fillStyle = (style && style.bg) || "rgba(8,12,22,0.88)";
      roundRect(x, 0, 0, c.width, c.height, 12);
      x.fill();
      x.fillStyle = (style && style.fg) || "#fff";
      x.textAlign = "center";
      x.textBaseline = "middle";
      x.fillText(next, c.width / 2, c.height / 2);
      spr.userData._tex.needsUpdate = true;
      const sc = (style && style.scale) || scale;
      spr.scale.set((c.width / c.height) * sc, sc, 1);
    };
    return spr;
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

  function createTable3d(opts) {
    const mount = opts && opts.mount;
    if (!mount || !canWebGL()) return null;

    let THREE = window.THREE;
    let ready = false;
    let disposed = false;
    let scene;
    let camera;
    let renderer;
    let table;
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
      const w = Math.max(280, mount.clientWidth || 640);
      const h = Math.max(260, Math.min(480, Math.round(w * 0.62)));
      return { w, h };
    }

    function buildSeat(id, name, avatarUrl, index, total) {
      const group = new THREE.Group();
      group.userData.seatId = String(id);

      const body = new THREE.Mesh(
        new THREE.CapsuleGeometry(0.28, 0.55, 4, 10),
        new THREE.MeshStandardMaterial({ color: 0x4b6cb7, roughness: 0.35, metalness: 0.05 })
      );
      body.position.y = 0.7;
      body.castShadow = false;
      group.add(body);

      const head = new THREE.Mesh(
        new THREE.SphereGeometry(0.26, 16, 16),
        new THREE.MeshStandardMaterial({ color: 0xf2d6c2, roughness: 0.7 })
      );
      head.position.y = 1.28;
      group.add(head);

      if (avatarUrl) {
        const loader = new THREE.TextureLoader();
        loader.setCrossOrigin("anonymous");
        loader.load(
          avatarUrl,
          (tex) => {
            tex.minFilter = THREE.LinearFilter;
            const disc = new THREE.Mesh(
              new THREE.CircleGeometry(0.22, 24),
              new THREE.MeshBasicMaterial({ map: tex, transparent: true })
            );
            disc.position.set(0, 1.28, 0.27);
            group.add(disc);
          },
          undefined,
          () => {}
        );
      }

      const label = makeLabel(String(name || "Player").slice(0, 16), {
        bg: "rgba(15,23,42,0.9)",
        scale: 0.85
      });
      label.position.set(0, 1.85, 0);
      group.add(label);

      const clue = makeLabel("", { bg: "rgba(124,58,237,0.92)", scale: 0.7 });
      clue.visible = false;
      clue.position.set(0, 2.35, 0);
      group.add(clue);

      const angle = (index / Math.max(1, total)) * Math.PI * 2 - Math.PI / 2;
      const radius = 2.55;
      group.position.set(Math.cos(angle) * radius, 0, Math.sin(angle) * radius);
      group.lookAt(0, group.position.y, 0);

      group.userData.body = body;
      group.userData.head = head;
      group.userData.label = label;
      group.userData.clue = clue;
      group.userData.name = name;
      return group;
    }

    function rebuildSeats(state, metaPlayers) {
      for (const g of seats.values()) scene.remove(g);
      seats.clear();
      const order = state.order || [];
      const n = order.length;
      order.forEach((id, i) => {
        const sid = String(id);
        const meta = (metaPlayers || []).find((p) => p && String(p.id) === sid);
        const name = (state.names && state.names[sid]) || (meta && meta.name) || sid;
        const av = meta && meta.avatarUrl ? String(meta.avatarUrl) : "";
        const g = buildSeat(sid, name, av, i, n);
        scene.add(g);
        seats.set(sid, g);
      });
    }

    function paint(state, meta) {
      lastState = state || null;
      if (!ready || !state) return;
      const metaPlayers = (meta && meta.players) || [];
      const ids = (state.order || []).map(String);
      const needRebuild =
        seats.size !== ids.length || ids.some((id) => !seats.has(id));
      if (needRebuild) rebuildSeats(state, metaPlayers);

      const alive = new Set((state.alive || []).map(String));
      const youId = meta && meta.youId != null ? String(meta.youId) : "";
      const turnId =
        state.phase === "CARD_PICK"
          ? state.pickTurnId
          : state.phase === "CLUE_TURN"
            ? state.clueTurnId
            : null;
      const voteOn = state.phase === "VOTING" && state.canVote;
      const lastClueBy = {};
      (state.clues || []).forEach((c) => {
        if (c && c.playerId != null) lastClueBy[String(c.playerId)] = c.text || "";
      });

      seats.forEach((g, sid) => {
        const out = !alive.has(sid);
        const mine = youId && sid === youId;
        const turn = turnId && sid === String(turnId);
        const canVote = voteOn && !mine && !out;
        g.userData.canVote = canVote;
        g.userData.out = out;

        const base = out ? 0x64748b : turn ? 0xf59e0b : mine ? 0x22c55e : 0x4b6cb7;
        g.userData.body.material.color.setHex(base);
        g.userData.body.material.opacity = out ? 0.45 : 1;
        g.userData.body.material.transparent = out;
        g.userData.head.material.opacity = out ? 0.45 : 1;
        g.userData.head.material.transparent = out;

        let badge = String(g.userData.name || "").slice(0, 14);
        if (mine) badge += " (คุณ)";
        if (state.phase === "FINISHED" && state.roles && state.roles[sid] === "imposter") {
          badge += " · Imp";
        } else if (out) badge += " · ตกรอบ";
        else if (turn) badge += " · ตา";
        else if (canVote) badge += " · โหวต";
        g.userData.label.userData.setText(badge, {
          bg: canVote ? "rgba(220,38,38,0.92)" : turn ? "rgba(245,158,11,0.95)" : "rgba(15,23,42,0.9)",
          fg: "#fff"
        });

        const clueText = lastClueBy[sid];
        if (clueText) {
          g.userData.clue.visible = true;
          g.userData.clue.userData.setText(String(clueText).slice(0, 18), {
            bg: "rgba(124,58,237,0.92)",
            fg: "#fff",
            scale: 0.72
          });
        } else {
          g.userData.clue.visible = false;
        }
      });
    }

    function onPointer(e) {
      if (!ready || !lastState || lastState.phase !== "VOTING" || !lastState.canVote) return;
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObjects(
        [...seats.values()].flatMap((g) => [g.userData.body, g.userData.head, g.userData.label]),
        true
      );
      if (!hits.length) return;
      let obj = hits[0].object;
      while (obj && !obj.userData.seatId) obj = obj.parent;
      if (!obj || !obj.userData.canVote) return;
      onVote(String(obj.userData.seatId));
    }

    function loop() {
      if (disposed) return;
      anim = requestAnimationFrame(loop);
      if (table) table.rotation.y += 0.0012;
      seats.forEach((g) => {
        if (g.userData.label) g.userData.label.quaternion.copy(camera.quaternion);
        if (g.userData.clue && g.userData.clue.visible) {
          g.userData.clue.quaternion.copy(camera.quaternion);
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
      mount.classList.remove("is-active");
      mount.innerHTML = "";
    }

    loadThree()
      .then((T) => {
        if (disposed) return;
        THREE = T;
        if (!THREE.CapsuleGeometry) {
          // r128 may lack CapsuleGeometry — polyfill with cylinder+spheres via simple cylinder
          THREE.CapsuleGeometry = function (radius, length) {
            return new THREE.CylinderGeometry(radius, radius, length + radius * 2, 12);
          };
        }
        const { w, h } = size();
        scene = new THREE.Scene();
        scene.background = new THREE.Color(0x0b1220);
        camera = new THREE.PerspectiveCamera(42, w / h, 0.1, 100);
        camera.position.set(0, 4.2, 6.2);
        camera.lookAt(0, 0.6, 0);

        renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
        renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
        renderer.setSize(w, h, false);
        canvasHost.appendChild(renderer.domElement);

        const hemi = new THREE.HemisphereLight(0xdbeafe, 0x1e293b, 0.95);
        scene.add(hemi);
        const dir = new THREE.DirectionalLight(0xffffff, 0.65);
        dir.position.set(3, 8, 4);
        scene.add(dir);

        table = new THREE.Mesh(
          new THREE.CylinderGeometry(1.85, 1.95, 0.28, 48),
          new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.55, metalness: 0.15 })
        );
        table.position.y = 0.14;
        scene.add(table);

        const floor = new THREE.Mesh(
          new THREE.CircleGeometry(4.2, 48),
          new THREE.MeshStandardMaterial({ color: 0x111827, roughness: 1 })
        );
        floor.rotation.x = -Math.PI / 2;
        floor.position.y = 0;
        scene.add(floor);

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
