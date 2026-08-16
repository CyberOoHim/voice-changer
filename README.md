# VoxClip Studio

Browser-native **voice changer and sound design studio** (PWA). Record or upload audio, chain up to 3 presets, tweak the Advanced FX Lab, manage multi-take recording history, save/restore complete project sessions, and export WAV/MP3 — all **100% client-side** with zero server dependencies.

**Status:** v3-aligned implementation (Modular JS + PWA, GitHub Pages ready)  
**App entry:** `index.html`  
**Audio Engine:** `js/fx-engine.js` · `js/app.js`  
**Spec:** `docs/voxclip-studio-prd-v3.0.md`

---

## Key Features

### 🎙️ Capture & Source Audio
- **Microphone recording** across desktop, iPad/Safari, and Android Chrome with live `ScriptProcessorNode` audio level metering.
- **Recording Modes**:
  - **New clip (Standalone Take)**: Creates a new independent take in the takes stack.
  - **Append (crossfade)**: Seamlessly appends new microphone takes to the end of the existing audio buffer with smooth 30–40ms crossfading to eliminate pops and clicks.
- **Multi-Take Recording History**:
  - Dedicated **10-take FIFO buffer** tracking recording takes.
  - **Undo Take (`Alt+Z`)** / **Redo Take (`Alt+Y`)** with take counter badge (`Take X of Y`).
  - Non-destructive branching history when recording over prior takes.
  - **Delete Recording Take**: Permanently purges the active take from the history stack with a confirmation modal, automatically rolling back to the previous take or resetting cleanly.
- **Gain & Normalization Pipeline**:
  - **Mic level** slider (1×–12×) — live hardware boost into `MediaRecorder` when supported; applied post-stop as make-up gain on quiet devices.
  - **Input gain** slider (0.5×–9×) — pre-FX playback and export make-up gain cascaded with the Advanced Lab FX gain (`inputGain × fx.gain`).
  - **Match loudness** — auto-calibrates input gain from RMS/peak so quiet clips export at the desired volume.
  - **Quiet-mic normalize** — multi-pass peak targeting (0.95 peak target, up to 32× gain) optimized for iOS/iPad Safari microphones.
- **3-2-1 countdown** and customizable max recording duration (1–10 min).
- **Import & Drag-and-Drop**:
  - Audio formats: WAV, MP3, AAC, M4A, FLAC, OGG, WebM, CAF, AIFF.
  - Video formats: MP4, MOV, WebM, M4V, 3GP (with optional synchronized muted video preview).
  - Direct drag-and-drop support for **`.voxproject`** session files.
- Always converted to a clean **mono** project buffer (`toMonoBuffer`).

---

### 💾 Project Save & Restore (.voxproject & Browser Library)
- **Standalone `.voxproject` Files**:
  - Export and download portable `.voxproject` files containing the full session snapshot:
    - Audio buffers & multi-take history serialized as 16-bit PCM base64 WAV.
    - Active FX parameters, 3-slot preset chains, and per-slot mix ratios.
    - Custom user preset library and active preset references.
    - UI preferences (recording mode, loop, zoom, skip interval, mic levels, gain).
  - Open `.voxproject` files via drag-and-drop or the file picker with validation and error protection.
- **Immediate FX Application on Restore**:
  - Automatically reconstructs the real-time preview buffer (`rebuildPreview`) upon decoding raw audio takes, guaranteeing that pitch shifts, reverse, fades, bitcrush, and DSP chain graphs are instantly audible during playback.
  - Automatically recomputes FX parameters for preset chains and custom presets if settings require fallback synthesis.
  - Re-synchronizes gain sliders (both top-level and Advanced Lab), waveform zoom indicators, preset tabs ('built-in' / 'custom'), and search queries, while safely resetting A/B comparison to audition wet FX by default.
- **In-Browser Project Library (IndexedDB)**:
  - Save, load, export, and delete multiple named projects directly inside the browser (`voxclip_projects` store) without manual file downloads.
- **Project Manager Modal & Shortcuts**:
  - Quick access via `📁 Project` button in header or hotkeys: **Ctrl/Cmd+S** (Save Project) and **Ctrl/Cmd+O** (Restore Project).

---

### 🎛️ Preview, Waveform & Transport
- **Interactive Canvas Waveform**:
  - Cached peak pyramid for instant rendering and responsive touch/pointer seeking.
  - Interactive **Zoom controls** (1× to 8×) and viewport panning.
- **Transport Controls**:
  - Play, Pause, Stop, and Loop toggle.
  - **A/B Dry vs Wet**: Click-to-toggle comparison button with distinct active status styling to instantly compare processed audio against the original dry capture.
  - Configurable skip intervals (1s, 3s, 5s, 10s) with dedicated mobile `⋯` skip sheet.
  - Video frame stepping (◀ / ▶) for video sources.
  - Live elapsed/total time chip.

