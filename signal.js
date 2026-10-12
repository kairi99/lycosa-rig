// signal.js -- time-domain synthesis of the substrate-vibration -> piezo -> preamp -> recorder chain.
// Classic script; also loadable under Node (uses globalThis.RIG).
(function () {
  const root = typeof window !== 'undefined' ? window : globalThis;
  const RIG = root.RIG;
  const C = RIG.CIRCUIT;
  const FS = C.sampleRate;
  const TWO_PI = Math.PI * 2;

  const DISCLAIMER = 'The spider vibratory signals synthesised here are illustrative placeholders loosely modelled on lycosid percussion/stridulation (e.g. Schizocosa); the real Lycosa erythrognatha signal has never been recorded, whereas the electronics are modelled faithfully.';

  // Recorder assumption: line input full scale = 1.0 V peak (0 dBFS).
  const FULL_SCALE_V = 1.0;
  const CAP = 65536, MASK = CAP - 1;
  const SCOPE_N = 1920, SPEC_N = 512;

  // ---------- parameters ----------
  const P = Object.assign({}, RIG.DEFAULTS);
  let running = true;

  // ---------- filters ----------
  // TPT one-pole high-pass (stable under live coefficient changes).
  function Hpf() { this.s = 0; this.G = 0; }
  Hpf.prototype.setFc = function (fc) { const g = Math.tan(Math.PI * Math.min(fc, FS * 0.45) / FS); this.G = g / (1 + g); };
  Hpf.prototype.proc = function (x) { const v = (x - this.s) * this.G; const lp = v + this.s; this.s = lp + v; return x - lp; };

  const hpIn = new Hpf(), hpGain = new Hpf(), hpOut = new Hpf();
  let K = 0, outScale = 1;
  function updateCircuit() {
    hpIn.setFc(1 / (TWO_PI * P.R1 * P.Cp));
    hpGain.setFc(1 / (TWO_PI * C.R4 * C.C2));
    hpOut.setFc(1 / (TWO_PI * (C.R6 + C.Rload) * C.C3));
    K = (P.gain * C.RV1max) / C.R4;
    outScale = C.Rload / (C.R6 + C.Rload);
  }

  // RBJ biquad (direct form I)
  function Biquad() { this.b0 = 0; this.b1 = 0; this.b2 = 0; this.a1 = 0; this.a2 = 0; this.x1 = 0; this.x2 = 0; this.y1 = 0; this.y2 = 0; }
  Biquad.prototype.proc = function (x) {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1; this.x1 = x; this.y2 = this.y1; this.y1 = y; return y;
  };
  function makeBandpass(bq, f0, Q) { // constant 0 dB peak gain
    const w = TWO_PI * f0 / FS, al = Math.sin(w) / (2 * Q), a0 = 1 + al;
    bq.b0 = al / a0; bq.b1 = 0; bq.b2 = -al / a0; bq.a1 = -2 * Math.cos(w) / a0; bq.a2 = (1 - al) / a0;
  }
  function makeLowpass(bq, f0, Q) {
    const w = TWO_PI * f0 / FS, al = Math.sin(w) / (2 * Q), cw = Math.cos(w), a0 = 1 + al;
    bq.b0 = (1 - cw) / 2 / a0; bq.b1 = (1 - cw) / a0; bq.b2 = bq.b0; bq.a1 = -2 * cw / a0; bq.a2 = (1 - al) / a0;
  }
  const piezoBp = new Biquad(); makeBandpass(piezoBp, C.piezoResonanceHz, C.piezoQ);
  const isoLp = new Biquad(); makeLowpass(isoLp, 12, 0.7);

  // ---------- synthesis state ----------
  let sampleIdx = 0;
  let testSineF = 0, testSineA = 0, testPhase = 0, eventsOff = false;
  const voices = [];
  let pending = [], qh = 0;
  let nextBout = Math.round(FS * (0.3 + Math.random()));
  let nextStep = Math.round(FS * 0.5);
  let humPh = [0, 0, 0], humMix = 0.01, isoMix = 1;
  let pink0 = 0, pink1 = 0, pink2 = 0;
  let stepVoices = []; // footstep thumps (separate from spider voices)
  let flags = { clipping: false, clamped: false };

  const rnd = (a, b) => a + (b - a) * Math.random();
  const jit = () => rnd(0.8, 1.2);
  const expo = () => -Math.log(1 - Math.random());
  const male = RIG.POS.male;

  function osc(f, tau, a) {
    const w = TWO_PI * f / FS, r = Math.exp(-1 / (tau * FS));
    return { k: 0, re: 1, im: 0, cr: r * Math.cos(w), ci: r * Math.sin(w), a: a, n: Math.ceil(7 * tau * FS) };
  }
  function noiseBurst(tc, a) {
    return { k: 1, re: 1, im: 0, cr: Math.exp(-1 / (tc * FS)), ci: 0, a: a, n: Math.ceil(7 * tc * FS) };
  }
  function stepVoice(f, tau, a) { const v = osc(f, tau, a); return v; }

  function fire(e) {
    if (e.emit) {
      RIG.bus.emit('pulse', { t: sampleIdx / FS, kind: e.emit, amp: e.pAmp, x: e.x, z: e.z });
    }
    if (e.v > 0) voices.push(osc(e.f, e.tau, e.v));
    if (e.click > 0) voices.push(noiseBurst(e.ctc, e.click));
  }

  const PERC_V = 0.010, PERC_CLICK = 0.005, STRID_V = 0.004, KNOCK_V = 22;
  function percTau() { return Math.min(0.015, Math.max(0.005, 4 / P.domFreq)); }

  function addStrike(at) {
    const j = jit();
    pending.push({ at: at, emit: 'percussion', pAmp: j / 1.2, x: male.x + rnd(-1, 1), z: male.z + rnd(-1, 1),
      f: P.domFreq, tau: percTau(), v: PERC_V * j, click: PERC_CLICK * jit(), ctc: 0.0005 });
  }
  function addScrape(at) {
    const rate = rnd(150, 250), dur = 0.25, nC = Math.floor(rate * dur), j = jit();
    const x = male.x + rnd(-1, 1), z = male.z + rnd(-1, 1), fm = P.domFreq * rnd(1.5, 3);
    for (let i = 0; i < nC; i++) {
      pending.push({ at: at + Math.round(i / rate * FS), emit: i === 0 ? 'stridulation' : null, pAmp: j / 1.2, x: x, z: z,
        f: fm * rnd(0.95, 1.05), tau: 0.0004, v: STRID_V * j * jit(), click: 0, ctc: 0 });
    }
  }
  function makeBout(t0) {
    const type = P.signalType;
    let t = t0;
    const doPerc = (n, rate) => { for (let i = 0; i < n; i++) { addStrike(t); t += Math.round(FS / rate); } };
    const doStrid = (n) => { for (let i = 0; i < n; i++) { addScrape(t); t += Math.round(FS * (0.25 + 0.12)); } };
    if (type === 'percussion') doPerc(8 + Math.floor(Math.random() * 8), rnd(6, 10));
    else if (type === 'stridulation') doStrid(3 + Math.floor(Math.random() * 4));
    else {
      const pieces = 4 + Math.floor(Math.random() * 3);
      for (let p = 0; p < pieces; p++) {
        if (p % 2 === 0) doPerc(3 + Math.floor(Math.random() * 3), rnd(6, 10)); else doStrid(1);
        t += Math.round(FS * 0.1);
      }
    }
    pending.splice(0, qh); qh = 0;
    pending.sort((a, b) => a.at - b.at);
  }
  function doKnock() {
    const cx = Math.random() < 0.5 ? -18 : 18, cz = Math.random() < 0.5 ? -18 : 18;
    const e = { at: sampleIdx, emit: 'knock', pAmp: 1, x: cx, z: cz, f: rnd(25, 40), tau: 0.08, v: KNOCK_V * rnd(0.8, 1.2), click: 6, ctc: 0.003 };
    fire(e);
  }

  // ---------- ring buffers & outputs ----------
  const emfBuf = new Float32Array(CAP), outBuf = new Float32Array(CAP);
  let wp = 0;
  const scopeEmf = new Float32Array(SCOPE_N), scopeOut = new Float32Array(SCOPE_N);
  const scopeObj = { emf: scopeEmf, out: scopeOut, rate: FS };

  function ambientSample() {
    // pink-ish rumble (3 leaky integrators of white noise)
    const w = Math.random() * 2 - 1;
    pink0 = 0.997 * pink0 + w * 0.0030;
    pink1 = 0.985 * pink1 + w * 0.0100;
    pink2 = 0.900 * pink2 + w * 0.0300;
    let tab = (pink0 + pink1 + pink2) * 0.25;
    // footsteps 1-3 per second
    if (sampleIdx >= nextStep) {
      stepVoices.push(stepVoice(rnd(5, 40), 0.06, rnd(0.5, 1) * 0.1 * (Math.random() < 0.5 ? -1 : 1)));
      nextStep = sampleIdx + Math.round(FS * (0.33 + 0.67 * expo() * 0.75 + 0.2));
      if (nextStep - sampleIdx > FS * 1) nextStep = sampleIdx + FS;
    }
    for (let i = stepVoices.length - 1; i >= 0; i--) {
      const v = stepVoices[i], nre = v.re * v.cr - v.im * v.ci, nim = v.re * v.ci + v.im * v.cr;
      v.re = nre; v.im = nim; tab += v.a * nim;
      if (--v.n <= 0) { stepVoices[i] = stepVoices[stepVoices.length - 1]; stepVoices.pop(); }
    }
    return tab;
  }

  function synth(n, st) {
    const tx = isoMixTarget(), hm = P.mains === 'adapter' ? 1 : 0.01;
    const hw = [TWO_PI * 60 / FS, TWO_PI * 180 / FS, TWO_PI * 300 / FS];
    const floorA = 5e-6 * Math.sqrt(3);
    for (let i = 0; i < n; i++) {
      let s = 0, amb = 0, noise = 0, hum = 0;
      if (testSineF > 0) {
        testPhase += TWO_PI * testSineF / FS; if (testPhase > TWO_PI) testPhase -= TWO_PI;
        s = testSineA * Math.sin(testPhase);
      } else {
        if (!eventsOff) {
          if (sampleIdx >= nextBout) { makeBout(sampleIdx); nextBout = sampleIdx + Math.round(expo() * 60 / P.boutRate * FS); }
          while (qh < pending.length && pending[qh].at <= sampleIdx) fire(pending[qh++]);
          if (qh > 4096 && qh === pending.length) { pending.length = 0; qh = 0; }
        }
        for (let j = voices.length - 1; j >= 0; j--) {
          const v = voices[j];
          if (v.k === 0) {
            const nre = v.re * v.cr - v.im * v.ci, nim = v.re * v.ci + v.im * v.cr;
            v.re = nre; v.im = nim; s += v.a * nim;
          } else {
            v.re *= v.cr; s += v.a * v.re * (Math.random() * 2 - 1);
          }
          if (--v.n <= 0) { voices[j] = voices[voices.length - 1]; voices.pop(); }
        }
        s += piezoBp.proc(s); // piezo disc mechanical resonance (illustrative boost, 0 dB-peak band-pass added)
        // ambient table noise
        if (P.ambient > 0) {
          const tab = ambientSample();
          const f = isoLp.proc(tab);
          isoMix += (tx - isoMix) * 0.0004;
          amb = P.ambient * (tab * (1 - isoMix) + f * 0.15 * isoMix);
        }
        humMix += (hm - humMix) * 0.0005;
        hum = humMix * (0.0018 * Math.sin(humPh[0]) + 0.0008 * Math.sin(humPh[1]) + 0.0004 * Math.sin(humPh[2]));
        humPh[0] += hw[0]; humPh[1] += hw[1]; humPh[2] += hw[2];
        if (humPh[0] > TWO_PI) humPh[0] -= TWO_PI;
        if (humPh[1] > TWO_PI) humPh[1] -= TWO_PI;
        if (humPh[2] > TWO_PI) humPh[2] -= TWO_PI;
        noise = (Math.random() * 2 - 1) * floorA;
      }
      const emf = s + amb;
      // input network: node A (relative to V/2)
      let A = hpIn.proc(emf) + hum + noise;
      // clamp D1/D2: +-0.6 V around bias, soft knee above 0.45 V
      const aa = A < 0 ? -A : A;
      if (aa > 0.45) { A = (A < 0 ? -1 : 1) * (0.45 + (C.diodeVf - 0.45) * Math.tanh((aa - 0.45) / (C.diodeVf - 0.45))); st.clamped = true; }
      // gain stage: y = x + (RV/R4) * hpf(x)
      let y = A + K * hpGain.proc(A);
      const lo = C.tl072Swing[0] - C.Vbias, hi = C.tl072Swing[1] - C.Vbias;
      if (y > hi) { y = hi; st.clipping = true; } else if (y < lo) { y = lo; st.clipping = true; }
      const out = hpOut.proc(y) * outScale;
      const ia = emf < 0 ? -emf : emf, ib = A < 0 ? -A : A, ic = out < 0 ? -out : out;
      if (ia > st.pe) { st.pe = ia; st.se = emf; }
      if (ib > st.pa) { st.pa = ib; st.sa = A; }
      if (ic > st.po) { st.po = ic; st.so = out; }
      emfBuf[wp] = emf; outBuf[wp] = out; wp = (wp + 1) & MASK;
      sampleIdx++;
    }
  }
  function isoMixTarget() { return P.isolation ? 1 : 0; }

  const stat = { pe: 0, se: 0, pa: 0, sa: 0, po: 0, so: 0, clipping: false, clamped: false };
  function tick(dt) {
    if (!running) return;
    const n = Math.round(Math.min(dt, 0.1) * FS);
    stat.pe = stat.pa = stat.po = 0; stat.se = stat.sa = stat.so = 0; stat.clipping = false; stat.clamped = false;
    synth(n, stat);
    RIG.bus.emit('levels', {
      piezoV: stat.se, nodeAV: stat.sa, outV: stat.so,
      dbfs: 20 * Math.log10(Math.max(stat.po / FULL_SCALE_V, 1e-6)),
      clipping: stat.clipping, clamped: stat.clamped,
    });
  }

  function setParam(k, v) {
    switch (k) {
      case 'running': running = !!v; P.running = running; break;
      case 'knock': if (v) doKnock(); break;
      case 'boutRate': P.boutRate = v; nextBout = Math.min(nextBout, sampleIdx + Math.round(expo() * 60 / v * FS)); break;
      case 'R1': case 'Cp': case 'gain': P[k] = v; updateCircuit(); break;
      case 'signalType': case 'domFreq': case 'isolation': case 'mains': case 'ambient': P[k] = v; break;
      default: break;
    }
  }

  function getScopeData() {
    let r = (wp - SCOPE_N) & MASK;
    for (let i = 0; i < SCOPE_N; i++) { scopeEmf[i] = emfBuf[r]; scopeOut[i] = outBuf[r]; r = (r + 1) & MASK; }
    return scopeObj;
  }

  // ---------- spectrum ----------
  const specRe = new Float32Array(SPEC_N), specIm = new Float32Array(SPEC_N), specOut = new Float32Array(SPEC_N / 2);
  const hann = new Float32Array(SPEC_N), cosT = new Float32Array(SPEC_N / 2), sinT = new Float32Array(SPEC_N / 2), rev = new Uint16Array(SPEC_N);
  (function () {
    const bits = Math.log2(SPEC_N);
    for (let i = 0; i < SPEC_N; i++) {
      hann[i] = 0.5 - 0.5 * Math.cos(TWO_PI * i / SPEC_N);
      let r = 0; for (let b = 0; b < bits; b++) if (i & (1 << b)) r |= 1 << (bits - 1 - b);
      rev[i] = r;
    }
    for (let i = 0; i < SPEC_N / 2; i++) { cosT[i] = Math.cos(TWO_PI * i / SPEC_N); sinT[i] = -Math.sin(TWO_PI * i / SPEC_N); }
  })();
  function getSpectrumColumn() {
    let r = (wp - SPEC_N) & MASK;
    for (let i = 0; i < SPEC_N; i++) { specRe[rev[i]] = outBuf[r] * hann[i]; specIm[rev[i]] = 0; r = (r + 1) & MASK; }
    for (let size = 2; size <= SPEC_N; size <<= 1) {
      const half = size >> 1, step = SPEC_N / size;
      for (let s = 0; s < SPEC_N; s += size) {
        for (let k = 0, t = 0; k < half; k++, t += step) {
          const a = s + k, b = a + half;
          const tr = specRe[b] * cosT[t] - specIm[b] * sinT[t], ti = specRe[b] * sinT[t] + specIm[b] * cosT[t];
          specRe[b] = specRe[a] - tr; specIm[b] = specIm[a] - ti; specRe[a] += tr; specIm[a] += ti;
        }
      }
    }
    const norm = 4 / SPEC_N; // sine of peak A -> A (Hann coherent gain 0.5)
    for (let i = 0; i < SPEC_N / 2; i++) {
      const m = Math.sqrt(specRe[i] * specRe[i] + specIm[i] * specIm[i]) * norm;
      specOut[i] = 20 * Math.log10(Math.max(m, 1e-7));
    }
    return specOut;
  }

  // ---------- analytic response ----------
  function analyticResponse(f) {
    const w = TWO_PI * Math.max(f, 1e-6);
    const hp = (tau) => { const x = w * tau, d = 1 + x * x; return [x * x / d, x / d]; }; // jx/(1+jx)
    const h1 = hp(P.R1 * P.Cp), h2 = hp(C.R4 * C.C2), h3 = hp((C.R6 + C.Rload) * C.C3);
    const gK = (P.gain * C.RV1max) / C.R4;
    const gr = 1 + gK * h2[0], gi = gK * h2[1];
    const m1 = Math.hypot(h1[0], h1[1]), m2 = Math.hypot(gr, gi), m3 = Math.hypot(h3[0], h3[1]);
    return 20 * Math.log10(Math.max(m1 * m2 * m3 * C.Rload / (C.R6 + C.Rload), 1e-12));
  }

  // ---------- init ----------
  updateCircuit();
  Object.keys(RIG.DEFAULTS).forEach((k) => setParam(k, RIG.DEFAULTS[k]));
  isoMix = P.isolation ? 1 : 0;
  RIG.bus.on('params', (m) => setParam(m.key, m.value));

  RIG.modules.signal = {
    tick, setParam, getScopeData, getSpectrumColumn, analyticResponse, DISCLAIMER,
    // test hooks
    _testSine: function (f, a) { testSineF = f; testSineA = a; testPhase = 0; },
    _eventsOff: function (b) { eventsOff = !!b; if (b) { voices.length = 0; pending.length = 0; qh = 0; } },
  };
})();
