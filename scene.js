// scene.js - 3D scene for the Lycosa erythrognatha vibration-recording rig.
// Units: 1 world unit = 1 cm, +Y up, table top at y = 0. Classic script; needs THREE, THREE.OrbitControls, RIG.
(function () {
  'use strict';
  const DIM = RIG.DIM, Y = RIG.Y, POS = RIG.POS;
  const TAU = Math.PI * 2;

  // ---------- state ----------
  let scene, camera, renderer, controls, container;
  let benchGroup;                       // shaken on 'knock': platform, substrate, arena, divider, spiders, ripples
  let male, female;
  let simT = 0;
  let shakeAmp = 0;
  const xrayMats = [];                  // {mat, transparent, opacity, depthWrite}
  let xrayOn = false;
  const view = { active: false, t: 0, dur: 0.8, p0: new THREE.Vector3(), p1: new THREE.Vector3(), t0: new THREE.Vector3(), t1: new THREE.Vector3() };

  // ---------- helpers ----------
  let seed = 12345;
  function rnd() { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }

  function canvasTex(w, h, draw, repeatX, repeatY) {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    draw(c.getContext('2d'), w, h);
    const t = new THREE.CanvasTexture(c);
    t.encoding = THREE.sRGBEncoding;
    t.anisotropy = 4;
    if (repeatX) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeatX, repeatY || repeatX); }
    return t;
  }
  function noiseTex(base, amt, rx, ry, streak) {
    return canvasTex(256, 256, (g, w, h) => {
      g.fillStyle = base; g.fillRect(0, 0, w, h);
      for (let i = 0; i < 5000; i++) {
        const v = (rnd() - 0.5) * amt;
        g.fillStyle = v > 0 ? 'rgba(255,255,255,' + (v / 255).toFixed(3) + ')' : 'rgba(0,0,0,' + (-v / 255).toFixed(3) + ')';
        if (streak) g.fillRect(rnd() * w, rnd() * h, 1 + rnd() * 14, 1);
        else g.fillRect(rnd() * w, rnd() * h, 2, 2);
      }
    }, rx, ry);
  }
  function mat(color, rough, extra) {
    return new THREE.MeshStandardMaterial(Object.assign({ color, roughness: rough == null ? 0.85 : rough, metalness: 0 }, extra || {}));
  }
  function shadowed(m, cast, recv) { m.castShadow = cast !== false; m.receiveShadow = recv !== false; return m; }
  function cylBetween(a, b, r, material, seg) {
    const d = new THREE.Vector3().subVectors(b, a), len = d.length();
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, seg || 10), material);
    m.position.copy(a).addScaledVector(d, 0.5);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
    return shadowed(m);
  }
  function pick(object3d, title, body) { RIG.pickables.push({ object3d, title, body }); }

  // ---------- environment ----------
  function buildEnvironment() {
    // floor
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(900, 900), mat(0x120f0f, 0.95));
    floor.rotation.x = -Math.PI / 2; floor.position.y = -75; floor.receiveShadow = true;
    scene.add(floor);

    // table
    const T = DIM.table;
    const topMat = mat(0x6a5f55, 0.9, { map: noiseTex('#6a5f55', 40, 3, 2, true) });
    const top = shadowed(new THREE.Mesh(new THREE.BoxGeometry(T.w, T.thick, T.d), topMat));
    top.position.y = T.top - T.thick / 2;
    scene.add(top);
    xrayMats.push({ mat: topMat });
    const legH = T.height - T.thick, legS = 4;
    const legMat = mat(0x3d3631, 0.9);
    const legs = new THREE.InstancedMesh(new THREE.BoxGeometry(legS, legH, legS), legMat, 4);
    const m4 = new THREE.Matrix4(); let li = 0;
    [-1, 1].forEach((sx) => [-1, 1].forEach((sz) => {
      m4.makeTranslation(sx * (T.w / 2 - 3 - legS / 2), T.top - T.thick - legH / 2, sz * (T.d / 2 - 3 - legS / 2));
      legs.setMatrixAt(li++, m4);
    }));
    legs.castShadow = true; legs.receiveShadow = true;
    scene.add(legs);
    pick(top, 'Lab bench', 'Ordinary table. It carries the recorder, lamp and camera stand, which sit on the table, not on the isolated platform.');

    benchGroup = new THREE.Group(); benchGroup.name = 'benchGroup';
    scene.add(benchGroup);

    // isolation feet (instanced), tops at Y.platformBottom
    const F = DIM.feet, P = DIM.platform;
    const footMat = mat(0x3a3b3e, 0.55);
    const feet = new THREE.InstancedMesh(new THREE.CylinderGeometry(F.r, F.r, F.h, 24), footMat, 4);
    let fi = 0;
    [-1, 1].forEach((sx) => [-1, 1].forEach((sz) => {
      m4.makeTranslation(sx * (P.w / 2 - F.inset), DIM.table.top + F.h / 2, sz * (P.d / 2 - F.inset));
      feet.setMatrixAt(fi++, m4);
    }));
    feet.castShadow = true; feet.receiveShadow = true; feet.name = 'isolationFeet';
    scene.add(feet);
    pick(feet, 'Isolation feet', 'Compliant mass-spring support; one per corner, nothing else may touch the platform rigidly.');

    // platform (MDF)
    const platMat = mat(0xa38660, 0.9, { map: noiseTex('#a38660', 50, 2, 2, true) });
    const platform = shadowed(new THREE.Mesh(new THREE.BoxGeometry(P.w, P.thick, P.d), platMat));
    platform.position.y = Y.platformBottom + P.thick / 2; platform.name = 'platform';
    benchGroup.add(platform); xrayMats.push({ mat: platMat });
    pick(platform, 'MDF platform', 'MDF slab resting only on the four isolation feet. The piezo disc is glued to its underside below the male half; floor and bench vibration is filtered by the feet.');

    // substrate
    const S = DIM.substrate;
    const subMat = mat(0xe6d6a8, 0.95, { map: noiseTex('#e6d6a8', 22, 1, 1, true) });
    const sub = shadowed(new THREE.Mesh(new THREE.BoxGeometry(S.w, S.thick, S.d), subMat), false, true);
    sub.position.y = Y.platformTop + S.thick / 2; sub.name = 'substrate';
    benchGroup.add(sub); xrayMats.push({ mat: subMat });
    pick(sub, 'Substrate', 'Manila paper, 30×30 cm, Orozco 2026. Both spiders stand on this single continuous sheet, so substrate-borne signals cross under the divider.');

    // arena glass (lathe gives wall thickness)
    const A = DIM.arena;
    const prof = [[A.r - A.wall, 0], [A.r, 0], [A.r, A.h], [A.r - A.wall, A.h], [A.r - A.wall, 0]].map((p) => new THREE.Vector2(p[0], p[1]));
    const arenaGeo = new THREE.LatheGeometry(prof, 64);
    const glassMat = new THREE.MeshStandardMaterial({ color: 0xcfe6f2, roughness: 0.06, metalness: 0, transparent: true, opacity: 0.2, depthWrite: false });
    const arena = new THREE.Mesh(arenaGeo, glassMat);
    arena.position.y = Y.substrate; arena.name = 'arena'; arena.renderOrder = 2;
    arena.add(new THREE.LineSegments(new THREE.EdgesGeometry(arenaGeo, 40), new THREE.LineBasicMaterial({ color: 0xd8f0ff, transparent: true, opacity: 0.55 })));
    benchGroup.add(arena);
    pick(arena, 'Arena', 'Open glass cylinder, 18 cm diameter and 10 cm tall, standing on the paper substrate. The divider splits it into a male half (x<0) and a female half (x>0).');

    // divider
    const D = DIM.divider;
    const divGeo = new THREE.BoxGeometry(D.thick, D.h, D.w);
    const divMat = new THREE.MeshStandardMaterial({ color: 0x7fb8b0, roughness: 0.08, transparent: true, opacity: 0.3, depthWrite: false });
    const div = new THREE.Mesh(divGeo, divMat);
    div.position.set(0, Y.substrate + D.h / 2, 0); div.name = 'divider'; div.renderOrder = 3;
    div.add(new THREE.LineSegments(new THREE.EdgesGeometry(divGeo), new THREE.LineBasicMaterial({ color: 0xa8f0e4, transparent: true, opacity: 0.8 })));
    benchGroup.add(div);
    pick(div, 'Glass divider', 'Chemical-only Phase I then multimodal Phase II; no physical contact, so no mating or cannibalism and individuals stay functionally virgin across trials.');
  }

  // ---------- lamp + camera fixtures ----------
  function buildLamp() {
    const L = POS.redLamp, g = new THREE.Group(); g.name = 'redLamp';
    const metal = mat(0x2b2b2e, 0.5, { metalness: 0.6 });
    const arenaC = new THREE.Vector3(0, Y.substrate, 0);
    const head = new THREE.Vector3(L.x, L.y, L.z);
    const dirAway = new THREE.Vector3(head.x, 0, head.z).normalize();
    const poleXZ = new THREE.Vector3(L.x, 0, L.z).addScaledVector(dirAway, 4);
    const base = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(5, 5.5, 1.2, 28), metal));
    base.position.set(poleXZ.x, 0.6, poleXZ.z); g.add(base);
    g.add(cylBetween(new THREE.Vector3(poleXZ.x, 1.2, poleXZ.z), new THREE.Vector3(poleXZ.x, L.y, poleXZ.z), 0.5, metal));
    g.add(cylBetween(new THREE.Vector3(poleXZ.x, L.y, poleXZ.z), head, 0.45, metal));
    const shadeGeo = new THREE.CylinderGeometry(1.8, 5.5, 7, 28, 1, true);
    shadeGeo.rotateX(-Math.PI / 2); shadeGeo.translate(0, 0, 0.8);
    const shade = new THREE.Mesh(shadeGeo, new THREE.MeshStandardMaterial({ color: 0x3a1512, roughness: 0.6, metalness: 0.3, side: THREE.DoubleSide }));
    shade.castShadow = false;
    const head3 = new THREE.Group(); head3.position.copy(head); head3.add(shade);
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(1.1, 16, 12), new THREE.MeshBasicMaterial({ color: 0xff4a30 }));
    head3.add(bulb);
    head3.lookAt(arenaC);
    g.add(head3);
    scene.add(g);
    pick(g, 'Red work lamp', 'Trials run under red light, which the spiders see poorly, so the observer and overhead camera get light without a strong visual stimulus.');

    const spot = new THREE.SpotLight(0xff3a24, 1.1, 0, 0.75, 0.55, 1);
    spot.position.copy(head); spot.target.position.copy(arenaC);
    spot.castShadow = true; spot.shadow.mapSize.set(2048, 2048);
    spot.shadow.camera.near = 10; spot.shadow.camera.far = 140; spot.shadow.bias = -0.0004;
    scene.add(spot); scene.add(spot.target);
    const under = new THREE.PointLight(0xff8060, 0.6, 45, 1); under.position.set(-8, 1.5, 2); scene.add(under);  // faint glow so the underside electronics are legible
    const glow = new THREE.PointLight(0xff3018, 0.35, 0, 1);
    glow.position.set(L.x, L.y - 4, L.z); scene.add(glow);
  }

  function buildCameraRig() {
    const C = POS.camera, g = new THREE.Group(); g.name = 'overheadCamera';
    const dark = mat(0x26282c, 0.45, { metalness: 0.5 });
    const sx = 30, sz = -24, topY = 62;
    const base = new THREE.Vector3(sx, 0, sz);
    // tripod: three splayed legs on the table, well outside the platform footprint (|x|,|z| > 20)
    for (let i = 0; i < 3; i++) {
      const a = Math.PI / 2 + (i * TAU) / 3 + 0.4;
      const foot = new THREE.Vector3(sx + 7.5 * Math.cos(a), 0, sz + 7.5 * Math.sin(a));
      g.add(cylBetween(foot, new THREE.Vector3(sx, 22, sz), 0.55, dark, 8));
      const pad = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 0.4, 12), mat(0x111111, 0.9)));
      pad.position.set(foot.x, 0.2, foot.z); g.add(pad);
    }
    g.add(cylBetween(new THREE.Vector3(sx, 0.4, sz), new THREE.Vector3(sx, topY, sz), 0.9, dark, 12));
    g.add(cylBetween(new THREE.Vector3(sx, topY, sz), new THREE.Vector3(C.x, topY, C.z), 0.7, dark, 10));
    g.add(cylBetween(new THREE.Vector3(C.x, topY, C.z), new THREE.Vector3(C.x, C.y + 3, C.z), 0.5, dark, 8));
    const body = shadowed(new THREE.Mesh(new THREE.BoxGeometry(9, 5.5, 6.5), dark));
    body.position.set(C.x, C.y, C.z); g.add(body);
    const lens = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(2.1, 2.6, 4, 24), mat(0x111214, 0.3, { metalness: 0.6 })));
    lens.position.set(C.x, C.y - 4.7, C.z); g.add(lens);
    const glass = new THREE.Mesh(new THREE.CircleGeometry(1.7, 20), new THREE.MeshStandardMaterial({ color: 0x223355, roughness: 0.05, metalness: 0.8 }));
    glass.rotation.x = Math.PI / 2; glass.position.set(C.x, C.y - 6.72, C.z); g.add(glass);
    const led = new THREE.Mesh(new THREE.SphereGeometry(0.3, 8, 8), new THREE.MeshBasicMaterial({ color: 0xff2020 }));
    led.position.set(C.x + 3.6, C.y + 1.2, C.z + 3.3); g.add(led);
    scene.add(g);
    pick(g, 'Overhead video camera', 'Looks straight down at the arena to log behaviour. Its stand stands on the bench, not on the platform, because a rigid link would bypass the vibration isolation.');
  }

  // ---------- spiders ----------
  let sharedGeo = null, textures = null;
  function spiderShared() {
    if (sharedGeo) return;
    const seg = new THREE.CylinderGeometry(0.62, 1, 1, 8, 1);
    seg.rotateZ(-Math.PI / 2); seg.translate(0.5, 0, 0);       // unit segment along +x, thicker at base
    const sph = new THREE.SphereGeometry(1, 28, 20);
    sph.rotateZ(Math.PI / 2); sph.rotateY(Math.PI);               // poles on +/-x, dorsal midline at u = 0.5
    sharedGeo = { seg, sph, eye: new THREE.SphereGeometry(1, 8, 6), cap: new THREE.CapsuleGeometry(1, 1.4, 4, 10), fang: new THREE.ConeGeometry(1, 2.2, 8) };
    const mott = (g, w, h, n) => {
      for (let i = 0; i < n; i++) {
        g.fillStyle = rnd() > 0.5 ? 'rgba(30,22,16,' + (0.1 + rnd() * 0.2).toFixed(2) + ')' : 'rgba(190,170,135,' + (0.08 + rnd() * 0.15).toFixed(2) + ')';
        g.beginPath(); g.ellipse(rnd() * w, rnd() * h, 2 + rnd() * 9, 2 + rnd() * 6, rnd() * 3, 0, TAU); g.fill();
      }
    };
    textures = {
      carapace: canvasTex(256, 128, (g, w, h) => {
        g.fillStyle = '#6a5d4c'; g.fillRect(0, 0, w, h); mott(g, w, h, 260);
        g.fillStyle = 'rgba(25,18,12,0.55)'; g.fillRect(w * 0.5 - 52, 0, 24, h); g.fillRect(w * 0.5 + 28, 0, 24, h);
        const gr = g.createLinearGradient(w * 0.5 - 16, 0, w * 0.5 + 16, 0);
        gr.addColorStop(0, 'rgba(205,188,150,0)'); gr.addColorStop(0.25, 'rgba(205,188,150,1)');
        gr.addColorStop(0.75, 'rgba(205,188,150,1)'); gr.addColorStop(1, 'rgba(205,188,150,0)');
        g.fillStyle = gr; g.fillRect(w * 0.5 - 16, 0, 32, h);
      }),
      abdomen: canvasTex(256, 128, (g, w, h) => {
        g.fillStyle = '#74644f'; g.fillRect(0, 0, w, h); mott(g, w, h, 320);
        g.fillStyle = 'rgba(40,30,22,0.5)'; g.fillRect(w * 0.5 - 26, 0, 52, h);
        g.fillStyle = 'rgba(200,182,145,0.85)'; g.fillRect(w * 0.5 - 6, 0, 12, h * 0.55);
        g.strokeStyle = 'rgba(200,182,145,0.8)'; g.lineWidth = 3;
        for (let k = 0; k < 5; k++) { const y = h * (0.58 + k * 0.08); g.beginPath(); g.moveTo(w * 0.5 - 22, y + 8); g.lineTo(w * 0.5, y); g.lineTo(w * 0.5 + 22, y + 8); g.stroke(); }
      }),
    };
  }

  // leg pairs: [yaw from forward (deg), length multiplier, hip x offset (x L)]
  const LEG_DEF = [[38, 0.98, 0.10], [78, 0.88, 0.04], [112, 0.92, -0.03], [148, 1.08, -0.10]];
  const SEG_FRAC = [0.42, 0.46, 0.38, 0.24], SEG_R = [0.032, 0.026, 0.020, 0.015];

  function makeSpider(L, tint, name) {
    spiderShared();
    const sp = new THREE.Group(); sp.name = name;
    const H = 0.42 * L;
    const cMat = mat(0xffffff, 0.8, { map: textures.carapace, color: tint });
    const aMat = mat(0xffffff, 0.8, { map: textures.abdomen, color: tint });
    const legMat = mat(0x6e5d49, 0.8), tarMat = mat(0x3a2e24, 0.8);
    const chelMat = mat(0xd2321a, 0.45, { emissive: 0x6a1204 });
    const dark = mat(0x0a0806, 0.3);

    const body = new THREE.Group(); body.name = 'body'; sp.add(body);
    const ceph = shadowed(new THREE.Mesh(sharedGeo.sph, cMat));
    ceph.scale.set(0.25 * L, 0.11 * L, 0.15 * L); ceph.position.set(0.17 * L, H, 0); ceph.name = 'cephalothorax'; body.add(ceph);
    const abd = shadowed(new THREE.Mesh(sharedGeo.sph, aMat));
    abd.scale.set(0.32 * L, 0.18 * L, 0.2 * L); abd.position.set(-0.24 * L, H + 0.015 * L, 0); abd.name = 'abdomen'; body.add(abd);
    const abdBase = abd.scale.clone();
    // eyes
    [[0.38, 0.075, 0.05, 0.022], [0.38, 0.075, -0.05, 0.022], [0.395, 0.055, 0.035, 0.014], [0.395, 0.055, -0.035, 0.014],
     [0.30, 0.1, 0.045, 0.02], [0.30, 0.1, -0.045, 0.02]].forEach((e) => {
      const m = new THREE.Mesh(sharedGeo.eye, dark); m.scale.setScalar(e[3] * L);
      m.position.set(e[0] * L, H + e[1] * L, e[2] * L); body.add(m);
    });
    // chelicerae (red jaw)
    const chel = [];
    [-1, 1].forEach((s) => {
      const c = shadowed(new THREE.Mesh(sharedGeo.cap, chelMat));
      c.scale.set(0.05 * L, 0.05 * L, 0.05 * L);
      c.position.set(0.405 * L, H - 0.06 * L, s * 0.06 * L); c.rotation.z = -0.25; c.name = 'chelicera';
      body.add(c); chel.push(c);
      const f = new THREE.Mesh(sharedGeo.fang, dark); f.scale.set(0.013 * L, 0.013 * L, 0.013 * L);
      f.position.set(0.42 * L, H - 0.165 * L, s * 0.06 * L); f.rotation.z = Math.PI; body.add(f);
    });
    // pedipalps
    const palps = [];
    [-1, 1].forEach((s) => {
      const pv = new THREE.Group(); pv.name = 'palp_' + (s < 0 ? 'R' : 'L');
      pv.position.set(0.42 * L, H - 0.03 * L, s * 0.1 * L);
      pv.userData.base = -0.55; pv.rotation.z = -0.55; pv.rotation.y = -s * 0.2;
      const m1 = shadowed(new THREE.Mesh(sharedGeo.seg, legMat)); m1.scale.set(0.2 * L, 0.02 * L, 0.02 * L); pv.add(m1);
      const knee = new THREE.Group(); knee.position.x = 0.2 * L; knee.rotation.z = -0.5; pv.add(knee);
      const m2 = shadowed(new THREE.Mesh(sharedGeo.seg, tarMat)); m2.scale.set(0.12 * L, 0.018 * L, 0.018 * L); knee.add(m2);
      const bulb = shadowed(new THREE.Mesh(sharedGeo.eye, tarMat)); bulb.scale.setScalar(0.03 * L); bulb.position.x = 0.125 * L; knee.add(bulb);
      body.add(pv); palps.push(pv);
    });
    // legs
    const legs = [];
    LEG_DEF.forEach((def, pair) => {
      [1, -1].forEach((s) => {
        const phi = def[0] * Math.PI / 180, mult = def[1];
        const lens = SEG_FRAC.map((f) => f * L * mult);
        const yaw = new THREE.Group(); yaw.name = 'leg' + (pair + 1) + (s > 0 ? 'L' : 'R');
        yaw.position.set(0.17 * L + def[2] * L, H - 0.02 * L, s * 0.07 * L);
        yaw.rotation.y = -s * phi; body.add(yaw);
        // planar chain: p1, p2 fixed; solve p3 so the tarsus tip lands on the substrate (y = 0)
        const p1 = (pair === 0 ? 48 : 40) * Math.PI / 180, p2 = -24 * Math.PI / 180, hip = H - 0.02 * L, tipR = 0.012 * L;
        const tipY = (p3) => hip + lens[0] * Math.sin(p1) + lens[1] * Math.sin(p2) + lens[2] * Math.sin(p3) + lens[3] * Math.sin(p3 - 0.14);
        let lo = -1.5, hi = 0.6;
        for (let it = 0; it < 40; it++) { const mid = (lo + hi) / 2; if (tipY(mid) > tipR) hi = mid; else lo = mid; }
        const ps = [p1, p2, (lo + hi) / 2, (lo + hi) / 2 - 0.14];
        const joints = [], base = [];
        let parent = yaw;
        for (let i = 0; i < 4; i++) {
          const j = new THREE.Group(); j.name = yaw.name + '_' + ['femur', 'patellaTibia', 'metatarsus', 'tarsus'][i];
          if (i > 0) j.position.x = lens[i - 1];
          const rel = ps[i] - (i > 0 ? ps[i - 1] : 0);
          j.rotation.z = rel; base.push(rel);
          const m = shadowed(new THREE.Mesh(sharedGeo.seg, i === 3 ? tarMat : legMat));
          m.scale.set(lens[i], SEG_R[i] * L, SEG_R[i] * L); j.add(m);
          parent.add(j); joints.push(j); parent = j;
        }
        legs.push({ pair, side: s, yaw, joints, base, yawBase: yaw.rotation.y, phase: rnd() * TAU });
      });
    });
    sp.userData = { L, body, ceph, abd, abdBase, chel, palps, legs, H };
    return sp;
  }

  function buildSpiders() {
    male = makeSpider(2.0, new THREE.Color(0xc8bcae), 'male');
    male.position.set(POS.male.x, POS.male.y, POS.male.z);            // faces +x
    female = makeSpider(2.6, new THREE.Color(0xe0d4c4), 'female');
    female.position.set(POS.female.x, POS.female.y, POS.female.z);
    female.rotation.y = Math.PI;                                       // faces -x
    benchGroup.add(male); benchGroup.add(female);
    pick(male, 'Male Lycosa erythrognatha', 'Smaller (about 2 cm body) with the distinctive red chelicerae that give the species its name ("red jaw"). The leg-raising display is known only from an unpublished personal observation (Toscano-Gadea & González 2019); its vibratory component has never been recorded, which is what this rig is for.');
    pick(female, 'Female Lycosa erythrognatha', 'Larger (about 2.6 cm body) with red chelicerae ("erythrognatha" = red jaw). She stands on the far half of the paper and receives substrate-borne signals through her legs. The male\'s leg-raising display has only been noted anecdotally (Toscano-Gadea & González 2019) and its vibrations were never recorded.');
  }

  // ---------- ripples ----------
  const MAX_RIPPLES = 40, RIPPLE_SPEED = 25, RIPPLE_MAX_R = 15;
  const ripples = []; let rippleIdx = 0;
  const RIPPLE_COLORS = { percussion: 0xffc66b, stridulation: 0xff93b8, knock: 0xffffff };
  const lastRippleT = {};
  function buildRipples() {
    const geo = new THREE.RingGeometry(0.975, 1, 72, 1);
    for (let i = 0; i < MAX_RIPPLES; i++) {
      const m = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
      const r = new THREE.Mesh(geo, m);
      r.rotation.x = -Math.PI / 2; r.position.y = Y.substrate + 0.04; r.visible = false; r.renderOrder = 1;
      r.userData = { age: 0, delay: 0, amp: 0, speed: RIPPLE_SPEED, live: false };
      benchGroup.add(r); ripples.push(r);
    }
  }
  function spawnRipple(x, z, amp, kind, delay, speed) {
    // reuse a dead slot, else steal the oldest
    let r = null;
    for (let i = 0; i < MAX_RIPPLES; i++) { const c = ripples[(rippleIdx + i) % MAX_RIPPLES]; if (!c.userData.live) { r = c; break; } }
    if (!r) { let oldest = -1; ripples.forEach((c) => { if (c.userData.age > oldest) { oldest = c.userData.age; r = c; } }); }
    rippleIdx = (rippleIdx + 1) % MAX_RIPPLES;
    const u = r.userData; u.age = 0; u.delay = delay || 0; u.amp = amp; u.speed = speed || RIPPLE_SPEED; u.live = true;
    r.position.x = x; r.position.z = z; r.material.color.setHex(RIPPLE_COLORS[kind] || 0xffc66b);
    r.visible = false; r.scale.setScalar(0.01);
  }
  function updateRipples(dt) {
    for (let i = 0; i < MAX_RIPPLES; i++) {
      const r = ripples[i], u = r.userData; if (!u.live) continue;
      if (u.delay > 0) { u.delay -= dt; if (u.delay > 0) continue; r.visible = true; }
      else r.visible = true;
      u.age += dt;
      const rad = u.age * u.speed;
      if (rad >= RIPPLE_MAX_R) { u.live = false; r.visible = false; r.material.opacity = 0; continue; }
      r.scale.setScalar(Math.max(rad, 0.05));
      r.material.opacity = Math.min(1, u.amp * 1.1) * Math.pow(1 - rad / RIPPLE_MAX_R, 1.3);
    }
  }

  // ---------- reactions ----------
  const R = { lastPulse: -10, tap: 0, strid: 0, raise: 0, bout: 0 };
  function onPulse(p) {
    if (!p) return;
    const kind = p.kind, amp = p.amp == null ? 0.5 : p.amp;
    if (kind === 'knock') {
      shakeAmp = 0.35;
      const x = p.x || 0, z = p.z || 0;
      spawnRipple(x, z, 1, 'knock', 0, 28); spawnRipple(x, z, 0.8, 'knock', 0.12, 28); spawnRipple(x, z, 0.6, 'knock', 0.24, 28);
      return;
    }
    R.lastPulse = simT;
    if (kind === 'percussion') R.tap = Math.max(R.tap, 0.5 + 0.5 * amp);
    else if (kind === 'stridulation') R.strid = simT + 0.3;
    // limit ripple flooding for very dense pulse trains
    if (simT - (lastRippleT[kind] || -1) >= 0.03) {
      lastRippleT[kind] = simT;
      spawnRipple(p.x == null ? POS.male.x : p.x, p.z == null ? 0 : p.z, amp, kind);
    }
  }

  function animateSpiders(dt) {
    const bout = simT - R.lastPulse < 1.2;
    R.raise += ((bout ? 1 : 0) - R.raise) * (1 - Math.exp(-dt / (bout ? 0.35 : 0.5)));
    R.bout += ((bout ? 1 : 0) - R.bout) * (1 - Math.exp(-dt / 0.5));
    R.tap *= Math.exp(-dt / 0.09);
    const stridOn = simT < R.strid ? 1 : 0;
    const r = R.raise;

    // male
    const m = male.userData;
    m.palps.forEach((pv, i) => {
      const osc = stridOn ? Math.sin(simT * TAU * 26 + i * 1.7) * 0.22 : 0;
      pv.rotation.z = pv.userData.base - R.tap * 0.7 + osc;
    });
    m.legs.forEach((lg) => {
      const j = lg.joints, b = lg.base;
      if (lg.pair === 0) {
        const wave = r * 0.06 * Math.sin(simT * TAU * 2.2 + lg.phase);
        j[0].rotation.z = b[0] + r * 0.95 - R.tap * 0.3 + wave;
        j[1].rotation.z = b[1] + r * 0.35;
        j[2].rotation.z = b[2] + r * 0.55 + R.tap * 0.1;
        j[3].rotation.z = b[3] + r * 0.3;
        lg.yaw.rotation.y = lg.yawBase + lg.side * r * 0.12;
      } else {
        j[0].rotation.z = b[0]; // other legs stay planted
      }
    });
    m.abd.scale.set(m.abdBase.x, m.abdBase.y * (1 + 0.03 * Math.sin(simT * TAU * 0.45)), m.abdBase.z * (1 + 0.025 * Math.sin(simT * TAU * 0.45)));
    m.body.rotation.z = r * 0.05;   // slight forward pitch of the raised front
    male.rotation.y = 0.02 * Math.sin(simT * 0.6);

    // female
    const f = female.userData;
    f.abd.scale.set(f.abdBase.x, f.abdBase.y * (1 + 0.035 * Math.sin(simT * TAU * 0.38 + 1)), f.abdBase.z * (1 + 0.03 * Math.sin(simT * TAU * 0.38 + 1)));
    // Male is straight ahead (-x), so orienting is a small scan centred on him, not a net yaw.
    female.rotation.y = Math.PI + 0.025 * Math.sin(simT * 0.7) + R.bout * 0.05 * Math.sin(simT * 2.1);
    f.palps.forEach((pv, i) => { pv.rotation.z = pv.userData.base + 0.04 * Math.sin(simT * 1.9 + i * 2) - R.bout * 0.12; });
    f.legs.forEach((lg) => {
      if (lg.pair === 0) lg.joints[0].rotation.z = lg.base[0] + 0.03 * Math.sin(simT * 0.9 + lg.phase) + R.bout * 0.06;
    });
  }

  // ---------- view + xray ----------
  const PRESETS = {
    overview: { p: [58, 52, 82], t: [0, 4, 0] },
    arena: { p: [9, 17, 20], t: [0, 5.5, 0] },
    underside: { p: [-4.5, 1.5, 28], t: [POS.piezo.x, POS.piezo.y, POS.piezo.z] },
    // close, slightly raised front view so the components and jumpers on the 7 × 5 cm board are legible
    board: { p: [POS.enclosure.x - 1, 2.2, POS.enclosure.z + 13], t: [POS.enclosure.x - 1, 1.4, POS.enclosure.z] },
    chain: { p: [-22, 5, 52], t: [-20, 1.5, 12] },
  };
  function setView(name) {
    const pr = PRESETS[name]; if (!pr || !camera) return;
    view.p0.copy(camera.position); view.t0.copy(controls.target);
    view.p1.set(pr.p[0], pr.p[1], pr.p[2]); view.t1.set(pr.t[0], pr.t[1], pr.t[2]);
    view.t = 0; view.active = true;
  }
  function setXray(on) {
    on = !!on; if (on === xrayOn) return; xrayOn = on;
    xrayMats.forEach((e) => {
      const m = e.mat;
      if (e.saved === undefined) e.saved = { transparent: m.transparent, opacity: m.opacity, depthWrite: m.depthWrite };
      if (on) { m.transparent = true; m.opacity = 0.25; m.depthWrite = false; }
      else { m.transparent = e.saved.transparent; m.opacity = e.saved.opacity; m.depthWrite = e.saved.depthWrite; }
      m.needsUpdate = true;
    });
  }

  // ---------- init / update ----------
  function resize() {
    const w = container.clientWidth || window.innerWidth, h = container.clientHeight || window.innerHeight;
    renderer.setSize(w, h, false);
    renderer.domElement.style.width = '100%'; renderer.domElement.style.height = '100%';
    camera.aspect = w / h; camera.updateProjectionMatrix();
  }

  function init(containerEl) {
    container = containerEl;
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0b0707);
    scene.fog = new THREE.Fog(0x0b0707, 260, 700);

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(renderer.domElement);
    renderer.domElement.style.display = 'block';

    camera = new THREE.PerspectiveCamera(40, 1, 0.5, 1500);
    controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true; controls.dampingFactor = 0.08;
    controls.minDistance = 2; controls.maxDistance = 250;
    controls.target.set(0, 4, 0);
    const o = PRESETS.overview; camera.position.set(o.p[0], o.p[1], o.p[2]);

    // lights: dim ambient, neutral fill, red lamp added in buildLamp
    scene.add(new THREE.AmbientLight(0x4a2a28, 0.55));
    scene.add(new THREE.HemisphereLight(0x9aa6bc, 0x2a2018, 0.3));
    const fill = new THREE.DirectionalLight(0xa9b3c8, 0.45); fill.position.set(-50, 90, 70); scene.add(fill);

    buildEnvironment();
    buildSpiders();
    buildRipples();
    buildLamp();
    buildCameraRig();

    RIG.bus.on('pulse', onPulse);
    RIG.bus.on('view', (v) => { if (!v) return; if (v.preset) setView(v.preset); setXray(!!v.xray); });

    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(resize).observe(container);
    window.addEventListener('resize', resize);
    resize();
    return { scene, camera, renderer, controls };
  }

  function update(dt, t) {
    if (!renderer) return;
    dt = Math.min(Math.max(dt || 0, 0), 0.1);
    simT += dt;

    if (view.active) {
      view.t += dt / view.dur;
      const k = Math.min(view.t, 1), e = k * k * (3 - 2 * k);
      camera.position.lerpVectors(view.p0, view.p1, e);
      controls.target.lerpVectors(view.t0, view.t1, e);
      if (k >= 1) view.active = false;
    }

    animateSpiders(dt);
    updateRipples(dt);

    if (shakeAmp > 0.0005) {
      shakeAmp *= Math.exp(-dt / 0.25);
      benchGroup.position.set(shakeAmp * Math.sin(simT * 71), shakeAmp * 0.3 * Math.sin(simT * 93), shakeAmp * Math.cos(simT * 83));
    } else if (shakeAmp > 0) { shakeAmp = 0; benchGroup.position.set(0, 0, 0); }

    controls.update();
    if (camera.position.y < -70) camera.position.y = -70;   // stay above the floor
    renderer.render(scene, camera);
  }

  RIG.modules.scene = { init, update, setView, setXray };
})();