---

### 🎭 Voice FX & Preset Chaining
- **99 Built-in Voice Presets** grouped into 6 categories:
  - **Ages**: Baby, Toddler, Child, Teen, Adult, Mature, Senior, Elder, Grandma, Grandpa, etc.
  - **Characters**: Deep, Hero, Villain, Ghost, Monster, Goblin, Wizard, Anime, Announcer, etc.
  - **Creatures**: Robot, Cyborg, Alien, Dragon, Chipmunk, Mouse, Ogre, Demon, etc.
  - **Devices**: Radio, Walkie-Talkie, Megaphone, Telephone, Intercom, PA System, Space Comm, etc.
  - **Lo-Fi**: Cassette, Vinyl, Old TV, VHS, 8-Bit, Arcade, Gramophone, Distorted, etc.
  - **Spaces**: Cave, Cathedral, Underwater, Helium, Giant Hall, Echo Canyon, Reverse, etc.
- **3-Slot Preset Chaining**:
  - Chain up to 3 presets in click order with visual badges (**1 / 2 / 3**).
  - **Drag-and-drop slot reordering** and individual **per-slot mix sliders** (0%–100%).
  - Blended automatically into the Advanced Lab DSP parameter graph.
- **Custom User Presets & Packs**:
  - Save up to 50 named presets preserving complete FX settings, preset chains, and slot mixes.
  - Export and import custom preset packs (JSON) with conflict resolution (Skip, Replace, Keep Both).
- **Offline FX Baking & Resets**:
  - **Apply FX**: Offline renders (bakes) the processed effect into the working buffer (WYSIWYE) and resets lab sliders for multi-layer sound design.
  - **Reset FX**: Restores original captured audio and clears active FX.
  - **Reset Audio** & **Reset Project**: Dedicated reset flows with confirmation modals.

---

### 🔬 Advanced Lab (Web Audio DSP Engine)
- **Independent Pitch Shifter**: Duration-preserving pitch shifting (−24 to +24 semitones, ±100 cents) independent of speed.
- **Playback Speed**: 0.25× to 4.0× playback rate.
- **Formant & Vocal Modeling**: Formant shift, gender shift, and throat length filters.
- **Distortion & Character**: Drive, tube saturation, and 8-bit / bitcrusher downsampling.
- **Modulation**: Chorus, flanger, phaser, vibrato, tremolo, and ring modulator.
- **Filters & Tone**: Lowpass, highpass, bandpass, notch, and 3-band EQ (Bass, Mid, Treble).
- **Space & Ambience**: Delay/echo with feedback, stereo convolution reverb, room size, and damping.
- **Dynamics**: Peak limiter, dynamic compressor (threshold, ratio, attack, release), and noise gate.

---

### 🔄 Dual Undo / Redo System
1. **FX & Parameter History**:
   - 50-step undo/redo stack tracking slider edits, preset chain combinations, and input gain (`Ctrl/Cmd+Z`, `Ctrl/Cmd+Y`).
   - Stores up to 10 audio buffer snapshots for offline **Apply FX** bakes.
2. **Recording Takes History**:
   - 10-take FIFO buffer for mic recordings and crossfade appends (`Alt+Z`, `Alt+Y`).
   - Preserved across project saves and exports.

---

### 📦 Export & PWA Offline Support
- **WAV Export**: 16-bit PCM mono WAV (always available client-side).
- **MP3 Export**: Client-side MP3 encoding via bundled `vendor/lame.min.js`.
- **Web Share API**: Directly share exported audio files on supported mobile devices.
- **PWA & Offline Capability**:
  - Service worker precaching (`sw.js`) for full offline availability.
  - Web App Manifest (`manifest.webmanifest`) for standalone home-screen installation.
  - Dark studio aesthetic with responsive mobile touch layout and safe-area insets.

---

## Quick Start (Local Development)

Run any static HTTP server from the repository root:

```bash
# Python 3
python -m http.server 8080

# Node.js
npx --yes serve -l 8080
```

Open `http://localhost:8080` in your browser.

> [!NOTE]
> Microphone recording requires a **secure context** (`localhost`, `127.0.0.1`, or **HTTPS**).

---

## Running Automated Tests

VoxClip Studio includes comprehensive unit test suites covering the audio DSP engine, multi-take recording history, append crossfading, UI persistence, and project serialization:

```bash
# Run all unit tests
node --test js/*.test.js
```

### Test Suites:
- `js/fx-engine.test.js`: Audio buffer processing, peak pyramid, pitch shifting, normalization, and WAV encoding/decoding.
- `js/local-storage.test.js`: LocalStorage serialization, UI state persistence, safe default fallback sanitization, and A/B dry mode resets.
- `js/project.test.js`: Project snapshot generation, base64 WAV serialization, IndexedDB mock CRUD, multi-take restoration, and immediate FX preview buffer application to raw audio.
- `js/recording-history.test.js`: 10-take FIFO stack, undo/redo branching, take deletion, and crossfade append logic.

