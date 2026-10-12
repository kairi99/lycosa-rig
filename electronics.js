// electronics.js — piezo assembly, preamp enclosure + PCB, output cable, handheld recorder.
// Units: cm, +Y up, table top y = 0. Uses globals THREE (r147) and RIG (contract.js).
(function () {
  'use strict';
  const DIM = RIG.DIM, Y = RIG.Y, POS = RIG.POS;

  // ---------- module state (all mutated in place, no per-frame allocation) ----------
  const S = {
    built: false, ceramicMat: null, electrodeMat: null, leadMat: null, cableMat: null,
    u1Mat: null, d1Mat: null, d2Mat: null, screwPivot: null,
    glow: 0, leadFlow: 0, cableFlow: 0, flashD: 0, flashU: 0,
    screenCtx: null, screenTex: null, screenAcc: 1, leadLen: 0, cableLen: 0,
  };
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const LN10 = Math.LN10;
  // 1 mV faint -> 1 V strong; < 0.1 mV = dark
  function lev(v) {
    v = Math.abs(v || 0);
    if (v <= 1e-4) return 0;
    return clamp((Math.log(v) / LN10 + 3) / 3, 0.03, 1);
  }

  // ---------- small builders ----------
  const matCache = {};
  function mat(color, rough, metal, extra) {
    const key = color + '|' + rough + '|' + metal + '|' + (extra ? JSON.stringify(extra) : '');
    if (!extra || !extra.unique) {
      if (matCache[key]) return matCache[key];
    }
    const o = Object.assign({ color: color, roughness: rough == null ? 0.6 : rough, metalness: metal || 0 }, extra || {});
    delete o.unique;
    const m = new THREE.MeshStandardMaterial(o);
    if (!extra || !extra.unique) matCache[key] = m;
    return m;
  }
  function add(parent, geo, m, x, y, z) {
    const o = new THREE.Mesh(geo, m);
    o.position.set(x || 0, y || 0, z || 0);
    parent.add(o);
    return o;
  }
  const geoCache = {};
  function boxG(w, h, d) {
    const k = 'b' + w + ',' + h + ',' + d;
    return geoCache[k] || (geoCache[k] = new THREE.BoxGeometry(w, h, d));
  }
  function cylG(rt, rb, h, seg, rz) {
    const k = 'c' + rt + ',' + rb + ',' + h + ',' + seg + ',' + (rz ? 1 : 0);
    if (!geoCache[k]) {
      const g = new THREE.CylinderGeometry(rt, rb, h, seg);
      if (rz) g.rotateZ(Math.PI / 2);
      geoCache[k] = g;
    }
    return geoCache[k];
  }
  function labelTex(text, w, h, bg, fg, font) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const x = c.getContext('2d');
    x.fillStyle = bg; x.fillRect(0, 0, w, h);
    x.fillStyle = fg; x.font = font; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText(text, w / 2, h / 2 + 2);
    const t = new THREE.CanvasTexture(c);
    t.anisotropy = 4;
    return t;
  }
  function pick(obj, title, body) { RIG.pickables.push({ object3d: obj, title: title, body: body }); }

  const SILVER = 0xd2d6db;
  const BAND = { brown: 0x7a3b10, black: 0x141414, red: 0xc4281c, orange: 0xe8731a, yellow: 0xe6c619, green: 0x2a8a3c, gold: 0xcfa63a };

  // thin axis-aligned lead wires
  function legV(parent, x, y0, y1, z) {
    const o = add(parent, cylG(0.022, 0.022, 1, 6), mat(SILVER, 0.35, 0.45), x, (y0 + y1) / 2, z);
    o.scale.y = Math.abs(y1 - y0); return o;
  }
  function legH(parent, xc, y, z, len) {
    const o = add(parent, cylG(0.022, 0.022, 1, 6, true), mat(SILVER, 0.35, 0.45), xc, y, z);
    o.scale.x = len; return o;
  }

  // ---------- component factories (PCB-local: y = 0 is the board's top face) ----------
  function makeResistor(bands, span) {
    const g = new THREE.Group();
    const len = 0.63, rad = 0.12, h0 = 0.2;
    span = span || 1.016;
    add(g, cylG(rad, rad, len, 12, true), mat(0xd9c9a0, 0.8, 0), 0, h0, 0);
    const xs = [-0.21, -0.13, -0.05, 0.2];
    for (let i = 0; i < bands.length; i++) {
      add(g, cylG(rad * 1.05, rad * 1.05, 0.05, 12, true), mat(BAND[bands[i]], 0.7, bands[i] === 'gold' ? 0.6 : 0), xs[i], h0, 0);
    }
    for (const s of [-1, 1]) {
      legH(g, s * (len / 2 + (span - len) / 4), h0, 0, (span - len) / 2);
      legV(g, s * span / 2, -0.1, h0, 0);
    }
    return g;
  }
  function makeDiode(flip, span) {
    const g = new THREE.Group();
    const len = 0.37, rad = 0.09, h0 = 0.15;
    span = span || 1.016;
    const bodyMat = mat(0xe08a2a, 0.15, 0, { emissive: 0x000000, unique: true, transparent: true, opacity: 0.92 });
    add(g, cylG(rad, rad, len, 10, true), bodyMat, 0, h0, 0);
    const s = flip ? -1 : 1;
    add(g, cylG(rad * 1.06, rad * 1.06, 0.06, 10, true), mat(0x111111, 0.5, 0), s * 0.14, h0, 0);
    for (const k of [-1, 1]) {
      legH(g, k * (len / 2 + (span - len) / 4), h0, 0, (span - len) / 2);
      legV(g, k * span / 2, -0.1, h0, 0);
    }
    g.userData.bodyMat = bodyMat;
    return g;
  }
  function makeElectrolytic(r, h, color, stripeAngle) {
    const g = new THREE.Group();
    const y0 = 0.06;
    add(g, cylG(r, r, h, 18), mat(color, 0.45, 0.1), 0, y0 + h / 2, 0);
    // lighter polarity stripe on the (-) side
    const sg = new THREE.CylinderGeometry(r + 0.004, r + 0.004, h * 0.96, 8, 1, true, stripeAngle - 0.45, 0.9);
    add(g, sg, mat(0xc8d2dc, 0.5, 0.1, { side: THREE.DoubleSide }), 0, y0 + h / 2, 0);
    add(g, cylG(r * 0.98, r * 0.98, 0.01, 18), mat(0x8a8f96, 0.4, 0.7), 0, y0 + h + 0.004, 0);
    add(g, boxG(r * 1.4, 0.006, 0.03), mat(0x555a60, 0.5, 0.5), 0, y0 + h + 0.01, 0);
    add(g, boxG(0.03, 0.006, r * 1.4), mat(0x555a60, 0.5, 0.5), 0, y0 + h + 0.01, 0);
    legV(g, -0.127, -0.1, y0, 0); legV(g, 0.127, -0.1, y0, 0);
    return g;
  }
  function makeTrimpot() {
    const g = new THREE.Group();
    add(g, boxG(0.95, 0.5, 0.95), mat(0x1d5fd0, 0.45, 0.05), 0, 0.28, 0);
    add(g, cylG(0.3, 0.3, 0.02, 20), mat(0x153f8c, 0.5, 0), 0, 0.535, 0);
    const piv = new THREE.Group();
    piv.position.set(0, 0.56, 0);
    add(piv, cylG(0.17, 0.17, 0.08, 18), mat(0xc9a24a, 0.3, 0.9), 0, 0.02, 0);
    add(piv, boxG(0.3, 0.03, 0.05), mat(0x2a2218, 0.6, 0.3), 0, 0.065, 0);
    g.add(piv);
    for (const dx of [-0.254, 0, 0.254]) legV(g, dx, -0.1, 0.05, 0.4);
    S.screwPivot = piv;
    return g;
  }
  function makeDIP8() {
    const g = new THREE.Group();
    const bm = mat(0x17181a, 0.5, 0.1, { unique: true, emissive: 0x000000 });
    S.u1Mat = bm;
    const body = add(g, boxG(0.98, 0.35, 0.64), bm, 0, 0.27, 0);
    const lt = labelTex('TL072', 256, 128, '#17181a', '#d8d8d8', 'bold 64px monospace');
    const lm = new THREE.MeshBasicMaterial({ map: lt, transparent: true, opacity: 0.95 });
    const lab = add(g, new THREE.PlaneGeometry(0.7, 0.35), lm, 0.06, 0.447, 0);
    lab.rotation.x = -Math.PI / 2;
    add(g, cylG(0.09, 0.09, 0.004, 14), mat(0x050505, 0.8, 0), -0.43, 0.446, 0); // notch
    add(g, cylG(0.03, 0.03, 0.004, 8), mat(0xdddddd, 0.6, 0), -0.36, 0.447, 0.2); // pin-1 dot (pins 1-4 run along +z)
    const lm2 = mat(SILVER, 0.35, 0.45);
    for (let i = 0; i < 4; i++) {
      const x = -0.381 + i * 0.254;
      for (const s of [-1, 1]) {
        add(g, boxG(0.06, 0.3, 0.045), lm2, x, 0.15, s * 0.381);
        add(g, boxG(0.06, 0.04, 0.12), lm2, x, 0.27, s * 0.336);
      }
    }
    g.userData.body = body;
    return g;
  }
  function makeFilmBox() {
    const g = new THREE.Group();
    add(g, boxG(1.4, 0.95, 0.6), mat(0xd9302a, 0.5, 0), 0, 0.55, 0);
    add(g, boxG(1.0, 0.5, 0.605), mat(0xe8c21a, 0.5, 0), 0, 0.6, 0);
    legV(g, -0.508, -0.1, 0.08, 0); legV(g, 0.508, -0.1, 0.08, 0);
    return g;
  }
  function makeCeramicDisc() {
    const g = new THREE.Group();
    const dm = mat(0xe8a020, 0.5, 0);
    const d = new THREE.Mesh(cylG(0.26, 0.26, 0.12, 18), dm);
    d.rotation.x = Math.PI / 2; d.position.set(0, 0.42, 0); g.add(d);
    const lt = labelTex('104', 64, 64, '#e8a020', '#3a2a10', 'bold 30px monospace');
    const lab = add(g, new THREE.PlaneGeometry(0.34, 0.34), new THREE.MeshBasicMaterial({ map: lt }), 0, 0.42, 0.066);
    legV(g, -0.254, -0.1, 0.2, 0); legV(g, 0.254, -0.1, 0.2, 0);
    return g;
  }

  // ---------- textures ----------
  function pcbTexture() {
    const W = 700, H = 500;
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const x = c.getContext('2d');
    x.fillStyle = '#b39a62'; x.fillRect(0, 0, W, H);
    // hole grid
    for (let gx = 0.12; gx < 7; gx += 0.254) {
      for (let gz = 0.12; gz < 5; gz += 0.254) {
        x.fillStyle = '#c9915a'; x.beginPath(); x.arc(gx * 100, gz * 100, 7, 0, 6.2832); x.fill();
        x.fillStyle = '#241c12'; x.beginPath(); x.arc(gx * 100, gz * 100, 3.4, 0, 6.2832); x.fill();
      }
    }
    const t = new THREE.CanvasTexture(c); t.anisotropy = 8;
    return t;
  }
  function flowTex() {
    const c = document.createElement('canvas'); c.width = 128; c.height = 4;
    const x = c.getContext('2d');
    x.fillStyle = '#000'; x.fillRect(0, 0, 128, 4);
    const g = x.createLinearGradient(0, 0, 50, 0);
    g.addColorStop(0, '#000'); g.addColorStop(0.7, '#fff'); g.addColorStop(1, '#000');
    x.fillStyle = g; x.fillRect(0, 0, 50, 4);
    const t = new THREE.CanvasTexture(c);
    t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.RepeatWrapping;
    return t;
  }

  // ---------- recorder screen ----------
  function drawScreen(t, lv) {
    const x = S.screenCtx;
    const db = lv && isFinite(lv.dbfs) ? clamp(lv.dbfs, -60, 0) : -60;
    const clip = !!(lv && lv.clipping);
    x.fillStyle = '#07140f'; x.fillRect(0, 0, 256, 160);
    x.font = 'bold 26px monospace'; x.textBaseline = 'top'; x.textAlign = 'left';
    x.fillStyle = '#ff4a4a'; x.fillText('REC', 14, 10);
    x.fillStyle = (Math.floor(t * 1.6) % 2 === 0) ? '#ff2a2a' : '#4a1212';
    x.fillText('●', 70, 10);
    x.fillStyle = '#7fe0a0'; x.font = '16px monospace';
    x.fillText('00:' + (Math.floor(t) % 60 < 10 ? '0' : '') + (Math.floor(t) % 60), 170, 16);
    x.fillText('48 kHz / 16-bit', 14, 48);
    const fr = (db + 60) / 60;
    x.strokeStyle = '#7fe0a0'; x.lineWidth = 2; x.strokeRect(14, 84, 228, 26);
    x.fillStyle = clip ? '#ff2a2a' : (db > -12 ? '#e8d23a' : '#3ad07a');
    x.fillRect(16, 86, 224 * fr, 22);
    x.fillStyle = '#7fe0a0'; x.font = '11px monospace';
    for (let i = 0; i <= 3; i++) { const tx = 14 + 228 * i / 3; x.fillRect(tx - 1, 112, 2, 5); x.fillText(String(-60 + 20 * i), tx - 8, 120); }
    x.font = 'bold 18px monospace'; x.fillStyle = clip ? '#ff5050' : '#d8ffe6';
    x.fillText(db.toFixed(1) + ' dBFS' + (clip ? '  CLIP' : ''), 14, 134);
    S.screenTex.needsUpdate = true;
  }

  // ---------- build ----------
  function build(scene) {
    if (S.built) return;
    S.built = true;
    const root = new THREE.Group(); root.name = 'electronics';
    scene.add(root);
    const PZ = DIM.piezo;
    const flowL = flowTex(), flowC = flowTex();

    // ===== Piezo assembly (local y = 0 is the platform underside; everything hangs down) =====
    const pz = new THREE.Group(); pz.name = 'piezo';
    pz.position.set(POS.piezo.x, Y.platformBottom, POS.piezo.z);
    root.add(pz);
    const disc = new THREE.Group(); pz.add(disc);
    add(disc, cylG(PZ.brassR + 0.05, PZ.brassR + 0.05, 0.04, 40), mat(0xd8c28a, 0.3, 0, { transparent: true, opacity: 0.75 }), 0, -0.02, 0);
    add(disc, cylG(PZ.brassR, PZ.brassR, PZ.brassT, 40), mat(0xc9a24a, 0.3, 0.9), 0, -0.04 - PZ.brassT / 2, 0);
    S.ceramicMat = mat(0xe9e3cf, 0.5, 0, { unique: true, emissive: 0x4d8fe0 });
    S.ceramicMat.emissiveIntensity = 0;
    add(disc, cylG(PZ.ceramicR, PZ.ceramicR, PZ.ceramicT, 40), S.ceramicMat, 0, -0.06 - PZ.ceramicT / 2, 0);
    S.electrodeMat = mat(0xc9ccd0, 0.25, 0.9, { unique: true, emissive: 0x4d8fe0 });
    S.electrodeMat.emissiveIntensity = 0;
    add(disc, cylG(PZ.ceramicR * 0.92, PZ.ceramicR * 0.92, 0.004, 40), S.electrodeMat, 0, -0.06 - PZ.ceramicT - 0.002, 0);
    // translucent dark epoxy fill under the ceramic
    const fillTop = -0.09, fillBot = -0.38;
    add(disc, cylG(PZ.housingR - 0.2, PZ.housingR - 0.2, fillTop - fillBot, 40),
      mat(0x3a2410, 0.4, 0, { transparent: true, opacity: 0.55, depthWrite: false }), 0, (fillTop + fillBot) / 2, 0);
    // housing ring (lathe cross-section)
    const prof = [new THREE.Vector2(PZ.housingR - 0.2, 0), new THREE.Vector2(PZ.housingR, 0), new THREE.Vector2(PZ.housingR, -PZ.housingT),
      new THREE.Vector2(PZ.housingR - 0.2, -PZ.housingT), new THREE.Vector2(PZ.housingR - 0.2, 0)];
    add(disc, new THREE.LatheGeometry(prof, 40), mat(0x1c1a1e, 0.5, 0.05, { side: THREE.DoubleSide }), 0, 0, 0);
    // foil shield (bumpy, one face of the pair; second face is the upper foil wrapped under the housing)
    const fg = new THREE.RingGeometry(0.01, PZ.housingR - 0.15, 40, 7);
    const fp = fg.attributes.position;
    for (let i = 0; i < fp.count; i++) {
      const a = fp.getX(i), b = fp.getY(i);
      fp.setZ(i, 0.025 * Math.sin(a * 9.1 + b * 4.3) + 0.02 * Math.sin(b * 12.7 - a * 3.1) + 0.012 * Math.sin((a + b) * 23));
    }
    fg.rotateX(Math.PI / 2); fg.computeVertexNormals();
    const foil = add(pz, fg, mat(0xb8bcc2, 0.35, 0.9, { side: THREE.DoubleSide, flatShading: true }), 0, -0.4, 0);
    // short leads out of the housing: red = ceramic (hot), black = brass (ground)
    const leadExitZ = PZ.housingR + 0.35;
    const redC = new THREE.CatmullRomCurve3([new THREE.Vector3(0.12, -0.2, 0.9), new THREE.Vector3(0.12, -0.25, PZ.housingR), new THREE.Vector3(0.1, -0.25, leadExitZ)]);
    const blkC = new THREE.CatmullRomCurve3([new THREE.Vector3(-0.12, -0.3, 0.9), new THREE.Vector3(-0.12, -0.28, PZ.housingR), new THREE.Vector3(-0.1, -0.25, leadExitZ)]);
    add(pz, new THREE.TubeGeometry(redC, 8, 0.045, 6), mat(0xd02020, 0.5, 0), 0, 0, 0);
    add(pz, new THREE.TubeGeometry(blkC, 8, 0.045, 6), mat(0x151515, 0.5, 0), 0, 0, 0);

    // ===== Preamp enclosure (local: origin at centre/top face, y negative downward) =====
    const EW = DIM.enclosure.w, ED = DIM.enclosure.d, EH = DIM.enclosure.h;
    const enc = new THREE.Group(); enc.name = 'enclosure';
    enc.position.set(POS.enclosure.x, Y.platformBottom, POS.enclosure.z);
    root.add(enc);
    const shell = add(enc, boxG(EW, EH, ED),
      new THREE.MeshStandardMaterial({ color: 0xbfe3ff, roughness: 0.1, metalness: 0, transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide }),
      0, -EH / 2, 0);
    shell.renderOrder = 5;
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(shell.geometry), new THREE.LineBasicMaterial({ color: 0x9fd2f5 }));
    edges.position.copy(shell.position); enc.add(edges);
    // mounting tabs + screws on top (screwed to the platform underside)
    for (const sx of [-1, 1]) {
      add(enc, boxG(0.5, 0.06, 0.8), mat(0xaab0b6, 0.4, 0.8), sx * (EW / 2 - 0.25), -0.12, 0);
    }
    // standoffs
    const bottomY = -EH + 0.1;
    const pcbTopY = bottomY + 0.4 + DIM.pcb.thick;
    const PX = -1.0; // PCB centre x (enclosure-local)
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      add(enc, cylG(0.15, 0.15, 0.4, 10), mat(0xc9a24a, 0.35, 0.8), PX + sx * (DIM.pcb.w / 2 - 0.3), bottomY + 0.2, sz * (DIM.pcb.d / 2 - 0.3));
    }

    // ===== PCB (layout and wiring come from board_layout.js; see rig_build_spec.md §2a) =====
    const BD = RIG.BOARD;
    const pcb = new THREE.Group(); pcb.name = 'PCB';
    pcb.position.set(PX, pcbTopY, 0);
    enc.add(pcb);
    add(pcb, boxG(DIM.pcb.w, DIM.pcb.thick, DIM.pcb.d), mat(0x8e7a4c, 0.8, 0), 0, -DIM.pcb.thick / 2, 0);
    const pt = pcbTexture();
    const top = add(pcb, new THREE.PlaneGeometry(DIM.pcb.w, DIM.pcb.d), new THREE.MeshStandardMaterial({ map: pt, roughness: 0.75 }), 0, 0.002, 0);
    top.rotation.x = -Math.PI / 2;
    pick(pcb.children[0], 'PCB · perfboard', 'Hand-wired 7 × 5 cm perfboard (0.1" grid) on four standoffs. Every lead sits in its own hole; bare tinned bus wire carries +9 V and ground, and coloured insulated jumpers make the other connections, crossing only at different heights. Signal enters on the right and leaves on the left.');

    const HP = (h) => BD.hole(h[0], h[1]);
    const partBy = {};
    for (const p of BD.parts) partBy[p.ref] = p;
    // Place a part so local +x runs from pin pa to pin pb and its leads land exactly in those holes.
    function between(g, pa, pb, yOff) {
      const a = HP(pa), b = HP(pb);
      g.position.set((a.x + b.x) / 2, yOff || 0, (a.z + b.z) / 2);
      g.rotation.y = Math.atan2(-(b.z - a.z), b.x - a.x);
      pcb.add(g); return g;
    }
    const span = (pa, pb) => { const a = HP(pa), b = HP(pb); return Math.hypot(b.x - a.x, b.z - a.z); };
    function resistor(ref) { const p = partBy[ref]; return between(makeResistor(p.bands, span(p.pins.a, p.pins.b)), p.pins.a, p.pins.b); }
    function diode(ref) { const p = partBy[ref]; return between(makeDiode(false, span(p.pins.A, p.pins.K)), p.pins.A, p.pins.K); }
    function electro(ref) { const p = partBy[ref]; return between(makeElectrolytic(p.r, p.h, p.color, Math.PI / 2), p.pins['+'], p.pins['-']); }

    const R1 = resistor('R1');
    pick(R1, 'R1 · 1 MΩ', 'From node A to the V/2 rail. Sets the low-frequency corner with the disc\'s own capacitance (~11 Hz). A lower value silently deletes low-frequency signal — try 100 kΩ in the controls.');
    const D1 = diode('D1'), D2 = diode('D2');
    S.d1Mat = D1.userData.bodyMat; S.d2Mat = D2.userData.bodyMat;
    const clampTxt = 'Anti-parallel pair between node A and the V/2 rail, not 0 V: node A idles at V/2, so a clamp to ground would forward-bias and wreck the bias. A knocked disc is limited to about V/2 ± 0.6 V. The black band marks the cathode.';
    pick(D1, 'D1 · 1N4148', clampTxt); pick(D2, 'D2 · 1N4148', clampTxt);

    const U1p = partBy.U1.pins, uc = HP([(U1p[1][0] + U1p[4][0]) / 2, (U1p[1][1] + U1p[8][1]) / 2]);
    const U1 = makeDIP8(); U1.position.set(uc.x, 0, uc.z); pcb.add(U1);
    pick(U1, 'U1 · TL072', 'Dual JFET-input op-amp; notch on the left, pin 1 front-left. Half A (pins 1–3) is the non-inverting gain stage, gain = 1 + RV1/R4; half B (pins 5–7) buffers the V/2 divider. Pin 4 = 0 V, pin 8 = +9 V.');

    const C4p = partBy.C4.pins, C4 = between(makeCeramicDisc(), C4p[1], C4p[2]);
    pick(C4, 'C4 · 100 nF ceramic', 'Supply bypass from +9 V to ground beside U1 pin 8, shorting high-frequency supply noise before it reaches the op-amp.');
    const R2 = resistor('R2'), R3 = resistor('R3');
    const divTxt = 'Equal 100 kΩ divider that makes the V/2 (4.5 V) bias from the 9 V battery, into U1 pin 5. Buffered by U1B and smoothed by C1 so the single supply can carry an AC signal.';
    pick(R2, 'R2 · 100 kΩ', divTxt); pick(R3, 'R3 · 100 kΩ', divTxt);
    const C1 = electro('C1');
    pick(C1, 'C1 · 10 µF', 'Smooths the divider node so supply ripple and noise never reach U1A\'s input through R1. Pale stripe = negative lead, to ground.');
    const C5 = electro('C5');
    pick(C5, 'C5 · 10 µF', 'Supply reservoir across +9 V and ground: covers brief current demands so the rail does not sag on signal peaks.');

    const RVp = partBy.RV1.pins, rvW = HP(RVp.W);
    const RV1 = makeTrimpot(); RV1.position.set(rvW.x, 0, rvW.z - 0.4); pcb.add(RV1);
    pick(RV1, 'RV1 · 100 kΩ trimpot', 'Wired as a variable resistor (wiper tied to one end) from U1 pin 1 to pin 2. Sets the gain from 1× to 101× (0–40 dB) as 1 + RV1/R4. Turn the gain control to see the screw rotate.');
    const R4 = resistor('R4');
    pick(R4, 'R4 · 1 kΩ', 'Gain-set leg from U1 pin 2: gain = 1 + RV1/R4. Its other end goes to ground through C2, so the stage has unity gain at DC.');
    const C2 = electro('C2');
    pick(C2, 'C2 · 22 µF', 'DC-blocks the gain-set leg so the stage is unity-gain at DC and the bias is not amplified.');
    const C3p = partBy.C3.pins, C3 = between(makeFilmBox(), C3p[1], C3p[2]);
    pick(C3, 'C3 · 4.7 µF film', 'Output DC block ahead of the recorder input, so the V/2 offset never reaches the recorder.');
    const R6 = resistor('R6');
    pick(R6, 'R6 · 100 Ω', 'Output series resistor that isolates the op-amp from cable capacitance so it stays stable. Its far end is the line output to the jack tip.');

    // --- wiring: bare bus (layer 0) and insulated jumpers (layers 1, 2) ---
    const LIFT = [0.03, 0.10, 0.20], RAD = [0.022, 0.03, 0.03];
    const NETCOL = { VP: 0xd02020, GND: 0x1a1a1a, IN: 0xe8c21a, VB: 0x2f9a4a, DIV: 0x2a62c9, FB: 0xe8e8e8, X: 0x8a8f96, OA: 0xe8731a, C3O: 0x8a4fc9 };
    function polyTube(pts, r, m, parent) {
      const cp = new THREE.CurvePath();
      for (let i = 1; i < pts.length; i++) cp.add(new THREE.LineCurve3(pts[i - 1], pts[i]));
      return add(parent, new THREE.TubeGeometry(cp, Math.max(8, pts.length * 6), r, 6), m, 0, 0, 0);
    }
    for (const w of BD.wires) {
      const y = LIFT[w.layer];
      const pts = [];
      const first = HP(w.path[0]), last = HP(w.path[w.path.length - 1]);
      pts.push(new THREE.Vector3(first.x, -0.02, first.z));
      for (const h of w.path) { const q = HP(h); pts.push(new THREE.Vector3(q.x, y, q.z)); }
      pts.push(new THREE.Vector3(last.x, -0.02, last.z));
      const m = w.layer === 0 ? mat(SILVER, 0.35, 0.45) : mat(NETCOL[w.net] || 0x777777, 0.55, 0);
      const tube = polyTube(pts, RAD[w.layer], m, pcb);
      const info = BD.netInfo[w.net] || [w.net, ''];
      pick(tube, (w.layer === 0 ? 'Bus wire · ' : 'Jumper · ') + info[0], info[1]);
    }
    // solder joints on the underside of every used hole (visible through the clear enclosure floor edge-on)
    const used = new Set();
    for (const p of BD.parts) for (const h of Object.values(p.pins)) used.add(h[0] + ',' + h[1]);
    for (const w of BD.wires) for (const h of [w.path[0], w.path[w.path.length - 1]]) used.add(h[0] + ',' + h[1]);
    for (const k of Object.values(BD.pads)) used.add(k[0] + ',' + k[1]);
    const solderGeo = new THREE.SphereGeometry(0.06, 8, 4, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2);
    const solderMat = mat(0xcfd3d8, 0.25, 0.9);
    used.forEach((k) => { const h = k.split(',').map(Number), q = HP(h); add(pcb, solderGeo, solderMat, q.x, -DIM.pcb.thick, q.z); });

    pick(foil, 'Foil shield', 'Aluminium foil on both faces of the disc inside the housing, grounded at one point only (the short strap to the black lead) to avoid a ground loop. Shields the high-impedance 1 MΩ node from hum.');
    // foil-to-ground strap at the housing edge: the single ground point
    add(pz, new THREE.TubeGeometry(new THREE.LineCurve3(new THREE.Vector3(-0.12, -0.4, 1.2), new THREE.Vector3(-0.12, -0.3, 0.9)), 2, 0.03, 6), mat(SILVER, 0.35, 0.45), 0, 0, 0);
    pick(disc, 'PZ1 · piezo disc', 'A 27 mm piezo disc epoxied to the underside of the platform, below the male\'s half. It turns substrate-borne vibration into a voltage across ~15 nF. Red lead = ceramic face (signal), black = brass face (ground).');

    // ===== Off-board terminals (enclosure-local) =====
    const padPos = (name) => { const q = HP(BD.pads[name]); return new THREE.Vector3(PX + q.x, pcbTopY, q.z); };
    const above = (v, dy) => new THREE.Vector3(v.x, v.y + dy, v.z);
    const TERM = {};

    // J1 on the -x wall, solder lugs facing inward
    const J1 = new THREE.Group(); J1.name = 'J1';
    const jy = -1.25;
    J1.position.set(-EW / 2, jy, 0);
    enc.add(J1);
    add(J1, boxG(1.2, 0.85, 0.9), mat(0x2b2e33, 0.5, 0.2), 0, 0, 0);
    add(J1, cylG(0.34, 0.34, 0.2, 16, true), mat(0xd0d3d6, 0.25, 0.95), -0.6, 0, 0);
    const hole = add(J1, new THREE.CircleGeometry(0.2, 16), new THREE.MeshBasicMaterial({ color: 0x050505 }), -0.711, 0, 0);
    hole.rotation.y = -Math.PI / 2;
    for (const [nm, lz] of [['tip', -0.22], ['sleeve', 0.24]]) {
      add(J1, boxG(0.28, 0.22, 0.04), mat(0xd0d3d6, 0.25, 0.95), 0.72, -0.3, lz);
      TERM['J1.' + nm] = new THREE.Vector3(-EW / 2 + 0.84, jy - 0.3, lz);
    }
    pick(J1, 'J1 · 3.5 mm jack', 'Output jack to the recorder: tip = signal (from R6), sleeve = 0 V. On the -x wall; the cable droops with slack so it cannot carry vibration to the table.');

    // SW1 on the +z wall beside the battery snap, two lugs inside
    const SW1 = new THREE.Group(); SW1.name = 'SW1';
    SW1.position.set(4.1, -1.2, ED / 2);
    enc.add(SW1);
    add(SW1, boxG(1.0, 0.5, 0.5), mat(0x202226, 0.5, 0.2), 0, 0, 0.3);
    add(SW1, boxG(0.7, 0.04, 0.4), mat(0xc4c8cc, 0.3, 0.9), 0, 0.27, 0.3);
    add(SW1, boxG(0.28, 0.2, 0.2), mat(0x3a3e44, 0.5, 0.1), -0.15, 0.37, 0.3);
    add(SW1, boxG(0.9, 0.4, 0.3), mat(0x202226, 0.5, 0.2), 0, 0, -0.15);
    for (const [nm, lx] of [['1', -0.28], ['2', 0.28]]) {
      add(SW1, boxG(0.06, 0.12, 0.25), mat(0xd0d3d6, 0.25, 0.95), lx, -0.05, -0.42);
      TERM['SW1.' + nm] = new THREE.Vector3(4.1 + lx, -1.25, ED / 2 - 0.55);
    }
    pick(SW1, 'SW1 · slide switch', 'Power switch in the battery\'s + lead, between the battery and the +9 V bus. Battery power only: a mains adapter would couple 60 Hz hum straight into the 1 MΩ node.');

    // BT1 inside the enclosure, snap end toward SW1
    const BT1 = new THREE.Group(); BT1.name = 'BT1';
    const bx = 4.0, bz = -0.45, by = -EH + 0.1 + 0.875;
    BT1.position.set(bx, by, bz);
    enc.add(BT1);
    add(BT1, boxG(2.65, 1.75, 4.8), mat(0x1c1c1c, 0.5, 0.1), 0, 0, 0);
    const bl = labelTex('9V', 128, 128, '#2a5ca8', '#ffffff', 'bold 64px sans-serif');
    const blm = add(BT1, new THREE.PlaneGeometry(2.3, 4.4), new THREE.MeshBasicMaterial({ map: bl }), 0, 0.8785 + 0.001, 0);
    blm.rotation.x = -Math.PI / 2;
    // 9 V snap: hexagonal negative, round positive
    add(BT1, new THREE.CylinderGeometry(0.2, 0.2, 0.25, 6).rotateX(Math.PI / 2), mat(0xc4c8cc, 0.3, 0.95), -0.62, 0, 2.5);
    add(BT1, new THREE.CylinderGeometry(0.16, 0.16, 0.25, 12).rotateX(Math.PI / 2), mat(0xc4c8cc, 0.3, 0.95), 0.62, 0, 2.5);
    add(BT1, boxG(2.2, 1.1, 0.7), mat(0x0e0e10, 0.6, 0), 0, 0, 2.85);
    TERM['BT1.+'] = new THREE.Vector3(bx + 0.62, by + 0.2, bz + 3.2);
    TERM['BT1.-'] = new THREE.Vector3(bx - 0.62, by + 0.2, bz + 3.2);
    pick(BT1, 'BT1 · 9 V battery', 'Battery supply inside the enclosure. + goes through SW1 to the +9 V bus; − goes to the ground bus. The V/2 divider turns the single 9 V rail into a ±4.5 V signal swing.');

    // piezo lead gland on the -z wall, above the board's right edge
    const glandL = new THREE.Vector3(2.4, -1.25, -ED / 2);
    TERM['PZ1.hot'] = glandL.clone(); TERM['PZ1.shield'] = glandL.clone();

    // flying leads, routed to stay clear of the board, battery and walls
    const fly = {
      'PZ1.hot': (a, b) => [a, new THREE.Vector3(2.6, a.y, a.z + 0.4), new THREE.Vector3(2.6, b.y + 0.35, b.z - 0.6), above(b, 0.3), b],
      'PZ1.shield': (a, b) => [a, new THREE.Vector3(2.35, a.y - 0.1, a.z + 0.4), above(b, 0.3), b],
      'SW1.2': (a, b) => [a, new THREE.Vector3(a.x, -0.35, a.z - 0.6), new THREE.Vector3(2.7, -0.35, b.z), above(b, 0.35), b],
      'BT1.-': (a, b) => [a, new THREE.Vector3(a.x - 0.4, a.y, a.z + 0.15), new THREE.Vector3(2.6, b.y + 0.3, b.z + 0.1), above(b, 0.25), b],
      'J1.tip': (a, b) => [a, new THREE.Vector3(a.x - 0.4, a.y + 0.3, a.z), new THREE.Vector3(b.x + 0.25, b.y, b.z), b],
      'J1.sleeve': (a, b) => [a, new THREE.Vector3(a.x - 0.3, a.y + 0.3, a.z), new THREE.Vector3(b.x + 0.25, b.y, b.z), b],
    };
    let innerLen = 0;
    for (const o of BD.offboard) {
      const pad = padPos(o.pad), t = TERM[o.to];
      const curve = new THREE.CatmullRomCurve3(fly[o.to](pad, t), false, 'centripetal');
      if (o.to === 'PZ1.hot') innerLen = curve.getLength();
      const m = add(enc, new THREE.TubeGeometry(curve, 24, 0.035, 6), mat(o.color, 0.55, 0), 0, 0, 0);
      const info = BD.netInfo[o.net] || [o.net, ''];
      pick(m, 'Lead · ' + o.to + ' → ' + o.pad, info[1]);
    }
    for (const tw of BD.terminals) {
      const a = TERM[tw.a], b = TERM[tw.b];
      const curve = new THREE.CatmullRomCurve3([a, new THREE.Vector3(a.x, a.y, a.z + 0.15), new THREE.Vector3(b.x, b.y, b.z - 0.15), b], false, 'centripetal');
      const m = add(enc, new THREE.TubeGeometry(curve, 12, 0.035, 6), mat(tw.color, 0.55, 0), 0, 0, 0);
      pick(m, 'Lead · battery + → SW1', 'Battery positive to the power switch; the switch\'s other lug feeds the +9 V bus.');
    }

    // ===== Lead from the piezo to the gland (world coordinates) =====
    const gx = enc.position.x + glandL.x, gz = enc.position.z + glandL.z, gy = enc.position.y + glandL.y;
    const lp = [
      new THREE.Vector3(POS.piezo.x + 0.1, Y.platformBottom - 0.25, POS.piezo.z + leadExitZ + 0.05),
      new THREE.Vector3(POS.piezo.x - 0.3, Y.platformBottom - 0.45, POS.piezo.z + 2.9),
      new THREE.Vector3(gx + 0.6, gy + 0.5, gz - 1.3),
      new THREE.Vector3(gx + 0.15, gy + 0.1, gz - 0.35),
      new THREE.Vector3(gx, gy, gz),
    ];
    const leadCurve = new THREE.CatmullRomCurve3(lp, false, 'centripetal');
    S.leadLen = leadCurve.getLength();
    console.info('[electronics] piezo lead length = ' + S.leadLen.toFixed(2) + ' cm (+' + innerLen.toFixed(2) + ' cm inside box = ' + (S.leadLen + innerLen).toFixed(2) + ' cm total to node A; limit 15)');
    S.leadMat = new THREE.MeshStandardMaterial({ color: 0x6c7078, roughness: 0.6, metalness: 0.2, emissive: 0x4d8fe0, emissiveMap: flowL, emissiveIntensity: 0 });
    flowL.repeat.set(Math.max(2, S.leadLen / 1.2), 1);
    const leadMesh = new THREE.Mesh(new THREE.TubeGeometry(leadCurve, 40, 0.14, 8), S.leadMat);
    root.add(leadMesh);
    const grom = add(root, new THREE.TorusGeometry(0.2, 0.05, 6, 12), mat(0x222426, 0.6, 0), gx, gy, gz);
    grom.rotation.x = Math.PI / 2;
    pick(leadMesh, 'Piezo lead · shielded pair', 'Shielded twisted pair from the disc to the board, about ' + S.leadLen.toFixed(1) + ' cm long. It must stay under 15 cm: node A is a 1 MΩ node that picks up hum on any longer run.');
    pick(enc, 'Preamp enclosure', 'Clear acrylic box screwed to the platform underside. It hangs 0.6 cm clear of the table, so it cannot bypass the vibration isolation by touching it.');
    pick(shell, 'Preamp enclosure', 'Clear acrylic box screwed to the platform underside. It hangs 0.6 cm clear of the table, so it cannot bypass the vibration isolation by touching it.');

    // ===== Recorder =====
    const rec = new THREE.Group(); rec.name = 'recorder';
    rec.position.set(POS.recorder.x, POS.recorder.y, POS.recorder.z);
    root.add(rec);
    const RW = 5, RH = 3, RL = 13;
    add(rec, boxG(RW, RH, RL), mat(0x2b2d31, 0.55, 0.15), 0, RH / 2, 0);
    add(rec, boxG(RW - 0.4, 0.06, RL - 0.4), mat(0x3a3d42, 0.5, 0.2), 0, RH + 0.01, 0);
    S.screenCtx = (function () {
      const c = document.createElement('canvas'); c.width = 256; c.height = 160;
      S.screenTex = new THREE.CanvasTexture(c); S.screenTex.anisotropy = 4;
      return c.getContext('2d');
    })();
    const scr = add(rec, new THREE.PlaneGeometry(3.8, 2.375), new THREE.MeshBasicMaterial({ map: S.screenTex, toneMapped: false }), 0, RH + 0.08, -0.4);
    scr.rotation.x = -Math.PI / 2;
    add(rec, boxG(4.0, 0.05, 2.55), mat(0x0c0d0f, 0.3, 0.3), 0, RH + 0.045, -0.4);
    const recBtn = add(rec, cylG(0.38, 0.38, 0.08, 16), mat(0xcc2020, 0.4, 0), 0, RH + 0.06, 3.2);
    for (const bxx of [-1.2, 1.2]) add(rec, cylG(0.28, 0.28, 0.06, 14), mat(0x9a9da2, 0.5, 0.3), bxx, RH + 0.05, 3.2);
    add(rec, cylG(0.28, 0.28, 0.06, 14), mat(0x9a9da2, 0.5, 0.3), 0, RH + 0.05, 4.7);
    for (const mx of [-0.9, 0.9]) {
      const cap = new THREE.Group();
      add(cap, new THREE.CylinderGeometry(0.42, 0.42, 0.7, 14).rotateX(Math.PI / 2), mat(0x1a1b1d, 0.6, 0.4), 0, 0, 0);
      add(cap, new THREE.SphereGeometry(0.42, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2).rotateX(-Math.PI / 2), mat(0x3a3c40, 0.7, 0.2), 0, 0, -0.35);
      cap.position.set(mx, RH - 0.9, -RL / 2 - 0.3);
      cap.rotation.y = mx > 0 ? -0.35 : 0.35;
      rec.add(cap);
    }
    // 3.5 mm input on the +x side
    const jIn = RH / 2, jInZ = -3.5;
    add(rec, cylG(0.3, 0.3, 0.12, 14, true), mat(0xd0d3d6, 0.25, 0.95), RW / 2 + 0.05, jIn, jInZ);
    const plug = new THREE.Group();
    add(plug, cylG(0.3, 0.3, 0.9, 14, true), mat(0x111214, 0.5, 0.1), 0.45, 0, 0);
    add(plug, cylG(0.14, 0.14, 0.5, 10, true), mat(0xd0d3d6, 0.25, 0.95), -0.2, 0, 0);
    plug.position.set(RW / 2 + 0.05, jIn, jInZ);
    rec.add(plug);
    pick(rec, 'Handheld recorder', 'Generic portable recorder, 48 kHz / 16-bit, sitting on the table. It is the line-level destination for the preamp. The screen shows the live level; red means the input is clipping.');

    // ===== Output cable (world coordinates, rests on the table with slack) =====
    const jackWorld = new THREE.Vector3(enc.position.x - EW / 2, enc.position.y + jy, enc.position.z);
    const plugX = jackWorld.x - 0.6 - 1.0;
    // J1 plug
    const jplug = new THREE.Group();
    add(jplug, cylG(0.3, 0.3, 1.0, 14, true), mat(0x111214, 0.5, 0.1), 0, 0, 0);
    add(jplug, cylG(0.19, 0.19, 0.2, 10, true), mat(0xd0d3d6, 0.25, 0.95), 0.6, 0, 0);
    jplug.position.set(jackWorld.x - 0.6 - 0.5 + 0.0, jackWorld.y, jackWorld.z);
    root.add(jplug);
    const recIn = new THREE.Vector3(rec.position.x + RW / 2 + 0.05 + 0.9, rec.position.y + jIn, rec.position.z + jInZ);
    const cp = [
      new THREE.Vector3(plugX, jackWorld.y, jackWorld.z),
      new THREE.Vector3(plugX - 1.1, jackWorld.y - 0.1, jackWorld.z),
      new THREE.Vector3(plugX - 2.0, 0.9, jackWorld.z + 0.2),
      new THREE.Vector3(plugX - 2.9, 0.18, jackWorld.z + 1.2),
      new THREE.Vector3(-22.5, 0.12, 12.0),
      new THREE.Vector3(-25.0, 0.12, 10.5),
      new THREE.Vector3(-27.5, 0.12, 13.5),
      new THREE.Vector3(-28.8, 0.12, 15.4),
      new THREE.Vector3(recIn.x + 1.0, 0.12, recIn.z + 0.6),
      new THREE.Vector3(recIn.x + 0.55, 0.5, recIn.z + 0.15),
      new THREE.Vector3(recIn.x + 0.2, recIn.y - 0.1, recIn.z),
      new THREE.Vector3(recIn.x, recIn.y, recIn.z),
    ];
    const cableCurve = new THREE.CatmullRomCurve3(cp, false, 'centripetal');
    S.cableLen = cableCurve.getLength();
    S.cableMat = new THREE.MeshStandardMaterial({ color: 0x25272b, roughness: 0.55, metalness: 0.1, emissive: 0x6fe3a0, emissiveMap: flowC, emissiveIntensity: 0 });
    flowC.repeat.set(Math.max(3, S.cableLen / 1.5), 1);
    const cableMesh = new THREE.Mesh(new THREE.TubeGeometry(cableCurve, 220, 0.12, 6), S.cableMat);
    root.add(cableMesh);
    // table-contact check
    let minY = 1e9;
    for (let i = 0; i <= 400; i++) { const p = cableCurve.getPoint(i / 400); if (p.y < minY) minY = p.y; }
    console.info('[electronics] output cable length = ' + S.cableLen.toFixed(1) + ' cm, min centre y = ' + minY.toFixed(3) + ' (radius 0.12)');
    pick(cableMesh, 'Output cable', 'Line-level cable from J1 to the recorder. It droops and lies slack on the table, so it cannot act as a rigid link that bypasses the vibration isolation.');

    // initial state
    drawScreen(0, null);
    S.screwPivot.rotation.y = -(RIG.DEFAULTS.gain || 0) * 1.5 * Math.PI;
    RIG.bus.on('params', function (e) {
      if (e && e.key === 'gain' && S.screwPivot) S.screwPivot.rotation.y = -clamp(+e.value, 0, 1) * 1.5 * Math.PI;
    });
  }

  // ---------- update ----------
  function update(dt, t, levels) {
    if (!S.built) return;
    dt = dt || 0;
    const lv = levels || null;
    const pV = lv ? lev(lv.piezoV) : 0, aV = lv ? lev(lv.nodeAV) : 0, oV = lv ? lev(lv.outV) : 0;
    const k = 1 - Math.exp(-dt * 18);
    S.glow += (pV - S.glow) * k;
    S.leadFlow += (aV - S.leadFlow) * k;
    S.cableFlow += (oV - S.cableFlow) * k;
    S.ceramicMat.emissiveIntensity = S.glow * 1.3;
    S.electrodeMat.emissiveIntensity = S.glow * 1.0;
    S.leadMat.emissiveIntensity = S.leadFlow * 2.2;
    S.cableMat.emissiveIntensity = S.cableFlow * 2.2;
    S.leadMat.emissiveMap.offset.x -= dt * 1.2;
    S.cableMat.emissiveMap.offset.x -= dt * 1.2;

    if (lv && lv.clamped) S.flashD = 1; else S.flashD = Math.max(0, S.flashD - dt * 3);
    if (lv && lv.clipping) S.flashU = 1; else S.flashU = Math.max(0, S.flashU - dt * 3);
    S.d1Mat.emissive.setHex(0xffb060); S.d2Mat.emissive.setHex(0xffb060);
    S.d1Mat.emissiveIntensity = S.d2Mat.emissiveIntensity = S.flashD * 2.2;
    S.u1Mat.emissive.setHex(0xff2020);
    S.u1Mat.emissiveIntensity = S.flashU * 1.8;

    S.screenAcc += dt;
    if (S.screenAcc >= 1 / 15) {
      S.screenAcc = 0;
      drawScreen(t || 0, lv);
    }
  }

  RIG.modules.electronics = { build: build, update: update };
})();
