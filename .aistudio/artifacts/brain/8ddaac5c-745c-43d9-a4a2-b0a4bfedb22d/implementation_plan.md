# VoxClip Studio — Procedural Demo Voice Samples & Soundscape Ambience Mixer

This plan enhances VoxClip Studio with **Built-in Procedural Demo Voice Samples** for instant one-tap voice auditioning without a microphone, alongside a **Background Ambience & Foley Soundscape Mixer** housed in a dedicated **Ambience & FX Extras** sub-panel—all powered by zero-bloat procedural Web Audio DSP synthesis.

## User Review & Critical Decisions

> [!IMPORTANT]
> The following product and architectural decisions reflect your confirmed choices:

- **Confirmed Decision 1 — Built-in Demo Voice Samples (`Instant Zero-Mic Testing`)**: Adds a one-tap **Demo Voice Selector** in the Source Capture bay featuring procedurally synthesized formant speech/vocal phrases (*Male Baritone Narrative*, *Female Alto Vocal*, *Expressive Storyteller*, *Whisper / Intimate Cadence*, and *Sci-Fi Comms Phrase*) so users can audition all 64+ presets, 3-slot chains, and XY morphing immediately.
- **Confirmed Decision 2 — Background Ambience & Foley Soundscape Mixer (`Immersive Scene Layering`)**: Adds a procedural soundscape generator with 8 curated environments (*Off*, *Vinyl & Tape Crackle*, *Rain & Distant Thunder*, *Starship Bridge Hum*, *Vintage Radio Static*, *Dungeon Cavern Wind*, *Cyberpunk Neon Rain*, and *Campfire Crackles*), complete with **Ambience Mix Level**, **Tone / Brightness**, and **Voice Auto-Ducking** (automatically dips the background soundscape when the voice speaks).
- **Confirmed Decision 3 — Procedural Formant & Soundscape Synthesis (`Zero Repo Bloat`)**: Generates both the realistic multi-syllable formant vocal phrases (glottal Rosenberg/LF pulse train + cascaded vocal tract formant resonators F1/F2/F3 + consonant bursts + natural pitch prosody) and the continuous atmospheric soundscapes purely in the client-side DSP engine (`VoxFx`), keeping the repository lightweight and 100% offline.
- **Confirmed Decision 4 — Dedicated Ambience & FX Extras Sub-Panel (`Split Studio Deck`)**: Integrates a dedicated **Ambience & FX Extras** sub-panel inside the Right Workspace Deck (`XY Morph & Clean` view and `All Panels` rack) and synchronizes the ambience parameters (`ambiencePreset`, `ambienceMix`, `ambienceDuck`, `ambienceTone`) across live playback, offline `Apply FX` baking, WAV/MP3/Opus export, custom presets, `.voxproject` files, and undo/redo history.

---

## 1. Overview & Core Concept

- **What It Does**: Eliminates the "cold start" friction of needing to record a microphone take or hunt for an audio file before testing voice transformations, and lets creators place their transformed voice inside a rich atmospheric environment with automatic voice ducking.
- **Target Audience / Persona**: Content creators, streamers, game masters, podcasters, and sound designers on iPad, desktop, and mobile who want to audition voice characters in one tap and export broadcast-ready voice + atmosphere clips in a single pass.
- **Key Value**: Turns VoxClip Studio from a standalone voice processor into a self-contained voice & scene design workstation where anyone can launch the app, tap a demo voice, blend a preset chain with a reactive background soundscape, and export immediately.

---

## 2. User Experience & Visual Design

- **Key User Flows**:
  1. **Zero-Mic Instant Auditioning (`Step 1 → Step 2 in One Tap`)**:
     - Inside the Left Dock's **Source** card, directly below the primary `Record` / `Monitor` / `Upload` row, a compact **Try Demo Voice** bar lets users pick a procedural vocal archetype (*Baritone Phrase*, *Alto Phrase*, *Storyteller*, *Whisper Cadence*, *Sci-Fi Comms*) and tap **Load Demo** (or select directly).
     - If a recording or uploaded clip is already loaded, replacing it follows the studio's standard confirmation safeguard (`studioConfirm`).
     - Upon loading, the synthesized mono vocal phrase populates the waveform visualizer, advances the 3-Step Workflow Banner to **Step 2 (`2. Transform & Sculpt`)**, and is immediately ready for playback and FX processing.
  2. **Layering Background Ambience (`Ambience & FX Extras Sub-Panel`)**:
     - Inside the Right Workspace Deck (under `XY Morph & Clean` and visible in `All Panels`), a new **Ambience & Soundscape Mixer** sub-panel sits alongside the Pre-FX Vocal Cleanup strip.
     - Users can tap any of the tactile soundscape scene pills or dropdown options (*Vinyl Crackle*, *Rain & Thunder*, *Starship Hum*, *Radio Static*, *Dungeon Wind*, *Cyberpunk Rain*, *Campfire*) and adjust three oversized $44\text{px}$ touch faders:
       - **Ambience Mix (`0%`–`80%`)**: Controls the level of the procedural soundscape bed relative to the voice.
       - **Voice Auto-Duck (`0%`–`100%`)**: Envelope-follows the vocal signal so the background soundscape ducks smoothly underneath active speech and swells back during pauses.
       - **Ambience Tone (`Dark` to `Bright`)**: Shapes the spectral tilt of the ambience bed so it never masks vocal intelligibility.
  3. **Auditioning, Baking & Exporting (`WYSIWYE`)**:
     - Pressing **▶ Play** renders both the transformed voice and the ducked background soundscape in real time; toggling **A/B** compares the dry original voice against the full wet voice + soundscape mix.
     - Clicking **Apply FX** or exporting (**WAV 16/24-bit**, **MP3**, **Opus**, **Batch Presets**) renders the exact voice + ducked ambience mix through the LUFS mastering stage.

