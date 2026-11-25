/* Werewolf — 3D village scene (NUMVERSE)
 * Houses in a circle; night/day lighting; wolf attack anim; tap house to pick.
 * Loads three.js (r128) lazily from cdnjs; onFail lets live-ui fall back to 2D roster.
 * Ported from Downloads/werewolf-village-3d.html Village3D block.
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

  var WALL = ["#e7c9a0", "#cfa57a", "#b9c7d6", "#d9b8c4", "#c9d6a8", "#e0b98f", "#b8a9d9", "#d7c27a"];
  var ROOF = ["#8b3a3a", "#3f5d8a", "#6b4a8a", "#3d7a5a"];

  function create(host, opts) {
    opts = opts || {};
    var destroyed = false;
    var T = null;
    var api = null;
    var pending = null;
    var onPickFn = typeof opts.onPick === "function" ? opts.onPick : null;

    host.classList.remove("hidden");
    host.innerHTML = '<div class="ww3d-loading">กำลังโหลดหมู่บ้าน 3D…</div>';

    function fail(err) {
      if (destroyed) return;
      try {
        console.warn("[werewolf] 3D village unavailable:", err && err.message);
      } catch (_) {}
      teardown();
      if (typeof opts.onFail === "function") opts.onFail(err);
    }

    function teardown() {
      destroyed = true;
      if (api && api._teardown) api._teardown();
      api = null;
      host.innerHTML = "";
      host.classList.add("hidden");
    }

    loadThree()
      .then(function (three) {
        if (destroyed) return;
        T = three;
        try {
          api = initScene(host, T, {
            onPick: function (id) {
              if (onPickFn) onPickFn(id);
            }
          });
          if (pending) {
            api.update(pending.pub, pending.ctx);
            pending = null;
          }
        } catch (e) {
          fail(e);
        }
      })
      .catch(fail);

    return {
      update: function (pub, ctx) {
        if (destroyed) return;
        if (!api) {
          pending = { pub: pub, ctx: ctx || {} };
          return;
        }
        api.update(pub, ctx || {});
      },
      busy: function () {
        return api ? api.busy() : false;
      },
      destroy: function () {
        teardown();
      },
      onPick: function (fn) {
        onPickFn = fn;
      }
    };
  }

  function initScene(host, THREE, hooks) {
    var running = true;
    var NIGHT_BG = new THREE.Color("#0d1030");
    var DAY_BG = new THREE.Color("#8fb8ff");

    host.innerHTML = "";
    var renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = true;
    renderer.domElement.className = "ww3d-canvas";
    host.appendChild(renderer.domElement);

    var scene = new THREE.Scene();
    scene.fog = new THREE.Fog(NIGHT_BG, 18, 46);
    var camera = new THREE.PerspectiveCamera(48, 1, 0.1, 120);
    var hemi = new THREE.HemisphereLight(0xaab8ff, 0x1a1030, 0.5);
    var sun = new THREE.DirectionalLight(0xffffff, 0.8);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    Object.assign(sun.shadow.camera, { left: -14, right: 14, top: 14, bottom: -14 });
    scene.add(hemi, sun);

    function mat(c, o) {
      return new THREE.MeshStandardMaterial(Object.assign({ color: c, roughness: 0.85, flatShading: true }, o || {}));
    }

    var ground = new THREE.Mesh(new THREE.CylinderGeometry(15, 15.6, 0.8, 32), mat("#2f5d4a"));
    ground.position.y = -0.4;
    ground.receiveShadow = true;
    scene.add(ground);

    var orb = new THREE.Mesh(
      new THREE.SphereGeometry(1, 20, 16),
      new THREE.MeshBasicMaterial({ color: 0xffd98a, fog: false })
    );
    scene.add(orb);

    var starGeo = new THREE.BufferGeometry();
    var sp = [];
    for (var i = 0; i < 260; i++) {
      var a = Math.random() * Math.PI * 2;
      var e = Math.random() * 1.2 + 0.1;
      var r = 60;
      sp.push(Math.cos(a) * Math.cos(e) * r, Math.sin(e) * r, Math.sin(a) * Math.cos(e) * r);
    }
    starGeo.setAttribute("position", new THREE.Float32BufferAttribute(sp, 3));
    var stars = new THREE.Points(
      starGeo,
      new THREE.PointsMaterial({ color: 0xffffff, size: 0.5, transparent: true, fog: false })
    );
    scene.add(stars);

    var fire = new THREE.Group();
    var flame = new THREE.Mesh(new THREE.ConeGeometry(0.4, 1, 6), new THREE.MeshBasicMaterial({ color: 0xff9a3c }));
    flame.position.y = 0.6;
    var logs = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.7, 0.18, 8), mat("#4a3426"));
    var fireLight = new THREE.PointLight(0xff9a3c, 1.2, 9);
    fireLight.position.y = 1;
    fire.add(flame, logs, fireLight);
    scene.add(fire);

    var trees = new THREE.Group();
    for (var ti = 0; ti < 26; ti++) {
      var ta = Math.random() * Math.PI * 2;
      var tr = 11 + Math.random() * 3.2;
      var ts = 0.7 + Math.random() * 0.7;
      var tg = new THREE.Group();
      var trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.18, 0.7, 5), mat("#5b3f2c"));
      trunk.position.y = 0.35;
      var top = new THREE.Mesh(new THREE.ConeGeometry(0.7, 1.8, 6), mat("#1f5a3f"));
      top.position.y = 1.5;
      top.castShadow = true;
      tg.add(trunk, top);
      tg.position.set(Math.cos(ta) * tr, 0, Math.sin(ta) * tr);
      tg.scale.setScalar(ts);
      trees.add(tg);
    }
    scene.add(trees);

    function labelSprite(text) {
      var c = document.createElement("canvas");
      c.width = 256;
      c.height = 72;
      var g = c.getContext("2d");
      g.fillStyle = "rgba(14,16,48,.8)";
      g.beginPath();
      if (g.roundRect) g.roundRect(4, 6, 248, 60, 30);
      else g.rect(4, 6, 248, 60);
      g.fill();
      g.fillStyle = "#eef0ff";
      g.font = "600 30px Kanit, Noto Sans Thai, sans-serif";
      g.textAlign = "center";
      g.textBaseline = "middle";
      var label = String(text || "").slice(0, 12);
      g.fillText(label, 128, 38);
      var s = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false, transparent: true })
      );
      s.scale.set(2.2, 0.62, 1);
      s.renderOrder = 5;
      return s;
    }

    function buildHouse(idx) {
      var g = new THREE.Group();
      var body = new THREE.Mesh(new THREE.BoxGeometry(1.7, 1.2, 1.5), mat(WALL[idx % WALL.length]));
      body.position.y = 0.6;
      var roof = new THREE.Mesh(new THREE.ConeGeometry(1.5, 1, 4), mat(ROOF[idx % ROOF.length]));
      roof.rotation.y = Math.PI / 4;
      roof.position.y = 1.7;
      var door = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.7, 0.06), mat("#4a3426"));
      door.position.set(0, 0.35, 0.78);
      var win = new THREE.MeshStandardMaterial({
        color: 0x2a2a3a,
        emissive: 0xffc860,
        emissiveIntensity: 0,
        roughness: 0.4
      });
      var w1 = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.36, 0.06), win);
      w1.position.set(-0.52, 0.72, 0.78);
      var w2 = w1.clone();
      w2.position.x = 0.52;
      var chim = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.7, 0.25), mat("#6b5648"));
      chim.position.set(0.5, 1.95, -0.3);
      [body, roof, chim].forEach(function (m) {
        m.castShadow = true;
        m.receiveShadow = true;
      });
      g.add(body, roof, door, w1, w2, chim);
      g.userData = { win: win, roof: roof, body: body, wall: WALL[idx % WALL.length], roofCol: ROOF[idx % ROOF.length] };
      return g;
    }

    var marker = new THREE.Mesh(new THREE.ConeGeometry(0.25, 0.55, 4), new THREE.MeshBasicMaterial({ color: 0xff5252 }));
    marker.rotation.x = Math.PI;
    marker.visible = false;
    scene.add(marker);

    var village = new THREE.Group();
    scene.add(village);
    var houses = new Map();
    var atk = null;
    var wolfMat = mat("#3a3d4a");
    var furMat = mat("#d8d8e4");

    function buildWolf() {
      var w = new THREE.Group();
      w.rotation.order = "YXZ";
      function add(geo, m, x, y, z) {
        var o = new THREE.Mesh(geo, m);
        o.position.set(x, y, z);
        o.castShadow = true;
        w.add(o);
        return o;
      }
      add(new THREE.BoxGeometry(0.55, 0.5, 1.1), wolfMat, 0, 0.75, 0);
      add(new THREE.BoxGeometry(0.4, 0.3, 0.3), furMat, 0, 0.62, 0.42);
      var head = new THREE.Group();
      head.position.set(0, 0.95, 0.7);
      w.add(head);
      function hm(geo, m, x, y, z) {
        var o = new THREE.Mesh(geo, m);
        o.position.set(x, y, z);
        head.add(o);
      }
      hm(new THREE.BoxGeometry(0.42, 0.38, 0.4), wolfMat, 0, 0, 0);
      hm(new THREE.BoxGeometry(0.24, 0.2, 0.32), furMat, 0, -0.07, 0.34);
      [-0.14, 0.14].forEach(function (x) {
        hm(new THREE.ConeGeometry(0.09, 0.22, 4), wolfMat, x, 0.27, -0.05);
        hm(new THREE.BoxGeometry(0.07, 0.07, 0.04), new THREE.MeshBasicMaterial({ color: 0xff2222 }), x, 0.04, 0.21);
      });
      add(new THREE.ConeGeometry(0.12, 0.6, 5), wolfMat, 0, 0.85, -0.75).rotation.x = -1.2;
      w.userData.legs = [
        [-0.2, 0.4],
        [0.2, 0.4],
        [-0.2, -0.4],
        [0.2, -0.4]
      ].map(function (p) {
        return add(new THREE.BoxGeometry(0.14, 0.5, 0.14), wolfMat, p[0], 0.25, p[1]);
      });
      w.userData.head = head;
      w.scale.setScalar(1.25);
      return w;
    }

    function endAttack() {
      if (!atk) return;
      scene.remove(atk.wolf, atk.flash);
      atk.claws.forEach(function (c) {
        scene.remove(c);
      });
      atk.h.position.x = atk.bx;
      atk.h.position.z = atk.bz;
      atk = null;
    }

    function stepAttack(t) {
      if (!atk) return;
      var a = atk;
      var s = (t - a.t0) / 1000;
      var w = a.wolf;
      if (houses.get(a.id) !== a.h) {
        endAttack();
        return;
      }
      function smooth(k) {
        return k * k * (3 - 2 * k);
      }
      var legs = w.userData.legs;
      if (s < 1.5) {
        w.position.lerpVectors(a.from, a.door, smooth(s / 1.5));
        w.position.y = Math.abs(Math.sin(s * 14)) * 0.12;
        w.rotation.y = Math.atan2(a.dir.x, a.dir.z);
        legs.forEach(function (l, i) {
          l.rotation.x = Math.sin(s * 22 + (i % 2) * Math.PI) * 0.7;
        });
      } else if (s < 2.4) {
        var k = (s - 1.5) / 0.9;
        w.position.copy(a.door);
        w.position.y = Math.sin(Math.min(k * 2.2, 1) * Math.PI) * 0.55;
        w.rotation.x = -0.5 * Math.sin(Math.min(k * 1.6, 1) * Math.PI);
        w.userData.head.rotation.x = Math.sin(s * 30) * 0.25;
        a.claws.forEach(function (c, i) {
          c.material.opacity = Math.min(1, Math.max(0, k * 3 - i * 0.4));
        });
        a.flash.intensity = 5 * Math.pow(Math.sin(Math.min(k, 1) * Math.PI * 2.5), 2);
        a.h.position.x = a.bx + Math.sin(s * 70) * 0.07 * (1 - k * 0.5);
        a.h.position.z = a.bz + Math.cos(s * 63) * 0.07 * (1 - k * 0.5);
        if (!a.fired && s > 1.95) {
          a.fired = true;
          if (a.done) a.done();
        }
      } else if (s < 3.5) {
        var k2 = (s - 2.4) / 1.1;
        a.h.position.x = a.bx;
        a.h.position.z = a.bz;
        w.rotation.x = 0;
        w.position.lerpVectors(a.door, a.from, smooth(k2));
        w.position.y = Math.abs(Math.sin(s * 14)) * 0.12;
        w.rotation.y = Math.atan2(-a.dir.x, -a.dir.z);
        w.scale.setScalar(1.25 * (1 - Math.max(0, k2 - 0.7) / 0.3));
        legs.forEach(function (l, i) {
          l.rotation.x = Math.sin(s * 22 + (i % 2) * Math.PI) * 0.7;
        });
        a.flash.intensity = 0;
        a.claws.forEach(function (c) {
          c.material.opacity = Math.max(0, 1 - k2 * 1.4);
        });
      } else {
        endAttack();
      }
    }

    var order = [];
    var names = {};
    var alive = new Set();
    var voted = new Set();
    var pickedId = null;
    var phase = "NIGHT";
    var animRound = 0;
    var theta = 0.6;
    var phi = 0.95;
    var radius = 22;
    var auto = true;
    var dragging = false;
    var moved = 0;
    var lx = 0;
    var ly = 0;
    var night = 1;
    var tmpC = new THREE.Color();
    var raf = 0;
    var ro = null;

    function setPlayers(ids, nm) {
      while (village.children.length) village.remove(village.children[0]);
      houses.clear();
      endAttack();
      order = (ids || []).slice();
      names = nm || {};
      var n = ids.length;
      var R = 4.6 + n * 0.28;
      ids.forEach(function (id, i) {
        var ang = (i / n) * Math.PI * 2 - Math.PI / 2;
        var h = buildHouse(i);
        h.position.set(Math.cos(ang) * R, 0, Math.sin(ang) * R);
        h.rotation.y = Math.atan2(-Math.cos(ang), -Math.sin(ang));
        var lab = labelSprite(names[id] || id);
        lab.position.set(0, 3.1, 0);
        h.add(lab);
        h.userData.id = id;
        h.userData.dead = false;
        h.traverse(function (o) {
          o.userData.houseId = id;
        });
        village.add(h);
        houses.set(id, h);
      });
      alive = new Set(ids);
      voted = new Set();
      pickedId = null;
      radius = 15 + n * 0.9;
      animRound = 0;
    }

    function setAlive(list) {
      alive = new Set(list || []);
      houses.forEach(function (h, id) {
        h.userData.dead = !alive.has(id);
      });
    }

    function attack(id, done) {
      var h = houses.get(id);
      endAttack();
      if (!h) {
        if (done) done();
        return;
      }
      var dir = new THREE.Vector3(h.position.x, 0, h.position.z).normalize();
      var perp = new THREE.Vector3(-dir.z, 0, dir.x);
      var door = h.position.clone().addScaledVector(dir, -1.7);
      door.y = 0;
      var from = h.position.clone().multiplyScalar(0.12);
      from.y = 0;
      var wolf = buildWolf();
      wolf.position.copy(from);
      scene.add(wolf);
      var flash = new THREE.PointLight(0xff3030, 0, 7);
      flash.position.set(h.position.x, 1.5, h.position.z);
      scene.add(flash);
      var claws = [-1, 0, 1].map(function (ci) {
        var c = new THREE.Mesh(
          new THREE.BoxGeometry(0.07, 1, 0.02),
          new THREE.MeshBasicMaterial({ color: 0xff3b3b, transparent: true, opacity: 0 })
        );
        c.position.copy(h.position).addScaledVector(dir, -0.85).addScaledVector(perp, ci * 0.24);
        c.position.y = 0.85;
        c.rotation.order = "YXZ";
        c.rotation.y = Math.atan2(-dir.x, -dir.z);
        c.rotation.z = -0.6;
        scene.add(c);
        return c;
      });
      atk = {
        id: id,
        h: h,
        wolf: wolf,
        flash: flash,
        claws: claws,
        dir: dir,
        door: door,
        from: from,
        done: done,
        fired: false,
        t0: performance.now(),
        bx: h.position.x,
        bz: h.position.z
      };
    }

    function resize() {
      var w = Math.max(host.clientWidth, 280);
      var h = Math.max(host.clientHeight, 240);
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }

    var cv = renderer.domElement;
    cv.addEventListener("pointerdown", function (e) {
      dragging = true;
      moved = 0;
      lx = e.clientX;
      ly = e.clientY;
      cv.setPointerCapture(e.pointerId);
    });
    cv.addEventListener("pointermove", function (e) {
      if (!dragging) return;
      var dx = e.clientX - lx;
      var dy = e.clientY - ly;
      moved += Math.abs(dx) + Math.abs(dy);
      theta -= dx * 0.006;
      phi = Math.min(1.35, Math.max(0.35, phi - dy * 0.005));
      lx = e.clientX;
      ly = e.clientY;
      auto = false;
    });
    cv.addEventListener("pointerup", function (e) {
      dragging = false;
      if (moved < 6) pick(e);
    });
    cv.addEventListener(
      "wheel",
      function (e) {
        e.preventDefault();
        radius = Math.min(40, Math.max(10, radius + e.deltaY * 0.01));
      },
      { passive: false }
    );

    var ray = new THREE.Raycaster();
    var ptr = new THREE.Vector2();
    function pick(e) {
      var rect = cv.getBoundingClientRect();
      ptr.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
      ray.setFromCamera(ptr, camera);
      var hit = ray.intersectObjects(village.children, true).find(function (x) {
        return x.object.userData.houseId;
      });
      if (hit && hooks.onPick) hooks.onPick(hit.object.userData.houseId);
    }

    function frame(t) {
      if (!running) return;
      raf = requestAnimationFrame(frame);
      var goal = phase === "NIGHT" || phase === "ROLE_REVEAL" || atk ? 1 : 0;
      night += (goal - night) * 0.05;
      if (auto) theta += 0.0016;
      camera.position.set(
        Math.sin(theta) * Math.sin(phi) * radius,
        Math.cos(phi) * radius,
        Math.cos(theta) * Math.sin(phi) * radius
      );
      camera.lookAt(0, 0.6, 0);

      tmpC.copy(DAY_BG).lerp(NIGHT_BG, night);
      scene.background = tmpC;
      scene.fog.color.copy(tmpC);
      hemi.intensity = 0.45 + (1 - night) * 0.6;
      sun.intensity = 0.55 + (1 - night) * 0.7;
      sun.color.set(night > 0.5 ? 0x9db4ff : 0xfff1d0);
      var ang = night > 0.5 ? 2.2 : 0.9;
      sun.position.set(Math.cos(ang) * 14, 16, Math.sin(ang) * 10);
      orb.position.copy(sun.position).multiplyScalar(2.6);
      orb.scale.setScalar(night > 0.5 ? 3 : 4.2);
      orb.material.color.set(night > 0.5 ? 0xffe9b8 : 0xfff3a0);
      stars.material.opacity = night;
      flame.scale.set(1, 0.85 + Math.sin(t * 0.012) * 0.2, 1);
      fireLight.intensity = (0.6 + night) * (1 + Math.sin(t * 0.02) * 0.12);

      houses.forEach(function (h, id) {
        var d = h.userData.dead;
        h.userData.win.emissiveIntensity = d ? 0 : night * 1.4;
        h.rotation.z += ((d ? 0.14 : 0) - h.rotation.z) * 0.08;
        var sy = h.scale.y + ((d ? 0.7 : 1) - h.scale.y) * 0.08;
        h.scale.y = sy;
        h.userData.body.material.color.set(d ? "#555a66" : h.userData.wall);
        h.userData.roof.material.color.set(d ? "#2c2f38" : h.userData.roofCol);
        var emph = voted.has(id) && phase === "VOTING" ? 1 : 0;
        h.position.y = emph * (0.15 + Math.sin(t * 0.008) * 0.08);
      });
      var ph = pickedId && houses.get(pickedId);
      marker.visible = !!ph;
      if (ph) marker.position.set(ph.position.x, 3.6 + Math.sin(t * 0.006) * 0.15, ph.position.z);
      stepAttack(t);
      renderer.render(scene, camera);
    }

    function playersSig(pub) {
      return (pub.order || []).join(",") + "|" + JSON.stringify(pub.names || {});
    }

    var lastPlayersSig = "";

    function update(pub, ctx) {
      if (!pub) return;
      var sig = playersSig(pub);
      if (sig !== lastPlayersSig) {
        lastPlayersSig = sig;
        setPlayers(pub.order || [], pub.names || {});
      }
      phase = pub.phase || phase;
      voted = new Set(pub.votedIds || []);
      pickedId = ctx.pickedId || null;

      var vics =
        (pub.phase === "MORNING" || pub.phase === "HUNTER_SHOT") && pub.morning
          ? (pub.morning.died || []).filter(function (d) {
              return d.cause === "night";
            }).map(function (d) {
              return d.playerId;
            })
          : [];
      if (vics.length && animRound !== pub.round) {
        animRound = pub.round;
        setAlive((pub.alive || []).concat(vics));
        vics.forEach(function (id) {
          attack(id, function () {
            setAlive(pub.alive || []);
          });
        });
      } else if (!atk) {
        setAlive(pub.alive || []);
      }
    }

    resize();
    if (typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(resize);
      ro.observe(host);
    } else {
      window.addEventListener("resize", resize);
    }
    raf = requestAnimationFrame(frame);

    return {
      update: update,
      busy: function () {
        return !!atk;
      },
      _teardown: function () {
        running = false;
        cancelAnimationFrame(raf);
        endAttack();
        if (ro) ro.disconnect();
        else window.removeEventListener("resize", resize);
        try {
          renderer.dispose();
        } catch (_) {}
        host.innerHTML = "";
      }
    };
  }

  window.NVWerewolfVillage3D = { create: create };
})();