---

## Deploy to GitHub Pages

1. Push the repository to GitHub (`main` or `master` branch).
2. In GitHub, go to **Settings → Pages → Build and deployment**:
   - **Source**: Deploy from a branch
   - **Branch**: `main` (or `master`) / folder: `/` (root)
3. Save and wait for the workflow to publish.

**URL:** `https://<username>.github.io/<repository>/`

> [!TIP]
> All asset URLs are relative (`./sw.js`, `./js/app.js`, `./manifest.webmanifest`, `./icons/`), and `.nojekyll` is included to ensure smooth hosting on root and subpath GitHub Pages URLs.

---

## Project Structure

```
├── index.html                     # App shell, responsive layout, CSS variables & modals
├── js/
│   ├── app.js                     # UI controllers, transport, state management, project persistence
│   ├── fx-engine.js               # Web Audio API DSP graph, pitch shifter, buffer math, WAV encoder
│   ├── fx-engine.test.js          # Audio engine unit tests
│   ├── local-storage.test.js      # LocalStorage & UI persistence unit tests
│   ├── project.test.js            # Project save/restore & IndexedDB unit tests
│   └── recording-history.test.js  # Recording take history & crossfade append unit tests
├── vendor/
│   └── lame.min.js                # Bundled same-origin MP3 encoder
├── fx-presets.json                # Standalone dataset of 99 built-in voice FX presets
├── manifest.webmanifest           # PWA web manifest metadata
├── sw.js                          # Service worker cache strategy (precache + network-first)
├── icons/                         # PWA app icons (192px, 512px, maskable)
├── docs/
│   └── voxclip-studio-prd-v3.0.md # Complete PRD and technical specifications
├── .nojekyll                      # Disables Jekyll processing on GitHub Pages
└── README.md                      # Project documentation
```

---

## Keyboard Shortcuts

| Shortcut | Action |
|:---|:---|
| **Space** | Play / Pause playback |
| **Ctrl / Cmd + S** | Open Project Manager (Save tab) |
| **Ctrl / Cmd + O** | Open Project Manager (Restore tab) |
| **Ctrl / Cmd + Z** | Undo FX parameter change |
| **Ctrl / Cmd + Y** *(or Shift+Ctrl+Z)* | Redo FX parameter change |
| **Alt + Z** | Undo Recording take (Previous Take) |
| **Alt + Y** *(or Alt+Shift+Z)* | Redo Recording take (Next Take) |
| **← / →** or **J / L** | Skip backward / forward by configured interval |
| **Shift + ← / →** | Skip backward / forward by 10 seconds |
| **Home** / **0** | Jump playhead to beginning |
| **End** | Jump playhead to end |
| **,** / **.** | Step video frame backward / forward (video sources) |
| **Escape** | Close open modal |

---

## Storage & Data Architecture

| Storage Layer | Data Stored | Lifecycle |
|:---|:---|:---|
| **`localStorage` (`voxclip.studio.v3`)** | Active FX params, preset chain IDs, custom preset library, UI preferences (gain, mic level, zoom, mode) | Persists across browser refreshes. Automatically creates `.bak` fallback if corrupted. |
| **IndexedDB (`voxclip_projects`)** | Complete saved project snapshots: project names, metadata, multi-take base64 WAV buffers, chain mixes, full settings | Browser-local persistent database. No file downloads required. |
| **`.voxproject` File** | Portable JSON export of complete project snapshot with all audio buffers and settings | User-managed standalone file for backup, sharing, or cross-device transfer. |
| **Runtime Memory** | Active `AudioBuffer`, peak pyramids, undo/redo parameter stacks, live playback nodes | Cleared on page reload or Reset Project. |

---

## Device & Browser Notes

- **Chrome / Edge / Firefox (Desktop & Android)**: Full Web Audio, WebM/WAV recording, and Web Share API support.
- **Safari (macOS / iOS / iPadOS)**:
  - Uses `MediaRecorder` with MP4/AAC/WebM fallbacks.
  - Automatically handles user gesture requirements for `AudioContext` activation.
  - Quiet iPad/iPhone microphones are compensated using **Mic level** boost, **Input gain**, and automatic multi-pass normalization.
- **Offline Use**: Once loaded, all application features (recording, FX processing, project saving, WAV/MP3 exporting) function 100% offline without internet access.

---

## Privacy & Security

- **Zero Server Uploads**: Audio recorded or uploaded into VoxClip Studio is processed entirely on your local device CPU/GPU via Web Audio and WebAssembly/JS.
- **No Analytics / Telemetry**: No third-party tracking scripts, cookies, or remote data logging.
- **Offline First**: All assets, presets, and dependencies are served locally and precached by the service worker.

---

## License

MIT License. Modify and use freely for personal or commercial projects.