- **Visual Identity & Theme**:
  - *Aesthetic Direction*: Retains and extends the **Pro Hardware Console** dark slate aesthetic (`#080d14` chassis, `#121821` cards, `#202d40` `1px` structural hairlines).
  - *Color Palette & Mood*:
    - **60% Dominant Canvas**: Deep studio slate (`--bg: #080d14`, `--bg2: #0f1622`).
    - **30% Structural Surfaces**: Recessed bay controls (`--bg3: #162030`) and muted steel labels (`--muted: #8b9bb0`).
    - **10% Semantic Accents**: Studio Cyan (`#38bdf8`) for active demo voice & soundscape selection, Nominal Emerald (`#34d399`) for active ducking/LUFS indicators, and Warm Amber (`#fbbf24`) for A/B dry comparison.
  - *Typography & Hierarchy*:
    - UI labels in `Plus Jakarta Sans` with strict single-line button discipline (`whitespace-nowrap`).
    - Numeric readouts (`%`, `dB`, `Hz`, duration) in `JetBrains Mono` with `font-variant-numeric: tabular-nums`.
    - Zero static pill clutter: source sample metadata and ducking status render as clean inline text with `·` separators.

---

## 3. Key Product Decisions & Trade-Offs

- **Decision 1: Formant-Synthesized Vocal Phrases vs. Static Audio Files**
  - *Chosen Approach*: Build `synthesizeDemoVoice(presetId, sampleRate)` inside `VoxFx` (`js/fx-engine.js`) using a glottal pulse generator (fundamental pitch contour $F_0$ with natural vibrato and intonation cadence), time-varying formant resonator banks ($F_1, F_2, F_3$ modeling vowel-to-vowel transitions and voiced/unvoiced plosive/fricative articulation), and syllable envelope shaping.
  - *Why*: Produces rich, harmonic, speech-like vocal phrases (~3.5–4.5 seconds) with realistic formants, sibilance, and pitch contours that exercise pitch shifting, formant scaling, vocoding, de-essing, and reverb realistically—with **0 KB of external asset downloads** and instant synchronous generation offline.
  - *Alternatives Considered*: Bundling multiple uncompressed WAV/MP3 files increases repository size and service-worker cache footprint; Web Speech API `speechSynthesis` cannot be captured into an `AudioBuffer` across browsers due to OS sandboxing.

- **Decision 2: Envelope-Ducked Procedural Soundscape Engine**
  - *Chosen Approach*: Implement `applyAmbienceSoundscape(buf, fx)` in `VoxFx` and integrate a real-time/offline ambience generator with sidechain-style vocal envelope ducking.
  - *Why*: Without auto-ducking, background ambiences like rain or radio static can muddy quiet consonants. Tracking the vocal envelope and ducking the ambience by `ambienceDuck` ensures broadcast-grade clarity while letting the atmosphere breathe between spoken phrases.

- **Decision 3: Full State & Persistence Integration**
  - *Chosen Approach*: Add `ambiencePreset` (`'none'`), `ambienceMix` (`0`), `ambienceDuck` (`0.5`), and `ambienceTone` (`0`) to `DEFAULT_FX_VALUES` and `FX_META`.
  - *Why*: Because they live in the standard `S.fx` parameter schema, they automatically work with the 50-step Undo/Redo stack, Custom Settings library, `.voxproject` files, IndexedDB browser projects, and `localStorage` persistence without breaking existing schemas or unit tests.

---

## 4. Technical Architecture & Data Strategy *(Technical Reference)*

