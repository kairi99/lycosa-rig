(function () {
  'use strict';
  const RIG = window.RIG;
  const $ = (id) => document.getElementById(id);
  const mods = () => RIG.modules || {};
  const cssVar = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

  const state = Object.assign({}, RIG.DEFAULTS);
  let lastLevels = null;
  let ctx3 = null;           // {scene, camera, renderer, controls}
  let view = { preset: 'overview', xray: false };
  let bodeDirty = true;
  let corner = null;         // {f, db}

  /* ---------- helpers ---------- */
  function emitParam(key, value) {
    state[key] = value;
    RIG.bus.emit('params', { key: key, value: value });
    if (key !== 'knock' && key !== 'running') bodeDirty = true;
    if (key === 'domFreq' || key === 'gain' || key === 'R1' || key === 'Cp') bodeDirty = true;
  }
  function fmtV(v) {
    if (v == null || !isFinite(v)) return '—';
    const a = Math.abs(v);
    if (a < 1e-3) return (v * 1e6).toFixed(0) + ' µV';
    if (a < 1) return (v * 1e3).toFixed(1) + ' mV';
    return v.toFixed(2) + ' V';
  }
  function fmtHz(f) { return f >= 1000 ? (f / 1000).toFixed(2) + ' kHz' : Math.round(f) + ' Hz'; }
  function niceStep(x) {              // smallest 1-2-5 value >= x
    if (!(x > 0)) return 1;
    const e = Math.pow(10, Math.floor(Math.log10(x)));
    const m = x / e;
    return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * e;
  }
  function fmtDiv(v, unit) {          // v in unit
    const s = v >= 1 ? String(+v.toFixed(0)) : v >= 0.1 ? v.toFixed(1) : v >= 0.01 ? v.toFixed(2) : v.toPrecision(1);
    return s + ' ' + unit + '/div';
  }
  function freqFromSlider(s) { return 40 * Math.pow(50, s / 1000); }
  function sliderFromFreq(f) { return Math.round(1000 * Math.log(f / 40) / Math.log(50)); }
  function resp(f) {
    const s = mods().signal;
    if (!s || !s.analyticResponse) return NaN;
    try { return s.analyticResponse(f); } catch (e) { return NaN; }
  }
  function computeCorner() {
    const ref = resp(1000);
    if (!isFinite(ref)) return null;
    const target = ref - 3;
    let prevF = 1, prevD = resp(1);
    if (prevD >= target) return { f: 1, db: prevD };
    for (let i = 1; i <= 400; i++) {
      const f = Math.pow(200, i / 400);
      const d = resp(f);
      if (d >= target) {
        const k = (target - prevD) / ((d - prevD) || 1);
        return { f: prevF * Math.pow(f / prevF, clamp(k, 0, 1)), db: target };
      }
      prevF = f; prevD = d;
    }
    return null;
  }

  /* ---------- 3D + modules ---------- */
  function setupScene() {
    const vp = $('viewport');
    const missing = [];
    ['scene', 'electronics', 'signal'].forEach((n) => { if (!mods()[n]) missing.push(n + '.js'); });
    if (missing.length) showError('Module failed to load: ' + missing.join(', ') + '. The rest of the interface keeps working.');
    if (mods().scene && mods().scene.init) {
      try { ctx3 = mods().scene.init(vp); } catch (e) { showError('scene.js init failed: ' + e.message); }
    }
    if (ctx3 && mods().electronics && mods().electronics.build) {
      try { mods().electronics.build(ctx3.scene); } catch (e) { showError('electronics.js build failed: ' + e.message); }
    }
  }
  function showError(msg) {
    const d = document.createElement('div');
    d.className = 'vp-error';
    d.setAttribute('role', 'alert');
    d.textContent = msg;
    $('viewport').appendChild(d);
  }

  /* ---------- controls ---------- */
  function setPressed(group, attr, val) {
    group.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.getAttribute(attr) === String(val))));
  }
  function gainText(g) {
    const n = 1 + g * 100000 / 1000;
    return '×' + n.toFixed(n < 10 ? 2 : 1) + ' (' + (20 * Math.log10(n)).toFixed(1) + ' dB)';
  }
  function setupControls() {
    const D = state;
    // run
    const run = $('btn-run');
    const paintRun = () => { run.textContent = D.running ? 'Pause' : 'Run'; run.setAttribute('aria-pressed', String(!!D.running)); };
    paintRun();
    run.addEventListener('click', () => { emitParam('running', !D.running); paintRun(); });
    $('btn-knock').addEventListener('click', () => emitParam('knock', true));

    // signal type
    const seg = $('seg-signalType');
    setPressed(seg, 'data-v', D.signalType);
    seg.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-v]'); if (!b) return;
      setPressed(seg, 'data-v', b.dataset.v); emitParam('signalType', b.dataset.v);
    });

    // domFreq
    const df = $('in-domFreq');
    df.value = sliderFromFreq(D.domFreq);
    const paintDf = () => { $('out-domFreq').textContent = fmtHz(D.domFreq); df.setAttribute('aria-valuetext', fmtHz(D.domFreq)); };
    paintDf();
    df.addEventListener('input', () => { emitParam('domFreq', Math.round(freqFromSlider(+df.value))); paintDf(); });

    const br = $('in-boutRate');
    br.value = D.boutRate;
    const paintBr = () => { $('out-boutRate').textContent = D.boutRate + ' /min'; };
    paintBr();
    br.addEventListener('input', () => { emitParam('boutRate', +br.value); paintBr(); });

    // preamp
    const r1 = $('in-R1'); r1.value = String(D.R1);
    r1.addEventListener('change', () => emitParam('R1', +r1.value));
    const g = $('in-gain'); g.value = D.gain;
    const paintG = () => { $('out-gain').textContent = gainText(D.gain); };
    paintG();
    g.addEventListener('input', () => { emitParam('gain', +g.value); paintG(); });
    const cp = $('in-Cp');
    Array.prototype.forEach.call(cp.options, (o) => { if (Math.abs(+o.value - D.Cp) < 1e-12) cp.value = o.value; });
    cp.addEventListener('change', () => emitParam('Cp', +cp.value));

    // environment
    const iso = $('in-isolation'); iso.checked = !!D.isolation;
    const paintIso = () => { $('out-isolation').textContent = iso.checked ? 'On' : 'Off'; };
    paintIso();
    iso.addEventListener('change', () => { paintIso(); emitParam('isolation', iso.checked); });
    const mains = $('in-mains'); mains.value = D.mains;
    mains.addEventListener('change', () => emitParam('mains', mains.value));
    const amb = $('in-ambient'); amb.value = D.ambient;
    const paintAmb = () => { $('out-ambient').textContent = Math.round(D.ambient * 100) + ' %'; };
    paintAmb();
    amb.addEventListener('input', () => { emitParam('ambient', +amb.value); paintAmb(); });

    // view
    const vp = $('view-presets');
    const map = { overview: 'overview', arena: 'arena', underside: 'underside', board: 'board', chain: 'chain' };
    setPressed(vp, 'data-p', view.preset);
    const emitView = () => RIG.bus.emit('view', { preset: view.preset, xray: view.xray });
    vp.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-p]'); if (!b) return;
      view.preset = map[b.dataset.p]; setPressed(vp, 'data-p', view.preset); emitView();
    });
    $('in-xray').addEventListener('change', (e) => { view.xray = e.target.checked; emitView(); });

    // initial emits (once)
    ['running', 'signalType', 'domFreq', 'boutRate', 'R1', 'gain', 'Cp', 'isolation', 'mains', 'ambient'].forEach((k) => RIG.bus.emit('params', { key: k, value: D[k] }));
    emitView();
  }

  function setupNotice() {
    const s = mods().signal;
    if (s && typeof s.DISCLAIMER === 'string' && s.DISCLAIMER) $('notice-text').textContent = s.DISCLAIMER;
  }

  /* ---------- readouts ---------- */
  function paintReadouts() {
    const L = lastLevels;
    if (L) {
      $('r-piezo').textContent = fmtV(L.piezoV);
      $('r-nodeA').textContent = fmtV(L.nodeAV);
      $('r-out').textContent = fmtV(L.outV);
      $('r-dbfs').textContent = isFinite(L.dbfs) ? L.dbfs.toFixed(1) + ' dBFS' : '−∞ dBFS';
      $('pill-clamp').classList.toggle('on', !!L.clamped);
      $('pill-clip').classList.toggle('on', !!L.clipping);
    }
    corner = computeCorner();
    $('r-corner').textContent = corner ? fmtHz(corner.f).replace(/^(\d+)\.\d+ /, '$1 ') : '< 1 Hz or n/a';
    if (corner && corner.f < 100) $('r-corner').textContent = (corner.f < 10 ? corner.f.toFixed(1) : Math.round(corner.f)) + ' Hz';
  }

  /* ---------- canvas plumbing ---------- */
  function fitCanvas(cv) {
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(10, cv.clientWidth), h = Math.max(10, cv.clientHeight);
    const pw = Math.round(w * dpr), ph = Math.round(h * dpr);
    let changed = false;
    if (cv.width !== pw || cv.height !== ph) { cv.width = pw; cv.height = ph; changed = true; }
    const c = cv.getContext('2d');
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { c: c, w: w, h: h, dpr: dpr, changed: changed };
  }
  function label(c, txt, x, y, col, align, base) {
    c.fillStyle = col; c.font = '10px "IBM Plex Mono", ui-monospace, monospace';
    c.textAlign = align || 'left'; c.textBaseline = base || 'alphabetic';
    c.fillText(txt, x, y);
  }

  /* ---------- oscilloscope ---------- */
  function drawScope() {
    const cv = $('cv-scope');
    const f = fitCanvas(cv), c = f.c, w = f.w, h = f.h;
    const ink3 = cssVar('--ink-3'), rule = cssVar('--rule'), sheet = cssVar('--sheet');
    c.fillStyle = sheet; c.fillRect(0, 0, w, h);
    const m = { l: 6, r: 6, t: 6, b: 18 };
    const pw = w - m.l - m.r, ph = h - m.t - m.b;
    // grid 10x8
    c.strokeStyle = rule; c.globalAlpha = 0.6; c.lineWidth = 1; c.beginPath();
    for (let i = 0; i <= 10; i++) { const x = Math.round(m.l + pw * i / 10) + 0.5; c.moveTo(x, m.t); c.lineTo(x, m.t + ph); }
    for (let j = 0; j <= 8; j++) { const y = Math.round(m.t + ph * j / 8) + 0.5; c.moveTo(m.l, y); c.lineTo(m.l + pw, y); }
    c.stroke(); c.globalAlpha = 1;
    c.strokeStyle = ink3; c.strokeRect(m.l + 0.5, m.t + 0.5, pw - 1, ph - 1);
    c.beginPath(); c.moveTo(m.l, m.t + ph / 2 + 0.5); c.lineTo(m.l + pw, m.t + ph / 2 + 0.5); c.stroke();

    let data = null;
    const s = mods().signal;
    if (s && s.getScopeData) { try { data = s.getScopeData(); } catch (e) { data = null; } }
    const lanes = [
      { arr: data && data.emf, scale: 1000, unit: 'mV', col: cssVar('--mech'), name: 'EMF', y0: m.t },
      { arr: data && data.out, scale: 1, unit: 'V', col: cssVar('--sig'), name: 'OUT', y0: m.t + ph / 2 },
    ];
    lanes.forEach((L) => {
      const lh = ph / 2, cy = L.y0 + lh / 2;
      let vdiv = 1;
      if (L.arr && L.arr.length) {
        let pk = 0;
        for (let i = 0; i < L.arr.length; i++) { const a = Math.abs(L.arr[i]); if (a > pk) pk = a; }
        vdiv = niceStep(Math.max(pk * L.scale, 1e-9) / 1.8);
        const pxPerUnit = (lh / 4) / vdiv;       // 4 divisions per lane
        c.strokeStyle = L.col; c.lineWidth = 1.4; c.beginPath();
        const n = L.arr.length;
        for (let i = 0; i < n; i++) {
          const x = m.l + pw * i / (n - 1);
          const y = clamp(cy - L.arr[i] * L.scale * pxPerUnit, L.y0 + 1, L.y0 + lh - 1);
          if (i) c.lineTo(x, y); else c.moveTo(x, y);
        }
        c.stroke();
      }
      label(c, L.name + '  ' + (L.arr ? fmtDiv(vdiv, L.unit) : 'no data'), m.l + 4, L.y0 + 11, L.col);
    });
    label(c, '4 ms/div', m.l + pw, h - 5, ink3, 'right');
    label(c, '40 ms window', m.l, h - 5, ink3, 'left');
  }

  /* ---------- spectrogram ---------- */
  const spec = { off: null, oc: null, w: 0, h: 0, lut: null, img: null };
  function buildLut() {
    // viridis-like anchors
    const A = [[68, 1, 84], [59, 82, 139], [33, 145, 140], [94, 201, 98], [253, 231, 37]];
    const lut = new Uint8ClampedArray(256 * 3);
    for (let i = 0; i < 256; i++) {
      const p = i / 255 * (A.length - 1), k = Math.min(A.length - 2, Math.floor(p)), u = p - k;
      for (let j = 0; j < 3; j++) lut[i * 3 + j] = A[k][j] + (A[k + 1][j] - A[k][j]) * u;
    }
    spec.lut = lut;
  }
  function drawSpec() {
    const cv = $('cv-spec');
    const f = fitCanvas(cv), c = f.c, w = f.w, h = f.h, dpr = f.dpr;
    const m = { l: 34, r: 6, t: 6, b: 18 };
    const pw = Math.max(4, Math.round((w - m.l - m.r) * dpr)), ph = Math.max(4, Math.round((h - m.t - m.b) * dpr));
    if (!spec.lut) buildLut();
    if (!spec.off || spec.w !== pw || spec.h !== ph) {
      spec.off = document.createElement('canvas'); spec.off.width = pw; spec.off.height = ph;
      spec.oc = spec.off.getContext('2d'); spec.w = pw; spec.h = ph;
      spec.oc.fillStyle = 'rgb(68,1,84)'; spec.oc.fillRect(0, 0, pw, ph);
      spec.img = spec.oc.createImageData(1, ph);
    }
    let col = null;
    const s = mods().signal;
    if (s && s.getSpectrumColumn && (state.running !== false) && !document.hidden) { try { col = s.getSpectrumColumn(); } catch (e) { col = null; } }
    if (col && col.length) {
      const cw = Math.max(1, Math.round(dpr));
      spec.oc.drawImage(spec.off, -cw, 0);
      const nb = Math.min(col.length - 1, Math.round(5000 / 24000 * (col.length - 1)) || 53);
      const d = spec.img.data;
      for (let y = 0; y < ph; y++) {
        const pos = (1 - y / (ph - 1)) * nb, i0 = Math.floor(pos), i1 = Math.min(nb, i0 + 1), u = pos - i0;
        const db = col[i0] + (col[i1] - col[i0]) * u;
        const idx = Math.round(clamp((db + 120) / 120, 0, 1) * 255);
        d[y * 4] = spec.lut[idx * 3]; d[y * 4 + 1] = spec.lut[idx * 3 + 1]; d[y * 4 + 2] = spec.lut[idx * 3 + 2]; d[y * 4 + 3] = 255;
      }
      for (let k = 0; k < cw; k++) spec.oc.putImageData(spec.img, spec.w - cw + k, 0);
    }
    const ink3 = cssVar('--ink-3'), ink2 = cssVar('--ink-2');
    c.fillStyle = cssVar('--sheet'); c.fillRect(0, 0, w, h);
    c.imageSmoothingEnabled = false;
    c.drawImage(spec.off, m.l, m.t, w - m.l - m.r, h - m.t - m.b);
    c.strokeStyle = ink3; c.lineWidth = 1; c.strokeRect(m.l + 0.5, m.t + 0.5, w - m.l - m.r - 1, h - m.t - m.b - 1);
    const ph2 = h - m.t - m.b;
    for (let k = 0; k <= 5; k++) {
      const y = m.t + ph2 * (1 - k / 5);
      c.beginPath(); c.moveTo(m.l - 3, Math.round(y) + 0.5); c.lineTo(m.l, Math.round(y) + 0.5); c.stroke();
      label(c, String(k), m.l - 6, y, ink2, 'right', k === 0 ? 'bottom' : k === 5 ? 'top' : 'middle');
    }
    label(c, 'kHz', 2, h - 5, ink3, 'left');
    label(c, 'time → (newest at right)', m.l + (w - m.l - m.r), h - 5, ink3, 'right');
    label(c, '−120 … 0 dB', m.l, h - 5, ink3, 'left');
  }

  /* ---------- Bode ---------- */
  function drawBode() {
    const cv = $('cv-bode');
    const f = fitCanvas(cv), c = f.c, w = f.w, h = f.h;
    if (!bodeDirty && !f.changed && !drawBode.theme.stale()) return;
    bodeDirty = false;
    const ink2 = cssVar('--ink-2'), ink3 = cssVar('--ink-3'), rule = cssVar('--rule'), sig = cssVar('--sig'), warn = cssVar('--warn');
    c.fillStyle = cssVar('--sheet'); c.fillRect(0, 0, w, h);
    const m = { l: 34, r: 8, t: 8, b: 20 };
    const pw = w - m.l - m.r, ph = h - m.t - m.b;
    const lf0 = 0, lf1 = Math.log10(24000), DB0 = -20, DB1 = 45;
    const X = (fr) => m.l + pw * (Math.log10(fr) - lf0) / (lf1 - lf0);
    const Yd = (db) => m.t + ph * (1 - (db - DB0) / (DB1 - DB0));
    // band 1-15 Hz
    c.fillStyle = warn; c.globalAlpha = 0.14; c.fillRect(X(1), m.t, X(15) - X(1), ph); c.globalAlpha = 1;
    // grid
    c.strokeStyle = rule; c.lineWidth = 1; c.beginPath();
    [1, 10, 100, 1000, 10000].forEach((fr) => { const x = Math.round(X(fr)) + 0.5; c.moveTo(x, m.t); c.lineTo(x, m.t + ph); });
    for (let db = -20; db <= 40; db += 20) { const y = Math.round(Yd(db)) + 0.5; c.moveTo(m.l, y); c.lineTo(m.l + pw, y); }
    c.stroke();
    c.strokeStyle = ink3; c.strokeRect(m.l + 0.5, m.t + 0.5, pw - 1, ph - 1);
    [['1', 1], ['10', 10], ['100', 100], ['1k', 1000], ['10k', 10000]].forEach((a) => label(c, a[0], X(a[1]), h - 8, ink2, 'center'));
    label(c, 'Hz', m.l + pw, h - 1, ink3, 'right');
    for (let db = -20; db <= 40; db += 20) label(c, String(db), m.l - 4, Yd(db), ink2, 'right', 'middle');
    label(c, 'dB', 2, m.t + 8, ink3, 'left');
    label(c, 'below corner', X(1) + 2, m.t + 20, warn, 'left');
    // curve
    c.strokeStyle = sig; c.lineWidth = 1.8; c.beginPath();
    let started = false;
    for (let i = 0; i <= 240; i++) {
      const fr = Math.pow(10, lf0 + (lf1 - lf0) * i / 240), d = resp(fr);
      if (!isFinite(d)) continue;
      const y = clamp(Yd(d), m.t, m.t + ph);
      if (started) c.lineTo(X(fr), y); else { c.moveTo(X(fr), y); started = true; }
    }
    c.stroke();
    if (!started) label(c, 'no analyticResponse', m.l + pw / 2, m.t + ph / 2, ink3, 'center');
    // domFreq marker
    const xf = X(clamp(state.domFreq, 1, 24000));
    c.save(); c.setLineDash([4, 3]); c.strokeStyle = ink2; c.beginPath(); c.moveTo(xf, m.t); c.lineTo(xf, m.t + ph); c.stroke(); c.restore();
    const right = xf > m.l + pw * 0.6;
    label(c, 'placeholder signal', xf + (right ? -4 : 4), m.t + 10, ink2, right ? 'right' : 'left');
    // -3 dB dot
    const cn = computeCorner();
    if (cn && started) {
      c.fillStyle = sig; c.strokeStyle = cssVar('--sheet'); c.lineWidth = 1.5; c.beginPath();
      c.arc(X(cn.f), clamp(Yd(cn.db), m.t, m.t + ph), 4, 0, Math.PI * 2); c.fill(); c.stroke();
      label(c, '−3 dB @ ' + (cn.f < 10 ? cn.f.toFixed(1) : Math.round(cn.f)) + ' Hz', X(cn.f) + 7, Yd(cn.db) + 16, sig, 'left');
    }
  }
  drawBode.theme = (function () {
    let last = '';
    return { stale: function () { const t = cssVar('--sheet') + cssVar('--sig'); const s = t !== last; last = t; return s; } };
  })();

  /* ---------- picking ---------- */
  function setupPicking() {
    if (!ctx3 || !ctx3.renderer || !window.THREE) return;
    const el = ctx3.renderer.domElement, ray = new THREE.Raycaster(), v2 = new THREE.Vector2();
    let down = null, lastHover = 0;
    function pick(ev) {
      const r = el.getBoundingClientRect();
      v2.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(v2, ctx3.camera);
      const objs = RIG.pickables.map((p) => p.object3d).filter(Boolean);
      if (!objs.length) return null;
      const hits = ray.intersectObjects(objs, true);
      // Glass, and the platform in X-ray mode, sit in front of what people want to inspect:
      // prefer the first solid hit and fall back to a see-through one.
      let seeThrough = null;
      for (let i = 0; i < hits.length; i++) {
        if (hits[i].object.isLine || hits[i].object.isPoints) continue; // edge outlines are decoration
        let o = hits[i].object, p = null;
        while (o && !p) { p = RIG.pickables.find((q) => q.object3d === o); o = o.parent; }
        if (!p) continue;
        const m = hits[i].object.material;
        if (m && m.transparent && m.opacity < 0.5) { seeThrough = seeThrough || p; continue; }
        return p;
      }
      return seeThrough;
    }
    el.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY }; });
    el.addEventListener('pointerup', (e) => {
      if (!down) return;
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y); down = null;
      if (moved >= 5) return;
      const p = pick(e);
      if (p) showInspector(p.title, p.body); else hideInspector();
    });
    el.addEventListener('pointermove', (e) => {
      const now = performance.now();
      if (now - lastHover < 50 || e.buttons) return;
      lastHover = now;
      el.style.cursor = pick(e) ? 'pointer' : '';
    });
    $('inspector-close').addEventListener('click', hideInspector);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hideInspector(); });
  }
  function showInspector(title, body) {
    $('inspector-title').textContent = title || '';
    $('inspector-body').textContent = body || '';
    $('inspector').classList.add('on');
    RIG.bus.emit('select', { title: title, body: body });
  }
  function hideInspector() {
    if (!$('inspector').classList.contains('on')) return;
    $('inspector').classList.remove('on');
    RIG.bus.emit('select', null);
  }

  /* ---------- main loop ---------- */
  function loop() {
    let last = performance.now(), t = 0, readoutT = 0;
    function frame(now) {
      requestAnimationFrame(frame);
      const dt = Math.min(0.1, Math.max(0, (now - last) / 1000)); last = now; t += dt;
      const M = mods();
      if (!document.hidden) {
        try { if (M.signal && M.signal.tick && state.running !== false) M.signal.tick(dt); } catch (e) { fail('signal.tick', e); }
      }
      try { if (M.scene && M.scene.update && ctx3) M.scene.update(dt, t); } catch (e) { fail('scene.update', e); }
      try { if (M.electronics && M.electronics.update && ctx3) M.electronics.update(dt, t, lastLevels); } catch (e) { fail('electronics.update', e); }
      if (document.hidden) return;
      readoutT += dt;
      if (readoutT > 0.1) { readoutT = 0; try { paintReadouts(); } catch (e) { fail('readouts', e); } }
      try { drawScope(); drawSpec(); drawBode(); } catch (e) { fail('instruments', e); }
    }
    requestAnimationFrame(frame);
  }
  const failed = {};
  function fail(where, e) { if (!failed[where]) { failed[where] = 1; console.warn('[ui] ' + where + ' threw:', e); } }

  /* ---------- init ---------- */
  let inited = false;
  function init() {
    if (inited) return; inited = true;
    RIG.bus.on('levels', (L) => { lastLevels = L; });
    setupScene();
    setupNotice();
    setupControls();
    setupPicking();
    loop();
  }

  RIG.modules.ui = { init: init };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
