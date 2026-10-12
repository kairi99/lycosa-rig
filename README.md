# Lycosa Vibration Rig

Interactive 3D model and live signal-chain simulation of a contact-microphone rig for recording
substrate-borne courtship vibrations of the wolf spider *Lycosa erythrognatha* (Quito, Ecuador).

**Open it:** https://kairi99.github.io/lycosa-rig/

## What it shows

- The bench, isolation feet, platform, manila-paper substrate, and an 18 cm split-glass-panel arena
  with a male and a female spider.
- A 27 mm piezoelectric disc glued under the platform, below the male's half.
- A TL072 preamp in a clear enclosure hanging under the platform, clear of the table, with a slack
  cable to a portable recorder.
- A live simulation: oscilloscope, spectrogram and preamp frequency response, with controls for
  R1, gain, disc capacitance, isolation, mains hum, ambient noise, and a bench knock.

Drag to orbit, scroll to zoom, and click any part to read what it does.

## Honesty note

*L. erythrognatha*'s vibratory signal has never been recorded, so the spider waveforms here are
illustrative placeholders loosely modelled on other lycosids. The electronics are modelled from the
real circuit: midband gain ≈ 51× (RV1 centred) and a −3 dB low corner near 15 Hz.

## Files

| File | Contents |
|---|---|
| `index.html` | Page layout, styles, script loading |
| `contract.js` | Shared dimensions (1 unit = 1 cm), circuit values, event bus |
| `scene.js` | Bench, arena, spiders, lighting, camera views |
| `electronics.js` | Piezo disc, preamp board, cables, recorder |
| `signal.js` | Signal-chain simulation (48 kHz, time domain) |
| `ui.js` | Controls, instruments, click-to-inspect, main loop |

No build step. It uses three.js r147 and Google Fonts from their CDNs, so it needs an internet
connection. To run locally, open `index.html` in a browser.
