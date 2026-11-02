# VoxClip Studio — Code Health, Integrity & iPad Power Eco Overhaul

This plan upgrades VoxClip Studio's end-to-end reliability, fixes critical DOM and control-state bugs, and introduces an intelligent **iPad Power Eco Engine** that dramatically reduces CPU, GPU, and CoreAudio battery drain during mobile and tablet studio sessions.

## User Review & Critical Decisions

> [!IMPORTANT]
> The following architectural and UX decisions incorporate your confirmed preferences and our deep audit of the application state:

- **Confirmed Decision 1 — Automatic iPad & Battery Power Eco Mode**: Automatically activates on iPadOS/iOS devices and unplugged/low-battery sessions (via Battery Status API), with a manual override selector (`Auto (iPad / Battery)`, `Always On (24 fps Eco)`, `Off (Full Performance)`) in Settings and a live status indicator in the header.
- **Confirmed Decision 2 — 24 FPS ProMotion Cap & Smart DSP Caching**: Caps all canvas and meter animation loops (`requestAnimationFrame`) to **24 FPS** (~41.7ms frame interval) when Eco Mode is active on iPad, suspends idle `AudioContext` hardware threads after 4 seconds of inactivity (or immediately when backgrounded), and caches offline DSP stages so adjusting live WebAudio parameters (EQ, reverb, distortion, compressor, speed, XY pad) updates audio nodes in place without re-running phase-vocoder or LUFS passes.
- **Confirmed Decision 3 — Full Studio Integrity & Native Modals**: Repairs unclosed modal DOM nesting that trapped Live Monitor and Batch Export dialogs, enables all newly added studio buttons (`+ Marker`, `Clear`, `Export WAV 24-bit`, `Export Opus`, `Batch Presets`), replaces all blocking browser `prompt()`/`confirm()` calls with non-blocking studio modals, and upgrades Opus export to encode real compressed Opus/WebM audio streams.

---

## 1. Overview & Core Concept

- **What It Does**: Delivers a production-hardened, battery-conscious voice design studio that runs cool on iPad Pro/Air ProMotion displays while ensuring every control, modal, preset chain blend, and export format operates with zero dead states or audio resource leaks.
- **Target Audience / Persona**: Creators, voice actors, podcasters, and sound designers using VoxClip Studio on iPad (Safari and Home Screen PWA) and desktop browsers.
- **Key Value**: Prevents thermal throttling and rapid battery drain on iPad while eliminating subtle state desynchronizations, broken modal hierarchies, and fake/disabled export paths.

---

## 2. User Experience & Visual Design

- **Key User Flows**:
  1. **Zero-Config iPad Eco Operation**: Launching on an iPad automatically engages Eco Mode (24 FPS canvas cadence, compositor-friendly surfaces without heavy GPU backdrop blur, and automatic CoreAudio sleep when idle). Users can toggle or inspect Eco status from the top bar or Settings modal.
  2. **Lag-Free XY Morphing & Slider Tweaking**: Dragging the 2D Macro XY Pad or Advanced Lab sliders updates live WebAudio filter/gain parameters immediately without rebuilding 90+ preset DOM cards or triggering redundant phase-vocoder buffer renders on every pointer move.
  3. **Non-Blocking Studio Confirmations & Prompts**: Renaming, overwriting, or deleting custom voice presets, replacing loaded audio, and deleting browser projects open a keyboard-accessible studio dialog modal rather than native browser `prompt()`/`confirm()` popups.
  4. **Complete Transport, Cue & Mastering Flow**: Recording or uploading audio immediately activates Timeline Cue Markers (`+ Marker`, `Clear`), 24-bit WAV export, real Opus encoding, and Batch Presets rendering with proper modal layering.
- **Visual Identity & Theme**:
  - *Aesthetic Direction*: Dark utilitarian studio console (`#0b0f14` canvas, `#121821` elevated cards, `#38bdf8` cyan and `#34d399` emerald accents).
  - *Eco Surface Adaptation*: When `body.power-eco` is active, expensive per-frame `backdrop-filter: blur(8px)` and infinite CSS box-shadow pulse animations are replaced with crisp, zero-GPU-overdraw solid studio surfaces and opacity transitions.
  - *Typography & Hierarchy*: System sans-serif UI paired with strict `tabular-nums` on all timecodes, LUFS readouts, and parameter values to prevent layout jitter during 24 FPS updates.
