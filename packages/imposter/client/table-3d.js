/* Imposter Classic — 3D round table scene (NUMVERSE)
 * Players sit around a table; each clue appears on a sign above the speaker's head.
 * Loads three.js (r128) lazily from cdnjs; if WebGL/CDN fails it calls opts.onFail
 * so live-ui.js can fall back to the 2D roster.
 */
(function () {
  "use strict";

  var THREE_SRC = "https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js";
  var threePromise = null;

  function loadThree() {
    if (window.THREE) return Promise.resolve(window.THREE);
    if (threePromise) return threePromise;
    threePromise = new Promise(function (resolve, reject) {
      var s = document.createElement("script");
      s.src = THREE_SRC;
      s.async = true;
      s.onload = function () {
        window.THREE ? resolve(window.THREE) : reject(new Error("three_missing"));
      };
      s.onerror = function () {
        threePromise = null;
        reject(new Error("three_load_failed"));
      };
      document.head.appendChild(s);
    });
    return threePromise;
  }

  var PALETTE = [0xff6b8b, 0x4dabf7, 0xffd43b, 0x69db7c, 0xb197fc, 0xff922b, 0x3bc9db, 0xf783ac];
  var SKINS = [0xffd8b5, 0xf1c27d, 0xe0ac69, 0xc68642, 0xffdbac, 0x8d5524];
  var SEAT_R = 3.0;
  var TABLE_R = 2.05;
  var TABLE_TOP_Y = 1.075;

  function initialOf(name) {
    var t = String(name || "?").trim();
    return t ? t.slice(0, 1).toUpperCase() : "?";
  }

  function create(host, opts) {
    opts = opts || {};
    var destroyed = false;
    var T = null;
    var S = {};
    var lastState = null;
    var lastCtx = null;

    host.classList.remove("hidden");
    host.innerHTML = '<div class="imp3d-loading">กำลังโหลดโต๊ะ 3D…</div>';

    function fail(err) {
      if (destroyed) return;
      try {
        console.warn("[imposter] 3D table unavailable:", err && err.message);
      } catch (_) {}
      teardown();
      if (typeof opts.onFail === "function") opts.onFail(err);
    }

    loadThree()
      .then(function (three) {
        if (destroyed) return;
        T = three;
        try {
          init();
          if (lastState) sync();
        } catch (e) {
          fail(e);
        }
      })
      .catch(fail);

    function init() {
      host.innerHTML = "";
      var w = Math.max(host.clientWidth, 280);
      var h = Math.max(host.clientHeight, 260);

      var renderer = new T.WebGLRenderer({ antialias: true, alpha: false });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.setSize(w, h);
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = T.PCFSoftShadowMap;
      renderer.domElement.className = "imp3d-canvas";
      host.appendChild(renderer.domElement);

      var pinsLayer = document.createElement("div");
      pinsLayer.className = "imp3d-pins";
      host.appendChild(pinsLayer);

      var scene = new T.Scene();
      scene.background = new T.Color(0x0b1020);
      scene.fog = new T.Fog(0x0b1020, 14, 30);

      var camera = new T.PerspectiveCamera(48, w / h, 0.1, 80);
      var camTarget = new T.Vector3(0, 1.3, 0.2);

      scene.add(new T.HemisphereLight(0xaab4ff, 0x221a33, 0.65));
      var spot = new T.SpotLight(0xffe6c0, 1.5, 34, 1.0, 0.55, 1);
      spot.position.set(0, 9, 0);
      spot.castShadow = true;
      spot.shadow.mapSize.set(1024, 1024);
      spot.shadow.bias = -0.0004;
      scene.add(spot);
      scene.add(spot.target);
      var fill = new T.DirectionalLight(0x8899ff, 0.35);
      fill.position.set(0, 6, 10);
      scene.add(fill);

      var floor = new T.Mesh(
        new T.CircleGeometry(14, 48),
        new T.MeshStandardMaterial({ color: 0x151a30, roughness: 0.95 })
      );
      floor.rotation.x = -Math.PI / 2;
      floor.receiveShadow = true;
      scene.add(floor);
      var rug = new T.Mesh(
        new T.CircleGeometry(4.6, 48),
        new T.MeshStandardMaterial({ color: 0x241a4a, roughness: 1 })
      );
      rug.rotation.x = -Math.PI / 2;
      rug.position.y = 0.01;
      rug.receiveShadow = true;
      scene.add(rug);

      var wood = new T.MeshStandardMaterial({ color: 0x7a4a2b, roughness: 0.6 });
      var top = new T.Mesh(new T.CylinderGeometry(TABLE_R, TABLE_R, 0.15, 48), wood);
      top.position.y = TABLE_TOP_Y - 0.075;
      top.castShadow = true;
      top.receiveShadow = true;
      scene.add(top);
      var felt = new T.Mesh(
        new T.CylinderGeometry(TABLE_R - 0.25, TABLE_R - 0.25, 0.02, 48),
        new T.MeshStandardMaterial({ color: 0x3a2c78, roughness: 0.9 })
      );
      felt.position.y = TABLE_TOP_Y + 0.005;
      felt.receiveShadow = true;
      scene.add(felt);
      var leg = new T.Mesh(new T.CylinderGeometry(0.35, 0.6, TABLE_TOP_Y - 0.15, 20), wood);
      leg.position.y = (TABLE_TOP_Y - 0.15) / 2;
      leg.castShadow = true;
      scene.add(leg);

      var cv = document.createElement("canvas");
      cv.width = cv.height = 256;
      var g = cv.getContext("2d");
      g.clearRect(0, 0, 256, 256);
      g.font = "800 190px system-ui, sans-serif";
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.shadowColor = "#a78bfa";
      g.shadowBlur = 28;
      g.fillStyle = "#e9e4ff";
      g.fillText("?", 128, 140);
      var emblem = new T.Mesh(
        new T.CircleGeometry(0.85, 32),
        new T.MeshBasicMaterial({ map: new T.CanvasTexture(cv), transparent: true, depthWrite: false })
      );
      emblem.rotation.x = -Math.PI / 2;
      emblem.position.y = TABLE_TOP_Y + 0.025;
      scene.add(emblem);

      var charGroup = new T.Group();
      scene.add(charGroup);

      S = {
        renderer: renderer,
        scene: scene,
        camera: camera,
        camTarget: camTarget,
        chars: {},
        charGroup: charGroup,
        pinsLayer: pinsLayer,
        orderKey: "",
        raycaster: new T.Raycaster(),
        pointer: new T.Vector2(),
        pointerN: { x: 0, y: 0 },
        hoverId: null,
        clock: new T.Clock(),
        tmpV: new T.Vector3(),
        raf: 0,
        w: w,
        h: h
      };

      fitCamera();

      var onMove = function (e) {
        var r = renderer.domElement.getBoundingClientRect();
        S.pointerN.x = ((e.clientX - r.left) / r.width) * 2 - 1;
        S.pointerN.y = ((e.clientY - r.top) / r.height) * 2 - 1;
        var id = pickAt(e.clientX, e.clientY);
        var vid = id && S.chars[id] && S.chars[id].voteable ? id : null;
        S.hoverId = vid;
        renderer.domElement.style.cursor = vid ? "pointer" : "default";
      };
      var onLeave = function () {
        S.hoverId = null;
        S.pointerN.x = S.pointerN.y = 0;
        renderer.domElement.style.cursor = "default";
      };
      var onClick = function (e) {
        var id = pickAt(e.clientX, e.clientY);
        if (id && S.chars[id] && S.chars[id].voteable) castVote(id);
      };
      renderer.domElement.addEventListener("pointermove", onMove);
      renderer.domElement.addEventListener("pointerleave", onLeave);
      renderer.domElement.addEventListener("click", onClick);
      S.cleanupEvents = function () {
        renderer.domElement.removeEventListener("pointermove", onMove);
        renderer.domElement.removeEventListener("pointerleave", onLeave);
        renderer.domElement.removeEventListener("click", onClick);
      };

      if (typeof ResizeObserver === "function") {
        S.ro = new ResizeObserver(resize);
        S.ro.observe(host);
      } else {
        window.addEventListener("resize", resize);
        S.cleanupResize = function () {
          window.removeEventListener("resize", resize);
        };
      }

      loop();
    }

    function castVote(id) {
      if (typeof opts.onVote === "function") opts.onVote(id);
    }

    function pickAt(clientX, clientY) {
      var r = S.renderer.domElement.getBoundingClientRect();
      S.pointer.set(((clientX - r.left) / r.width) * 2 - 1, -(((clientY - r.top) / r.height) * 2 - 1));
      S.raycaster.setFromCamera(S.pointer, S.camera);
      var hits = S.raycaster.intersectObjects(S.charGroup.children, true);
      for (var i = 0; i < hits.length; i++) {
        var o = hits[i].object;
        while (o && !(o.userData && o.userData.pid)) o = o.parent;
        if (o) return o.userData.pid;
      }
      return null;
    }

    function resize() {
      if (destroyed || !S.renderer) return;
      var w = host.clientWidth;
      var h = host.clientHeight;
      if (!w || !h) return;
      S.w = w;
      S.h = h;
      S.renderer.setSize(w, h);
      S.camera.aspect = w / h;
      S.camera.updateProjectionMatrix();
      fitCamera();
    }

    // Keep the whole ring in frame on narrow (portrait) screens.
    function fitCamera() {
      var aspect = S.w / S.h;
      var scale = aspect < 0.95 ? Math.min(2.3, 0.95 / aspect) : 1;
      var dir = new T.Vector3(0, 5.6, 7.4);
      S.baseCam = S.camTarget.clone().add(dir.multiplyScalar(scale));
      S.camera.position.copy(S.baseCam);
      S.camera.lookAt(S.camTarget);
    }

    function limb(a, b, r, mat) {
      var dir = new T.Vector3().subVectors(b, a);
      var len = dir.length();
      var m = new T.Mesh(new T.CylinderGeometry(r, r, len, 10), mat);
      m.position.copy(a).addScaledVector(dir, 0.5);
      m.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), dir.normalize());
      m.castShadow = true;
      return m;
    }

    function buildCharacter(id, idx) {
      var color = PALETTE[idx % PALETTE.length];
      var skin = SKINS[idx % SKINS.length];
      var group = new T.Group();

      var bodyMat = new T.MeshStandardMaterial({ color: color, roughness: 0.7 });
      var skinMat = new T.MeshStandardMaterial({ color: skin, roughness: 0.8 });
      var darkMat = new T.MeshStandardMaterial({ color: 0x2b2250, roughness: 0.8 });
      var chairMat = new T.MeshStandardMaterial({ color: 0x4a3426, roughness: 0.8 });

      // chair behind the player (local +z faces the table centre)
      var seat = new T.Mesh(new T.BoxGeometry(1.0, 0.1, 1.0), chairMat);
      seat.position.set(0, 0.5, -0.05);
      var back = new T.Mesh(new T.BoxGeometry(1.0, 1.0, 0.1), chairMat);
      back.position.set(0, 1.0, -0.55);
      [[-0.42, -0.45], [0.42, -0.45], [-0.42, 0.35], [0.42, 0.35]].forEach(function (p) {
        var l = new T.Mesh(new T.CylinderGeometry(0.05, 0.05, 0.5, 8), chairMat);
        l.position.set(p[0], 0.25, p[1]);
        l.castShadow = true;
        group.add(l);
      });
      seat.castShadow = back.castShadow = true;
      seat.receiveShadow = true;
      group.add(seat, back);

      var torso = new T.Mesh(new T.CylinderGeometry(0.36, 0.44, 0.85, 18), bodyMat);
      torso.position.y = 1.0;
      torso.castShadow = true;
      group.add(torso);

      [-1, 1].forEach(function (s) {
        var shoulder = new T.Vector3(0.44 * s, 1.3, 0.05);
        var hand = new T.Vector3(0.3 * s, TABLE_TOP_Y + 0.1, 1.0);
        group.add(limb(shoulder, hand, 0.09, bodyMat));
        var hm = new T.Mesh(new T.SphereGeometry(0.11, 12, 10), skinMat);
        hm.position.copy(hand);
        hm.castShadow = true;
        group.add(hm);
      });

      var head = new T.Group();
      head.position.y = 1.8;
      var skull = new T.Mesh(new T.SphereGeometry(0.4, 22, 18), skinMat);
      skull.scale.y = 0.95;
      skull.castShadow = true;
      head.add(skull);
      var eyeW = new T.MeshStandardMaterial({ color: 0xffffff });
      var eyeB = new T.MeshStandardMaterial({ color: 0x111111 });
      [-1, 1].forEach(function (s) {
        var e = new T.Mesh(new T.SphereGeometry(0.085, 10, 8), eyeW);
        e.position.set(0.15 * s, 0.05, 0.34);
        var p = new T.Mesh(new T.SphereGeometry(0.045, 8, 6), eyeB);
        p.position.set(0.15 * s, 0.05, 0.415);
        head.add(e, p);
      });
      var mouth = new T.Mesh(
        new T.BoxGeometry(0.15, 0.035, 0.03),
        new T.MeshStandardMaterial({ color: 0x7a2d3a })
      );
      mouth.position.set(0, -0.14, 0.385);
      head.add(mouth);

      var acc = idx % 4;
      var hatMat = new T.MeshStandardMaterial({ color: acc === 1 ? 0xffffff : color, roughness: 0.6 });
      if (acc === 0) {
        var hair = new T.Mesh(new T.SphereGeometry(0.43, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), darkMat);
        hair.position.y = 0.04;
        hair.rotation.x = -0.25;
        head.add(hair);
      } else if (acc === 1) {
        var cone = new T.Mesh(new T.ConeGeometry(0.22, 0.45, 14), hatMat);
        cone.position.set(0, 0.5, 0);
        cone.rotation.z = 0.15;
        head.add(cone);
      } else if (acc === 2) {
        var beanie = new T.Mesh(
          new T.SphereGeometry(0.42, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2.4),
          hatMat
        );
        beanie.position.y = 0.06;
        var bob = new T.Mesh(new T.SphereGeometry(0.09, 10, 8), eyeW);
        bob.position.y = 0.47;
        head.add(beanie, bob);
      } else {
        [-1, 1].forEach(function (s) {
          var ear = new T.Mesh(new T.SphereGeometry(0.09, 10, 8), skinMat);
          ear.position.set(0.4 * s, 0, 0);
          head.add(ear);
        });
        var tuft = new T.Mesh(new T.SphereGeometry(0.12, 10, 8), darkMat);
        tuft.position.set(0, 0.4, 0);
        head.add(tuft);
      }
      group.add(head);

      var ringMat = new T.MeshBasicMaterial({
        color: 0x78aaff,
        transparent: true,
        opacity: 0,
        side: T.DoubleSide
      });
      var ring = new T.Mesh(new T.RingGeometry(0.85, 1.05, 40), ringMat);
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(0, 0.03, 0.1);
      group.add(ring);

      var card = new T.Mesh(
        new T.BoxGeometry(0.42, 0.02, 0.6),
        new T.MeshStandardMaterial({ color: 0xe9e4ff, roughness: 0.5 })
      );
      card.position.set(0, TABLE_TOP_Y + 0.03, 1.5);
      card.visible = false;
      group.add(card);

      // tag every pickable mesh (not the status ring) with the player id
      group.traverse(function (o) {
        if (o.isMesh && o !== ring) o.userData.pid = id;
      });
      group.userData.pid = id;

      // HTML pin: clue sign above, name chip beneath
      var pin = document.createElement("div");
      pin.className = "imp3d-pin";
      var sign = document.createElement("div");
      sign.className = "imp3d-sign hidden";
      var chip = document.createElement("div");
      chip.className = "imp3d-chip";
      var av = document.createElement("span");
      av.className = "imp3d-av";
      var nm = document.createElement("span");
      nm.className = "imp3d-name";
      var bd = document.createElement("em");
      bd.className = "imp3d-badge hidden";
      chip.appendChild(av);
      chip.appendChild(nm);
      chip.appendChild(bd);
      chip.addEventListener("click", function () {
        if (S.chars[id] && S.chars[id].voteable) castVote(id);
      });
      pin.appendChild(sign);
      pin.appendChild(chip);
      S.pinsLayer.appendChild(pin);

      return {
        id: id,
        idx: idx,
        group: group,
        head: head,
        torso: torso,
        mouth: mouth,
        bodyMat: bodyMat,
        baseColor: color,
        ringMat: ringMat,
        card: card,
        pin: pin,
        sign: sign,
        chip: chip,
        av: av,
        nm: nm,
        bd: bd,
        phase: idx * 1.7,
        talkUntil: 0,
        seenClues: -1,
        signSig: "",
        chipSig: "",
        out: false,
        mine: false,
        turn: false,
        voteable: false,
        picked: false,
        guessing: false,
        imp: false,
        showImp: false,
        scale: 1,
        slump: 0
      };
    }

    function disposeChars() {
      Object.keys(S.chars).forEach(function (id) {
        var c = S.chars[id];
        S.charGroup.remove(c.group);
        c.group.traverse(function (o) {
          if (o.geometry) o.geometry.dispose();
          if (o.material) {
            (Array.isArray(o.material) ? o.material : [o.material]).forEach(function (m) {
              m.dispose();
            });
          }
        });
        if (c.pin.parentNode) c.pin.parentNode.removeChild(c.pin);
        delete S.chars[id];
      });
    }

    // You always sit nearest the camera; the others follow around the table.
    function layout(order, youId) {
      var n = order.length;
      var youIdx = Math.max(0, order.indexOf(youId));
      order.forEach(function (id, i) {
        var c = S.chars[id];
        var a = (2 * Math.PI * ((i - youIdx + n) % n)) / n;
        c.group.position.set(Math.sin(a) * SEAT_R, 0, Math.cos(a) * SEAT_R);
        c.group.lookAt(0, 0, 0);
      });
    }

    function sync() {
      if (!S.renderer || !lastState) return;
      var state = lastState;
      var ctx = lastCtx || {};
      var order = (state.order || []).map(String);
      var youId = String(ctx.youId || "");
      var key = order.join(",") + "|" + youId;
      if (key !== S.orderKey) {
        disposeChars();
        order.forEach(function (id, i) {
          var c = buildCharacter(id, i);
          S.chars[id] = c;
          S.charGroup.add(c.group);
        });
        layout(order, youId);
        S.orderKey = key;
      }

      var aliveSet = {};
      (state.alive || []).forEach(function (id) {
        aliveSet[String(id)] = true;
      });
      var phase = state.phase;
      var turnId =
        phase === "CARD_PICK" ? state.pickTurnId : phase === "CLUE_TURN" ? state.clueTurnId : null;
      turnId = turnId != null ? String(turnId) : null;
      var voteOn = phase === "VOTING" && !!state.canVote;
      var tally = {};
      if (state.voteTallies && state.voteTallies.entries) {
        state.voteTallies.entries.forEach(function (e) {
          tally[String(e.playerId)] = e.count;
        });
      }
      var cluesBy = {};
      (state.clues || []).forEach(function (cl) {
        var pid = String(cl.playerId);
        (cluesBy[pid] = cluesBy[pid] || []).push(cl);
      });
      var takenBy = {};
      (state.cards || []).forEach(function (cd) {
        if (cd.takenBy) takenBy[String(cd.takenBy)] = true;
      });
      var now = performance.now();

      order.forEach(function (id) {
        var c = S.chars[id];
        if (!c) return;
        var names = state.names || {};
        var meta = typeof ctx.meta === "function" ? ctx.meta(id) : null;
        var name = names[id] || (meta && meta.name) || id;
        var role = state.roles ? state.roles[id] : null;

        c.out = !aliveSet[id];
        c.mine = !!youId && id === youId;
        c.turn = !!turnId && id === turnId;
        c.voteable = voteOn && !c.mine && !c.out;
        c.picked = ctx.pickedVote != null && String(ctx.pickedVote) === id && phase === "VOTING";
        c.guessing =
          phase === "GUESS" && state.guessPlayerId != null && String(state.guessPlayerId) === id;
        c.imp = role === "imposter";
        c.showImp = phase === "FINISHED" && !!role;

        c.card.visible = (phase === "CARD_PICK" || phase === "ROLE_REVEAL") && !!takenBy[id];

        // clue sign above the head
        var list = cluesBy[id] || [];
        if (c.seenClues < 0) c.seenClues = list.length;
        var isNew = list.length > c.seenClues;
        if (isNew) {
          c.talkUntil = now + 1800;
          c.seenClues = list.length;
        }
        var last = list[list.length - 1];
        var typing =
          phase === "CLUE_TURN" &&
          c.turn &&
          (!last || (last.pass || 1) !== (state.cluePass || 1));
        var shown = list.slice(-3);
        var sig = JSON.stringify([
          shown.map(function (x) {
            return [x.text, x.pass];
          }),
          typing
        ]);
        if (sig !== c.signSig) {
          c.signSig = sig;
          c.sign.innerHTML = "";
          if (!shown.length && !typing) {
            c.sign.classList.add("hidden");
          } else {
            c.sign.classList.remove("hidden");
            shown.forEach(function (x, i) {
              var line = document.createElement("div");
              line.className =
                i === shown.length - 1 && !typing ? "imp3d-clue is-last" : "imp3d-clue is-old";
              line.textContent = x.text;
              c.sign.appendChild(line);
            });
            if (typing) {
              var dots = document.createElement("div");
              dots.className = "imp3d-clue is-typing";
              dots.innerHTML = "<i></i><i></i><i></i>";
              c.sign.appendChild(dots);
            }
            c.sign.classList.remove("is-new");
            void c.sign.offsetWidth;
            c.sign.classList.add("is-new");
          }
        }

        // name chip + badge
        var badge = "";
        var badgeCls = "";
        if (c.showImp) {
          badge = c.imp ? "Imposter" : "ปกติ";
          badgeCls = c.imp ? "is-imp" : "";
        } else if (phase === "VOTE_RESULT" && tally[id] != null) {
          badge = tally[id] + " โหวต";
          badgeCls = "is-vote";
        } else if (c.picked) {
          badge = "โหวตแล้ว";
          badgeCls = "is-picked";
        } else if (c.out) {
          badge = "ตกรอบ";
        } else if (c.guessing) {
          badge = "กำลังทายคำ";
          badgeCls = "is-imp";
        } else if (c.voteable) {
          badge = "กดเพื่อโหวต";
          badgeCls = "is-vote";
        } else if (c.turn) {
          badge = phase === "CARD_PICK" ? "จั่วการ์ด" : "ตานี้";
          badgeCls = "is-turn";
        } else if (phase === "CARD_PICK" && takenBy[id]) {
          badge = "จั่วแล้ว";
        }
        var avUrl = meta && meta.avatarUrl ? String(meta.avatarUrl) : "";
        var chipSig = [name, c.mine, c.out, c.voteable, c.picked, c.turn, c.showImp && c.imp, badge, avUrl].join("|");
        if (chipSig !== c.chipSig) {
          c.chipSig = chipSig;
          c.nm.textContent = name + (c.mine ? " (คุณ)" : "");
          c.av.innerHTML = "";
          if (avUrl) {
            var img = document.createElement("img");
            img.src = avUrl;
            img.alt = "";
            img.loading = "lazy";
            c.av.appendChild(img);
          } else {
            c.av.textContent = initialOf(name);
          }
          c.bd.textContent = badge;
          c.bd.className = "imp3d-badge " + badgeCls + (badge ? "" : " hidden");
          c.chip.classList.toggle("is-you", c.mine);
          c.chip.classList.toggle("is-out", c.out);
          c.chip.classList.toggle("is-turn", c.turn);
          c.chip.classList.toggle("is-voteable", c.voteable);
          c.chip.classList.toggle("is-picked", c.picked);
          c.chip.classList.toggle("is-imp", c.showImp && c.imp);
        }

        if (c.out) {
          c.bodyMat.color.setHex(0x6b7280);
          c.bodyMat.emissive.setHex(0x000000);
        } else {
          c.bodyMat.color.setHex(c.baseColor);
          c.bodyMat.emissive.setHex(c.showImp && c.imp ? 0x7a1030 : 0x000000);
        }
      });
    }

    function loop() {
      if (destroyed) return;
      S.raf = requestAnimationFrame(loop);
      if (document.hidden || !host.clientWidth || !host.clientHeight) return;
      var t = S.clock.getElapsedTime();
      var now = performance.now();

      Object.keys(S.chars).forEach(function (id) {
        var c = S.chars[id];
        var talking = now < c.talkUntil;
        var hover = S.hoverId === id;

        c.torso.scale.y = 1 + 0.015 * Math.sin(t * 1.6 + c.phase);
        var headY = 1.8 + 0.012 * Math.sin(t * 1.6 + c.phase);
        var rotZ = 0;
        var mouthS = 0.6;
        if (talking) {
          headY += 0.05 * Math.abs(Math.sin(t * 9 + c.phase));
          rotZ = 0.09 * Math.sin(t * 6 + c.phase);
          mouthS = 0.5 + Math.abs(Math.sin(t * 14)) * 2;
        } else if (c.turn) {
          headY += 0.03 * Math.abs(Math.sin(t * 4 + c.phase));
          rotZ = 0.05 * Math.sin(t * 2.4 + c.phase);
        }
        c.slump += ((c.out ? 0.65 : 0) - c.slump) * 0.1;
        c.head.position.y = headY - c.slump * 0.12;
        c.head.rotation.x = c.slump;
        c.head.rotation.z = rotZ;
        c.mouth.scale.y = mouthS;
        c.group.position.y = -c.slump * 0.1;

        var tgt = hover ? 1.07 : c.picked ? 1.04 : 1;
        c.scale += (tgt - c.scale) * 0.18;
        c.group.scale.setScalar(c.scale);

        var ringOn = 0;
        var hex = 0x78aaff;
        if (c.guessing) {
          hex = 0xff6b8b;
          ringOn = 0.55 + 0.35 * Math.sin(t * 6);
        } else if (c.picked) {
          hex = 0xfacc15;
          ringOn = 0.9;
        } else if (hover) {
          hex = 0xfde68a;
          ringOn = 0.8;
        } else if (c.turn) {
          hex = 0x5ee0a0;
          ringOn = 0.55 + 0.35 * Math.sin(t * 5);
        } else if (c.showImp && c.imp) {
          hex = 0xff4d7a;
          ringOn = 0.85;
        } else if (c.mine) {
          ringOn = 0.28;
        }
        c.ringMat.color.setHex(hex);
        c.ringMat.opacity = ringOn;
      });

      var cam = S.camera;
      cam.position.x = S.baseCam.x + S.pointerN.x * 0.7 + Math.sin(t * 0.25) * 0.15;
      cam.position.y = S.baseCam.y - S.pointerN.y * 0.25;
      cam.position.z = S.baseCam.z;
      cam.lookAt(S.camTarget);

      S.renderer.render(S.scene, cam);
      projectPins();
    }

    function projectPins() {
      var w = S.w;
      var h = S.h;
      var v = S.tmpV;
      Object.keys(S.chars).forEach(function (id) {
        var c = S.chars[id];
        v.set(0, 2.3 + (c.head.position.y - 1.8), 0);
        c.group.localToWorld(v);
        v.project(S.camera);
        var x = (v.x * 0.5 + 0.5) * w;
        var y = (-v.y * 0.5 + 0.5) * h;
        x = Math.max(56, Math.min(w - 56, x));
        c.pin.style.transform =
          "translate3d(" + x.toFixed(1) + "px," + y.toFixed(1) + "px,0) translate(-50%,-100%)";
        c.pin.style.zIndex = String(Math.round((1 - v.z) * 1000));
      });
    }

    function teardown() {
      destroyed = true;
      if (S.raf) cancelAnimationFrame(S.raf);
      if (S.ro) S.ro.disconnect();
      if (S.cleanupResize) S.cleanupResize();
      if (S.cleanupEvents) S.cleanupEvents();
      try {
        if (S.chars) disposeChars();
        if (S.scene) {
          S.scene.traverse(function (o) {
            if (o.geometry) o.geometry.dispose();
            if (o.material) {
              (Array.isArray(o.material) ? o.material : [o.material]).forEach(function (m) {
                if (m.map) m.map.dispose();
                m.dispose();
              });
            }
          });
        }
        if (S.renderer) {
          S.renderer.dispose();
          if (S.renderer.forceContextLoss) S.renderer.forceContextLoss();
        }
      } catch (_) {}
      host.innerHTML = "";
      S = {};
    }

    return {
      update: function (state, ctx) {
        lastState = state;
        lastCtx = ctx;
        if (S.renderer) sync();
      },
      destroy: function () {
        teardown();
      }
    };
  }

  window.NVImposterTable3D = { create: create };
})();