- **Architecture & Signal Flow Diagram**:

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│ LEFT DOCK: SOURCE CAPTURE BAY                                                       │
│ ┌───────────────────────────────┐     ┌───────────────────────────────────────────┐ │
│ │ ● Record  🎧 Monitor ⬆ Upload │     │ 🗣️ Try Demo Voice: [Baritone Narrative ▾] │ │
│ └──────────────┬────────────────┘     └─────────────────────┬─────────────────────┘ │
│                │                                            │                       │
│                ▼                                            ▼                       │
│        Mic / File Decode                     VoxFx.synthesizeDemoVoice(type)        │
│                └────────────────────┬───────────────────────┘                       │
│                                     ▼                                               │
│                       Mono Project AudioBuffer (S.buffer)                           │
└─────────────────────────────────────┬───────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────────────┐
│ VOXFX DSP & SOUNDSCAPE PIPELINE (Live Preview · Apply FX Bake · Final Export)       │
│                                                                                     │
│  [1. Pre-FX Vocal Cleanup] ──► Hum Notch (50/60Hz) → Noise Gate → De-Esser          │
│              │                                                                      │
│              ▼                                                                      │
│  [2. Pitch & Synthesis]    ──► Phase-Vocoder Pitch/Cents → Harmonizer → Vocoder     │
│              │                                                                      │
│              ▼                                                                      │
│  [3. Core WebAudio Chain]  ──► Formant EQ → Filter/Drive/Ring → Chorus/Delay/Reverb │
│              │                                                                      │
│              ▼                                                                      │
│  [4. Ambience & Soundscape]──► Procedural Generator (Rain / Vinyl / Sci-Fi / Wind)  │
│              │                 × Tone Filter × Vocal Sidechain Auto-Ducker          │
│              ▼                                                                      │
│  [5. Master & Export]      ──► Peak Limiter (0.89) & ITU-R BS.1770 LUFS Normalizer  │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

- **Data Model & State Extensions**:
  - **Demo Voice Presets (`DEMO_VOICE_SAMPLES`)**:
    - `'baritone'`: *Male Baritone Narrative* ($F_0 \approx 115\text{ Hz}$, warm chest formants, 4-phrase cadence, ~3.8s)
    - `'alto'`: *Female Alto Vocal* ($F_0 \approx 210\text{ Hz}$, bright resonant formants, melodic inflection, ~3.8s)
    - `'storyteller'`: *Expressive Storyteller* ($F_0 \approx 145\text{ Hz}$, dynamic pitch prosody + crisp sibilants for testing De-Esser/Gate, ~4.2s)
    - `'whisper'`: *Breathy Whisper Cadence* (aspirated formant noise + soft voicing for testing ASMR/Ghost/Clean Boost, ~3.5s)
    - `'scifi'`: *Sci-Fi Comms Check* ($F_0 \approx 130\text{ Hz}$, rhythmic staccato syllables ideal for Robot/Vocoder/Radio presets, ~3.6s)
  - **Ambience Soundscape Parameters in `DEFAULT_FX_VALUES`**:
    - `ambiencePreset`: `'none' | 'vinyl' | 'rain' | 'starship' | 'static' | 'dungeon' | 'cyberpunk' | 'campfire'` (default `'none'`)
    - `ambienceMix`: `0` to `0.8` (default `0`, step `0.01`)
    - `ambienceDuck`: `0` to `1` (default `0.55`, step `0.01` — amount of vocal-triggered sidechain ducking)
    - `ambienceTone`: `-6` to `+6` dB (default `0`, step `0.5` — lowpass/highshelf spectral tilt on the ambience bed)

- **Interactive Component & State Mapping**:
  - **Demo Voice Bar (`#demoVoiceSelect`, `#btnLoadDemoVoice`)**:
    - Selecting a demo voice and tapping **Load Demo** synthesizes the mono `AudioBuffer` via `fxApi.synthesizeDemoVoice(voiceId)`, checks replace confirmation if a user clip is active, calls `setBuffer(buf, { name: 'Demo: ' + label, clearVideo: true })`, and shows a confirmation toast.
  - **Ambience & FX Extras Sub-Panel (`#ambienceDetails` inside `#panelXyCleanup` + synced in `#fxPanel`)**:
    - Scene selector buttons/dropdown (`#ambiencePresetSelect` and quick scene buttons) set `S.fx.ambiencePreset` (and automatically set `S.fx.ambienceMix = 0.25` when switching from `'none'` to an active scene so the user immediately hears the soundscape).
    - Sliders for `#ambienceMix`, `#ambienceDuck`, and `#ambienceTone` update `S.fx` in real time, sync with the Advanced Lab group, push to the Undo/Redo history stack on gesture start, and trigger `invalidatePreview()` so live playback and waveform/LUFS readouts reflect the soundscape immediately.
    - Clicking **Reset FX** or **Clear Ambience** cleanly resets the soundscape back to `'none'` / `0%`.