- **Interactive Feedback & Motion**:
  - Instant pointer response on sliders and the Retina-scaled XY Pad, paired with a 24 FPS render cadence in Eco Mode and clean toast notifications for power state transitions and export completions.

---

## 3. Key Product Decisions & Trade-Offs

- **Decision 1: 24 FPS Frame Pacing & DOM Diffing on iPad Eco Mode**
  - *Chosen Approach*: Throttle `requestAnimationFrame` loops for playback waveform/spectrum/spectrogram rendering, recording VU meters, and live monitor feedback checks to 24 FPS (~41.7ms) in Eco Mode, and update timecode text nodes in place rather than recreating DOM elements on every tick.
  - *Why*: iPad ProMotion displays fire `requestAnimationFrame` at 120Hz. Running 2D canvas gradients, waterfall spectrogram blits, and DOM node replacements 120 times per second consumes massive GPU/CPU power. 24 FPS provides smooth visual metering at 20% of the rendering cost.
  - *Alternatives Considered*: Unthrottled `requestAnimationFrame` (drains battery rapidly on iPad) or disabling visualizers entirely (reduces studio feedback).
- **Decision 2: Split Offline-Baked vs. Real-Time WebAudio Parameter Pipeline**
  - *Chosen Approach*: Track a fingerprint of offline-only DSP parameters (`pitchSemi`, `pitchCents`, `pitchMode`, `reverse`, `humNotch`, `gateThreshold`, `gateRelease`, `deEssAmount`, `deEssFreq`, `harmonyPreset`, `harmonyMix`, `vocoderMix`, `vocoderCarrier`, `vocoderBands`, `fadeIn`, `fadeOut`, `bitcrush`, `sampleRateCrush`). Only re-run `rebuildPreview()` and `computeLUFS()` when an offline parameter or source buffer changes; update live `BiquadFilterNode`, `GainNode`, `DynamicsCompressorNode`, and `AudioBufferSourceNode.playbackRate` directly during playback when real-time sliders move.
  - *Why*: Eliminates main-thread CPU spikes and audio dropouts when sweeping EQ, reverb, distortion, or XY Pad axes.
  - *Alternatives Considered*: Rebuilding the entire preview buffer on every `onFxEdited` call (causes severe CPU churn and battery drain during slider drags).
- **Decision 3: Hardware AudioContext Auto-Suspend & Pure Buffer Allocation**
  - *Chosen Approach*: Decouple pure `AudioBuffer` creation from `audioCtx.resume()` during offline buffer math, automatically call `audioCtx.suspend()` after 4 seconds of idle state (when not playing, recording, or live-monitoring), and immediately suspend audio + stop live monitoring when the app is backgrounded (`visibilitychange` / `pagehide`).
  - *Why*: iPadOS keeps the hardware audio codec and DSP thread awake as long as an `AudioContext` remains in the `running` state, even when outputting silence.

---

## 4. Technical Architecture & Data Strategy *(Technical Reference)*

- **Architecture & Component Diagram**:

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        VoxClip Studio UI Layer                          │
│  ┌──────────────┐  ┌──────────────────┐  ┌───────────┐  ┌────────────┐  │
│  │ Header & Eco │  │ Source & Cleanup │  │ Transport │  │ XY Pad &   │  │
│  │ Status Toggle│  │ Strip (2-Way)    │  │ & Cues    │  │ Adv. Lab   │  │
│  └──────┬───────┘  └────────┬─────────┘  └─────┬─────┘  └──────┬─────┘  │
└─────────┼───────────────────┼──────────────────┼───────────────┼────────┘
          │                   │                  │               │
          ▼                   ▼                  ▼               ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                   State & Power Eco Controller (S)                      │
│  • Eco Governor: Auto (iPad/Battery) | On (24 FPS) | Off (60 FPS)       │
│  • Idle Audio Timer: Auto-suspends AudioContext after 4s inactivity     │
│  • Smart Preview Cache: Offline-DSP Fingerprint vs. Live Node Updates   │
│  • Promise Dialog Manager: Non-blocking Confirm / Prompt Studio Modal   │
└─────────┬──────────────────────────────────┬───────────────────┬────────┘
          │                                  │                   │
          ▼                                  ▼                   ▼
