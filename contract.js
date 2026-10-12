// Shared integration contract for the rig3d app. OWNED BY THE ORCHESTRATOR — builders must not edit.
// Units: 1 world unit = 1 cm. +Y is up. Table top surface is y = 0.
(function (root) {
  const DIM = {
    table: { w: 90, d: 60, top: 0, thick: 3, height: 75 },          // x∈[-45,45], z∈[-30,30], legs down to y=-75
    feet: { r: 2.0, h: 3.0, inset: 3.0 },                           // 4 isolation pucks, one per platform corner
    platform: { w: 40, d: 40, thick: 1.2 },                         // MDF, centred at x=0,z=0
    substrate: { w: 30, d: 30, thick: 0.05 },                       // manila paper, centred
    arena: { r: 9, h: 10, wall: 0.3 },                              // glass cylinder, 18 cm diameter
    divider: { w: 18, h: 20, thick: 0.4 },                          // glass panel in the plane x = 0, spans z∈[-9,9]
    piezo: { brassR: 1.35, ceramicR: 0.95, brassT: 0.02, ceramicT: 0.025, housingR: 1.7, housingT: 0.5 },
    pcb: { w: 7, d: 5, thick: 0.16 },
    enclosure: { w: 11, d: 7, h: 2.4 },
  };
  const Y = {};
  Y.platformBottom = DIM.table.top + DIM.feet.h;                  // 3.0
  Y.platformTop = Y.platformBottom + DIM.platform.thick;          // 4.2
  Y.substrate = Y.platformTop + DIM.substrate.thick;              // 4.25  (spiders stand here)

  const POS = {
    male: { x: -4.5, y: Y.substrate, z: 0 },      // signaller side
    female: { x: 4.5, y: Y.substrate, z: 0 },     // receiver side
    // Piezo is epoxied to the UNDERSIDE of the platform, directly below the male's half.
    piezo: { x: -4.5, y: Y.platformBottom, z: 0 },
    // Preamp enclosure hangs under the platform (open side facing down), lead to piezo < 15 cm.
    enclosure: { x: -11, y: Y.platformBottom, z: 9 },
    // Output jack J1 on the enclosure's -x face; line-level cable runs to the recorder on the table.
    recorder: { x: -34, y: DIM.table.top, z: 18 },
    redLamp: { x: 20, y: 38, z: -18 },
    camera: { x: 0, y: 55, z: 0 },               // overhead video camera on a tripod that stands on the FLOOR side, not the platform
  };

  // Electrical constants — must match rig_build_spec.md §2a / piezo_preamp_test.sim1.
  const CIRCUIT = {
    Cp: 15e-9, R1: 1e6, R2: 100e3, R3: 100e3, R4: 1e3, RV1max: 100e3, R6: 100, Rload: 10e3,
    C1: 10e-6, C2: 22e-6, C3: 4.7e-6, Vsupply: 9, Vbias: 4.5,
    tl072Swing: [1.5, 7.5],    // realistic TL072 output limits on a 9 V single supply
    diodeVf: 0.6,              // clamp, relative to Vbias
    piezoResonanceHz: 4600, piezoQ: 8,
    sampleRate: 48000,
  };

  const DEFAULTS = {
    running: true, signalType: 'mixed', domFreq: 300, boutRate: 8, R1: 1e6, gain: 0.5,
    Cp: 15e-9, isolation: true, mains: 'battery', ambient: 0.3,
  };

  // Minimal event bus. Topics and payloads are fixed below; do not invent new ones without the orchestrator.
  function Bus() { this.h = {}; }
  Bus.prototype.on = function (t, f) { (this.h[t] = this.h[t] || []).push(f); };
  Bus.prototype.emit = function (t, p) { (this.h[t] || []).forEach((f) => f(p)); };

  root.RIG = {
    DIM, Y, POS, CIRCUIT, DEFAULTS,
    bus: new Bus(),
    pickables: [],     // [{ object3d, title, body }] — scene/electronics push; ui raycasts these
    modules: {},       // scene.js -> RIG.modules.scene, electronics.js -> .electronics, signal.js -> .signal, ui.js -> .ui
  };
})(typeof window !== "undefined" ? window : globalThis);

/* BUS TOPICS (exhaustive)
 *  'pulse'     {t, kind:'percussion'|'stridulation'|'knock', amp:0..1, x, z}
 *              signal.js emits for every vibratory event it synthesises; x,z = world source position.
 *  'levels'    {piezoV, nodeAV, outV, dbfs, clipping:bool, clamped:bool}  signal.js, ~60 Hz, latest-frame peaks
 *  'params'    {key, value}   ui.js emits when a control changes; signal.js and scene.js listen
 *  'view'      {preset:'overview'|'arena'|'underside'|'board'|'chain', xray:bool}  ui.js emits
 *  'select'    {title, body} | null   ui.js emits on pick
 *
 * PARAM KEYS (ui -> everyone): 'running' bool, 'signalType' 'percussion'|'stridulation'|'mixed',
 *  'domFreq' Hz (40..2000), 'boutRate' bouts/min (1..30), 'R1' ohms (1e4|1e5|1e6|1e7), 'gain' 0..1 (RV1 fraction),
 *  'Cp' farads, 'isolation' bool, 'mains' 'battery'|'adapter', 'ambient' 0..1, 'knock' (momentary, value=true)
 *
 * MODULE API (each file assigns to RIG.modules.<name>):
 *  scene:       init(containerEl) -> {scene, camera, renderer, controls}; update(dt, t); setView(preset); setXray(bool)
 *  electronics: build(scene) -> void (adds all electronics meshes, pushes pickables); update(dt, t, levels)
 *  signal:      tick(dt) — called once per animation frame by ui.js; synthesises round(min(dt,0.1)*rate) samples,
 *               emits 'pulse' / 'levels'. setParam(k,v); getScopeData() -> {emf:Float32Array, out:Float32Array, rate}  (last ~40 ms)
 *               getSpectrumColumn() -> Float32Array(256) magnitudes in dB, 0..rate/2 linear bins, of preamp OUT
 *               analyticResponse(f) -> dB gain of the preamp chain at frequency f for current params (for the Bode plot)
 *  ui:          init() — builds the control panel, scope, spectrogram, Bode plot, tooltips; owns the main loop.
 */
