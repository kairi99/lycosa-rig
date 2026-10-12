// Perfboard layout for the preamp (rig_build_spec.md §2a). Loaded before electronics.js.
// Holes are addressed [i, j] on a 0.1" (0.254 cm) grid: i = 0..27 runs along board +x, j = 0..19 along +z.
// Viewed from above with the jack on the left: signal enters at the right edge and leaves at the left.
(function (root) {
  const RIG = root.RIG;
  const pitch = 0.254;
  const hole = (i, j) => ({ x: -3.38 + i * pitch, z: -2.38 + j * pitch });

  // Pin keys: resistors a/b (a = first colour band), diodes A/K, electrolytics +/-, ceramic/film 1/2,
  // trimpot A/W/B (W = wiper), U1 1..8 (TL072: 1 OUT A, 2 IN-A, 3 IN+A, 4 V-, 5 IN+B, 6 IN-B, 7 OUT B, 8 V+).
  const parts = [
    { ref: 'U1', type: 'dip8', pins: { 1: [12, 11], 2: [13, 11], 3: [14, 11], 4: [15, 11], 5: [15, 8], 6: [14, 8], 7: [13, 8], 8: [12, 8] } },
    { ref: 'R1', type: 'resistor', value: '1 MΩ', bands: ['brown', 'black', 'green', 'gold'], pins: { a: [17, 12], b: [17, 8] } },
    { ref: 'D1', type: 'diode', pins: { A: [19, 12], K: [19, 8] } },
    { ref: 'D2', type: 'diode', pins: { A: [21, 8], K: [21, 12] } },
    { ref: 'R2', type: 'resistor', value: '100 kΩ', bands: ['brown', 'black', 'yellow', 'gold'], pins: { a: [19, 6], b: [19, 2] } },
    { ref: 'R3', type: 'resistor', value: '100 kΩ', bands: ['brown', 'black', 'yellow', 'gold'], pins: { a: [17, 5], b: [17, 1] } },
    { ref: 'C1', type: 'electrolytic', value: '10 µF', r: 0.25, h: 1.1, color: 0x1a3a8c, pins: { '+': [15, 4], '-': [15, 3] } },
    { ref: 'C5', type: 'electrolytic', value: '10 µF', r: 0.25, h: 1.1, color: 0x1a3a8c, pins: { '+': [9, 6], '-': [9, 5] } },
    { ref: 'C4', type: 'ceramic', value: '100 nF', pins: { 1: [11, 6], 2: [11, 4] } },
    { ref: 'R4', type: 'resistor', value: '1 kΩ', bands: ['brown', 'black', 'red', 'gold'], pins: { a: [13, 14], b: [9, 14] } },
    { ref: 'C2', type: 'electrolytic', value: '22 µF', r: 0.3, h: 1.1, color: 0x1b1b1d, pins: { '+': [9, 16], '-': [9, 17] } },
    { ref: 'RV1', type: 'trimpot', value: '100 kΩ', pins: { B: [4, 10], W: [5, 10], A: [6, 10] } },
    { ref: 'C3', type: 'film', value: '4.7 µF', pins: { 1: [6, 16], 2: [2, 16] } },
    { ref: 'R6', type: 'resistor', value: '100 Ω', bands: ['brown', 'black', 'brown', 'gold'], pins: { a: [2, 13], b: [2, 9] } },
  ];

  // Off-board connection points (holes where flying leads are soldered).
  const pads = { PZH: [27, 12], PZG: [26, 1], VIN: [26, 6], BATN: [26, 18], OUT: [2, 9], SLV: [1, 10] };

  // layer 0 = bare tinned bus wire lying flat on the board; 1 and 2 = insulated jumpers at increasing
  // height, so a higher layer can cross a lower one without touching. Wires join only at listed vertices.
  const wires = [
    // supply buses
    { net: 'VP', layer: 0, path: [[9, 6], [11, 6], [12, 6], [19, 6], [26, 6]] },
    { net: 'GND', layer: 0, path: [[26, 1], [17, 1], [15, 1], [11, 1], [9, 1], [1, 1], [1, 10], [1, 18], [9, 18], [15, 18], [26, 18]] },
    // supply decoupling and divider
    { net: 'VP', layer: 1, path: [[12, 8], [12, 6]] },
    { net: 'GND', layer: 1, path: [[11, 4], [11, 1]] },
    { net: 'GND', layer: 1, path: [[9, 5], [9, 1]] },
    { net: 'GND', layer: 1, path: [[15, 3], [15, 1]] },
    { net: 'DIV', layer: 1, path: [[19, 2], [18, 2], [18, 5], [17, 5]] },
    { net: 'DIV', layer: 1, path: [[15, 4], [15, 5], [17, 5]] },
    { net: 'DIV', layer: 1, path: [[15, 5], [15, 8]] },
    // U1B follower and V/2 rail out to the clamp
    { net: 'VB', layer: 1, path: [[13, 8], [14, 8]] },
    { net: 'VB', layer: 2, path: [[14, 8], [14, 7], [17, 7], [17, 8]] },
    { net: 'VB', layer: 1, path: [[17, 8], [19, 8], [21, 8]] },
    // input node A
    { net: 'IN', layer: 1, path: [[17, 12], [19, 12], [21, 12], [27, 12]] },
    { net: 'IN', layer: 2, path: [[17, 12], [14, 12], [14, 11]] },
    { net: 'GND', layer: 1, path: [[15, 11], [15, 18]] },
    // gain network
    { net: 'FB', layer: 1, path: [[13, 11], [13, 13], [13, 14]] },
    { net: 'FB', layer: 1, path: [[6, 10], [7, 10], [7, 13], [13, 13]] },
    { net: 'X', layer: 1, path: [[9, 14], [9, 16]] },
    { net: 'GND', layer: 1, path: [[9, 17], [9, 18]] },
    { net: 'OA', layer: 1, path: [[4, 10], [5, 10]] },
    { net: 'OA', layer: 2, path: [[12, 11], [12, 12], [6, 12], [4, 12], [4, 11], [4, 10]] },
    { net: 'OA', layer: 2, path: [[6, 12], [6, 16]] },
    // output
    { net: 'C3O', layer: 1, path: [[2, 13], [2, 16]] },
  ];

  // Flying leads leaving the board. 'to' names a terminal modelled in electronics.js.
  const offboard = [
    { net: 'IN', pad: 'PZH', to: 'PZ1.hot', color: 0xd02020 },
    { net: 'GND', pad: 'PZG', to: 'PZ1.shield', color: 0x151515 },
    { net: 'VP', pad: 'VIN', to: 'SW1.2', color: 0xd02020 },
    { net: 'GND', pad: 'BATN', to: 'BT1.-', color: 0x151515 },
    { net: 'OUT', pad: 'OUT', to: 'J1.tip', color: 0xe8e8e8 },
    { net: 'GND', pad: 'SLV', to: 'J1.sleeve', color: 0x151515 },
  ];
  // Off-board terminal-to-terminal wiring (battery -> switch).
  const terminals = [{ net: 'VBAT', a: 'BT1.+', b: 'SW1.1', color: 0xd02020 }];

  const netInfo = {
    IN: ['Node A · input', 'Piezo hot lead, R1, the D1/D2 clamp and U1 pin 3 (IN+A). This is the 1 MΩ node: keep it short.'],
    VB: ['V/2 bias rail', 'U1B output (pin 7) tied to pin 6 as a follower; feeds R1 and the clamp diodes, never ground.'],
    DIV: ['Divider node', 'R2/R3 midpoint, smoothed by C1, into U1 pin 5 (IN+B).'],
    VP: ['+9 V supply', 'From the battery through SW1 to U1 pin 8, R2, C4 and C5.'],
    GND: ['0 V / ground', 'Battery −, U1 pin 4, R3, C1, C2, C4, C5, the piezo shield and the jack sleeve. Bare bus wire around the board edge.'],
    FB: ['Feedback · IN−A', 'U1 pin 2, R4 and one end of RV1. Gain = 1 + RV1/R4.'],
    X: ['R4–C2 junction', 'C2 blocks DC in the gain leg so the stage is unity-gain at DC.'],
    OA: ['U1A output', 'U1 pin 1, RV1 wiper and far end (tied), and C3.'],
    C3O: ['C3–R6 junction', 'After the output DC block.'],
    OUT: ['Line out', 'R6 to the jack tip.'],
  };

  RIG.BOARD = { pitch, hole, parts, pads, wires, offboard, terminals, netInfo };
})(typeof window !== 'undefined' ? window : globalThis);