┌────────────────────────┐   ┌──────────────────────────┐   ┌─────────────┐
│  Offline DSP Engine    │   │ Real-Time WebAudio Graph │   │ Persistence │
│  • Phase-Vocoder / HQ  │   │ • In-Place Node Updates  │   │ • localStorage│
│  • Harmonizer/Vocoder  │   │ • 24 FPS Visualizer Loop │   │ • IndexedDB │
│  • Cleanup & BS.1770   │   │ • WAV 16/24, MP3 & Opus  │   │   Projects  │
└────────────────────────┘   └──────────────────────────┘   └─────────────┘
```

- **Data Model & State**:
  - `S.ui.ecoMode`: `'auto' | 'on' | 'off'` (persisted in `localStorage` and `.voxproject` snapshots; defaults to `'auto'`).
  - `S.ecoActive`: Computed boolean (`true` when `ecoMode === 'on'`, or when `ecoMode === 'auto'` on iPad/iOS or when battery is discharging/low).
  - `previewCacheKey`: Serialized signature of `S.buffer` identity + offline-baked FX keys so `rebuildPreview()` skips redundant DSP passes when only live WebAudio parameters change.
- **Interactive Component & State Mapping**:
  - **DOM & Modal Integrity**: Properly close `#projectModal` in markup, wire `#projectModalClose`, and add a reusable `#dialogModal` for non-blocking text prompts and confirmations.
  - **Transport & Export Activation**: Include `btnAddMarker`, `btnClearMarkers`, `btnExportWav24`, `btnExportOpus`, and `btnBatchExport` in `updateTransportEnabled()` so all studio features unlock as soon as audio is loaded or recorded.
  - **Two-Way Vocal Cleanup & XY Pad Sync**: Sync `gateThreshold`, `deEssAmount`, and `humNotchSelect` whenever presets, chains, undo/redo, or Advanced Lab controls change; align XY Pad preset labels and parameter mappings; and scale `#xyPadCanvas` for Retina displays (capped at 1.5× DPR in Eco Mode).
  - **Real Opus Export**: Stream rendered audio through an offline/real-time `MediaRecorder` (`audio/webm;codecs=opus` or `audio/ogg;codecs=opus`) with automatic fallback handling.

---

## 5. Verification & Test Execution Summary

All code health, integrity, and iPad Power Eco features have been implemented and verified:

1. **iPad & Battery Power Eco Mode**:
   - Automatic detection of iPadOS / iOS devices and battery discharging states via `initBatteryMonitor()`.
   - Header quick-toggle `#btnEcoToggle` and settings selector `#ecoModeSelect` with `auto`, `on`, and `off` modes.
   - Exact 24 FPS animation throttling (`getMinFrameIntervalMs()` = 41.67ms) on playback, recording VU meters, and live monitoring feedback detector when Eco Mode is active.
   - DPR clamping to 1.5 on Retina canvases in Eco Mode to reduce GPU memory fill rate.
   - 4-second audio idle auto-suspend (`audioIdleTimer`) and backgrounding auto-suspend on `pagehide` and `visibilitychange === 'hidden'`.
2. **Smart DSP Caching & WebAudio In-Place Updates**:
   - `OFFLINE_DSP_KEYS` fingerprinting prevents unnecessary phase-vocoder re-renders.
   - `chain.updateLiveParams` dynamically modifies EQ, filters, reverb, delay, distortion, compressor, and gain during live playback without audio dropouts or buffer rebaking.
3. **Studio Modals & Non-Blocking Dialogs**:
   - `#dialogModal` (`#dialogTitle`, `#dialogDesc`, `#dialogInputGroup`, `#dialogInput`, `#dialogCancel`, `#dialogConfirm`) provides Promise-based `studioConfirm` and `studioPrompt` replacements for all browser `window.confirm` and `window.prompt` calls.
4. **Export & Transport Completion**:
   - Real Opus compression via `bufferToOpus`.
   - Complete transport enabling for `#btnAddMarker`, `#btnClearMarkers`, `#btnExportWav24`, `#btnExportOpus`, and `#btnBatchExport`.
5. **Automated Test Suites**:
   - `npm run lint` passed with 0 errors across `js/app.js`, `js/fx-engine.js`, and `server.js`.
   - `npm test` passed 100% across all 4 suites: `fx-engine.test.js`, `local-storage.test.js`, `project.test.js`, and `recording-history.test.js`.
   - `compile_applet` passed successfully.
