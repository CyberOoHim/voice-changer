# VoxClip Studio — Product Requirements Document

**Version:** 3.0  
**Date:** 2026-07-22  
**Status:** Draft — Product Pivot (Editor → Voice Changer Studio) · Open questions resolved (§19)  
**Author:** VoxClip Team  
**App File:** `voxclip-studio.html` — single-file, offline-capable PWA  
**Supersedes:** `voxclip-studio-prd-v2.2.md`

> **What changed in v3.0:** VoxClip Studio is repositioned from a single-track **audio editor** to a focused **voice changer studio**. Users capture or upload voice, preview it on a simple waveform with play/pause, apply the full FX Lab + presets (including user-saved custom settings), and export. Destructive timeline editing (trim, cut, delete selection, reverse, duplicate, multi-clip insert/append) is **removed**. Browser **localStorage** becomes the system of record for UI state, FX values, and named custom settings. Quality bars from v2.2 (accessibility, error catalog, browser matrix, privacy, performance) are retained and adapted.

---

## 0. Document Map

| Section | Purpose |
|---|---|
| 1–3 | Summary, goals, users |
| 4 | Full feature inventory & user flows |
| 5 | Custom Settings Manager (save / load / manage) |
| 6 | localStorage persistence model |
| 7 | UX wireframes |
| 8 | Technical implementation plan |
| 9 | Testing plan |
| 10 | Risks & mitigations |
| 11 | Accessibility |
| 12 | Browser / device support matrix |
| 13 | Performance budgets |
| 14 | Privacy & data handling |
| 15 | Success metrics |
| 16 | Error & empty states catalog |
| 17 | Migration from v2.x |
| 18 | Roadmap |
| 19 | Decided product rules (resolved open questions) |
| 20 | Glossary |
| 21 | Appendix |

---

## 1. Executive Summary

VoxClip Studio is a **browser-native voice changer** that runs entirely client-side (Web Audio API + OfflineAudioContext) with no server dependency. Users can:

1. **Record** from the microphone, or **upload** audio/video (audio is extracted from video)
2. **Preview** audio with a simple waveform + play/pause transport (and skip controls)
3. **Change their voice** with live-previewed FX, built-in presets, and **user-saved custom settings**
4. **Export** WAV / MP3
5. Have **UI state, FX, and custom settings persist** across sessions via browser `localStorage`

### Product pivot summary (v2.x → v3.0)

| Area | v2.x (Editor) | v3.0 (Voice Changer Studio) |
|---|---|---|
| Primary job | Capture → edit timeline → export | Capture → change voice → export |
| Timeline tools | Trim, Delete selection, Reverse, Duplicate Tail, Clear, Undo/Redo stacks for buffer edits | **Removed** |
| Waveform | Selection, drag-to-trim, edit chips | Display + playhead only; click-to-seek |
| Transport | Full edit transport | Play / Pause / Stop / Loop / Skip + Apply FX / Reset FX |
| Voice FX | Full FX Lab + 16 presets | **Retained in full** |
| User presets | Built-in only | Built-in + **Custom Settings Manager** (save / load / rename / delete) |
| Persistence | Mostly session-only | **localStorage** for settings, UI status, custom presets |
| Multi-clip | Append / Insert at playhead | **Single source buffer** — record or upload **replaces** current audio (with confirm if dirty) |

### Carried forward from v2.x (still required)

- Recording normalization (quiet iPhone/Safari fix)
- MP4 / MOV / WebM video upload with audio extraction
- Optional video preview sync when source is video
- Backward / Forward skip + keyboard shortcuts
- Reset Project (factory reset + clear persisted UI where appropriate)
- PWA / offline shell, privacy-first client-side processing
- Accessibility, error catalog, browser matrix, performance budgets

---

## 2. Goals & Non-Goals

### Goals

- Fastest path: **record or upload → change voice → export** on mobile and desktop
- 100% offline after first load; no install friction
- Consistent loudness across Chrome / Safari / Firefox / iOS / Android
- Accept common voice sources: mic, WAV, MP3, AAC, M4A, OGG, WebM, **MP4 (.mp4)**, MOV, M4V — video files **extract audio to mono**
- Every loaded project buffer is **mono** (record and upload paths both downmix)
- Retain the complete voice-changer surface (presets + Advanced Lab parameters)
- Let users **save, name, load, and manage** custom FX settings
- Persist **settings and UI status** (including custom settings) in **browser localStorage** so a return visit feels continuous
- Never leave the user unsure what happened — every action gets visible feedback within one frame
- Never lose custom settings silently — save/load/delete flows must be explicit and recoverable where reasonable

### Non-Goals (v3.0)

- Multi-track DAW
- Timeline editing: trim, cut, splice, delete selection, reverse, duplicate, multi-clip append/insert
- Undo/Redo of buffer surgery (no buffer edit stack). Optional: Undo/Redo of **FX parameter changes only** may be considered later; not required for v3.0
- Cloud sync / accounts / collaboration
- AI transcription / AI noise removal (future consideration)
- Full video editing (cuts, transitions) — only audio extraction + optional preview sync
- Server-side rendering or storage of user audio (client-side only, by design)
- Cross-device sync of custom settings (localStorage is per-browser/device)

---

## 3. Users

**Primary: Creators / Streamers / Content makers**  
- Record a short VO, apply a voice character (Deep, Robot, Radio, or a saved custom), export for TikTok / Discord / YouTube.  
- Phone-first, one sitting, low setup friction. **Jobs:** “Make my voice sound different in under a minute.”

**Secondary: Podcasters / educators**  
- Upload a take, clean or stylize with FX, export. Care about loudness consistency and repeatable presets (custom settings they reuse every episode).

**Tertiary: Video editors (light)**  
- Drag `interview.mp4` to extract audio, apply voice FX, export audio back to their editor. Scrub with skip controls; no need to cut inside VoxClip.

**Accessibility-dependent users**  
- Keyboard-only or screen-reader users recording a short clip (greeting, statement). Need labeled controls and announced status.

**Jobs to be Done**

- “I recorded too quiet on my iPhone — make it loud without clipping”
- “I want Chipmunk / Deep / Robot / my own saved ‘Streamer Villain’ voice and export it”
- “I have a .mov — I just need the audio with my FX applied”
- “I dialed in the perfect FX last week — load that exact setup again”
- “I closed the tab — when I come back, my last FX and UI layout should still be there”
- “I want to compare before/after FX without re-recording”

---

## 4. Full Feature Inventory & User Flows

Each subsection: **what the user sees → what they do → what happens → what can go wrong.**

### 4.1 Source & Ingest — Voice Recorder & Uploader

#### 4.1.1 Record (required)

- User taps **Record**. Mic permission is requested if not already granted.
  - *If denied:* toast `Microphone access is blocked. Enable it in your browser settings to record.` Record button stays enabled for retry.
- While recording: live level meter (AnalyserNode) + running timer badge (`m:ss`). Visual “recording” state (red pulse on button / meter).
- Constraints: `echoCancellation: false`, `noiseSuppression: false`, `autoGainControl: true`.
- User taps **Stop**. Recording is:
  1. Downmixed stereo → mono (average)
  2. Normalized: peak-scan, target peak **0.95**, gain capped at **8×**, **skipped if source peak ≥ 0.90** (already loud enough)
- Result **replaces** the current project buffer and loads into the waveform, ready for playback and FX.
  - **Replace confirm (always when a buffer exists):** if any audio is already loaded, show confirm before overwrite: `Replace current audio with this recording? Your current clip will be discarded.` Same rule for upload. No duration/FX heuristics — simpler and safer on mobile fat-finger.
- If recording length is 0s → discard, toast `Recording too short — try again.`
- Feature-detect `MediaRecorder` / `getUserMedia` on load; if unsupported, disable Record with message: `Recording isn't supported in this browser — try uploading a file instead.`

#### 4.1.2 Upload (required)

- Entry points: **Upload** button + **Drag & Drop** zone.
- **Must accept `.mp4` / `video/mp4`** (primary video path) in addition to common audio and other video containers.
- Accepted types / extensions:
  - **Audio:** WAV, MP3, AAC, M4A, OGG, WebM audio, FLAC (where browser can decode)
  - **Video (audio extracted):** **MP4**, MOV, M4V, WebM video
- File picker:
  ```html
  <input type="file"
    accept="audio/*,video/*,.mp3,.wav,.m4a,.aac,.flac,.ogg,.oga,.webm,.caf,.aiff,.aif,.mp4,.m4v,.mov,.3gp,.3g2,audio/mpeg,audio/mp3,audio/wav,audio/x-wav,audio/wave,audio/aac,audio/m4a,audio/x-m4a,audio/mp4,audio/flac,audio/ogg,audio/webm,audio/caf,audio/aiff,video/mp4,video/webm,video/quicktime,video/x-m4v">
  ```
  - Explicit extensions (`.mp3,.wav,.m4a,...`) alongside MIME types so iPadOS / iOS Files app surfaces all allowed audio and video files without grayout/muting.
- Drop zone label: `WAV · MP3 · AAC · M4A · MP4 · MOV · WebM`
- Dragging over the zone highlights it; unsupported type → same toast as failed upload (not silent).
- File size: warn (not block) above **500MB**: `Large file — this may take a moment to decode.`
- Successful load **replaces** the current buffer (same **always-confirm-if-buffer-exists** rule as Record — §19.5).
- **No** Append / Insert at playhead (timeline multi-clip is out of scope).
- Product outcome for video (including MP4): user gets a **mono voice buffer** ready for FX/export; video picture is preview-only, never exported as video in v3.0.

#### 4.1.3 Decoding & mono extraction (all uploads, required for MP4)

**Pipeline (every file, including `.mp4`):**

```
File
  → detect isVideo (MIME and/or extension: .mp4, .mov, .m4v, .webm with video/*)
  → if video: keep Blob URL for optional muted preview (§4.1.4)
  → arrayBuffer()
  → AudioContext.decodeAudioData()   // extracts AAC/Opus/etc. audio track from MP4 container
  → toMonoBuffer()                   // REQUIRED: always 1 channel
  → setBuffer(monoBuffer)            // after replace-confirm if needed
```

**Mono rules (hard requirement)**

| Rule | Detail |
|---|---|
| Always mono after ingest | Project buffer is **always** 1 channel after record or upload |
| Stereo / multi-channel source | Downmix: for each sample `out[i] = average(channel0[i] … channelN[i])` (same spirit as recording path) |
| Already mono | Pass through (or copy into a mono `AudioBuffer`); no double-processing gain |
| Sample rate | Preserve source sample rate from `decodeAudioData` |
| Duration | Preserve full audio duration of the extracted track |
| Video picture | Not mixed into the buffer; only the audio track is decoded |

**MP4-specific**

- `.mp4` / `video/mp4` / `audio/mp4` are first-class supported inputs.
- Browser-native demux+decode via `decodeAudioData` is the default path (handles AAC in MP4 on Chrome/Safari/Firefox without extra deps).
- Do **not** require a server or ffmpeg.wasm for v3.0.
- Optional normalize after mono (same caps as record: target peak 0.95, max 8×, skip if peak ≥ 0.90) — **recommended for voice consistency**, applied after mono so peak reflects the mono mix.
- If the container has video but decode yields no usable audio → toast `This video has no audio track.`; keep muted preview if possible; do not call `setBuffer`.
- If codec unsupported → `This video codec is unsupported.` or generic `Couldn't read this file. Try a different format.`
- While decoding: inline spinner/progress on drop zone — must not look frozen.

**`toMonoBuffer` contract**

```js
// Input: AudioBuffer (1..N channels)
// Output: new AudioBuffer with numberOfChannels === 1, same length & sampleRate
function toMonoBuffer(src) {
  if (src.numberOfChannels === 1) return cloneOrReturnMono(src);
  const out = audioCtx.createBuffer(1, src.length, src.sampleRate);
  const dest = out.getChannelData(0);
  const chans = Array.from({ length: src.numberOfChannels }, (_, c) => src.getChannelData(c));
  for (let i = 0; i < src.length; i++) {
    let sum = 0;
    for (let c = 0; c < chans.length; c++) sum += chans[c][i];
    dest[i] = sum / chans.length;
  }
  return out;
}
```

**Acceptance (MP4 → mono)**

- [ ] User can pick or drop a `.mp4` file from the file picker and drag-drop zone
- [ ] After load, `S.buffer.numberOfChannels === 1`
- [ ] Stereo AAC-in-MP4 produces audible mono mix (both L/R content present, not left-only)
- [ ] Mono AAC-in-MP4 loads without error and stays 1 channel
- [ ] Waveform + Play work on the extracted mono buffer
- [ ] Export WAV/MP3 is mono (or multi-channel only if encoder requires duplicate mono — prefer true mono when format allows)
- [ ] Video preview (if shown) does not feed audio into the Web Audio graph (muted element; audio only from buffer + FX)

#### 4.1.4 Video-origin optional preview

When source is video (including MP4):

1. Keep `S.videoBlobUrl = URL.createObjectURL(file)`
2. Extract `S.videoMeta = { name, type, duration, width, height, fps }`
3. Show muted `<video playsinline>` above waveform (~160px), synced to playhead
4. Audio-only sources hide the video element
5. Preview is **visual only** — `video.muted = true`; all heard audio comes from the mono Web Audio buffer (so FX stay consistent)

Revoke previous Blob URL on new source or Reset Project.

---

### 4.2 Waveform & Simple Transport (no audio editor/cutter)

**In scope**

- Waveform canvas (display only for shape of audio; height ~0–220px)
- Playhead indicator; **click on waveform to seek** (no drag-to-select region)
- Time chip: `current / duration` as `m:ss.cs`
- **Play / Pause** (`Space`)
- **Stop** (pause + playhead → 0)
- **Loop** toggle
- **Skip cluster:** −10s / −5s / +5s / +10s always when a buffer exists
- **Frame ◀ / ▶:** shown **only** when `S.videoMeta` is present (video-origin source); hidden for mic recordings and audio-only uploads. Keyboard `,` / `.` are no-ops (or ignored) when frame controls are hidden
- Mobile collapse: `[−5] [▶] [+5] [⋯]` — overflow includes ±10s; frame steps only if video meta exists
- **Apply FX** (offline bake) and **Reset FX** (restore defaults / deselect preset)
- Live level meter during playback optional (nice-to-have)

**Explicitly out of scope (removed from product)**

| Removed tool | Rationale |
|---|---|
| Drag-to-select region | Editor surface; not needed for voice change |
| Trim | Editor |
| Delete selection | Editor |
| Reverse (buffer tool) | Editor surgery; reverse as **FX toggle** remains in Pitch & Formant |
| Duplicate Tail | Editor |
| Clear buffer (as separate tool) | Covered by Replace confirm + Reset Project |
| Undo / Redo for buffer edits | No buffer surgery |
| Selection time chips | No selection model |
| Append / Insert at playhead | Single-buffer model |

**Transport enabled states**

| Control | Enabled when | Disabled when |
|---|---|---|
| Play / Pause | buffer exists | no buffer, or baking |
| Stop | buffer exists | no buffer |
| Loop | buffer exists | no buffer |
| Skip / Frame | buffer exists | no buffer, or baking |
| Apply FX | buffer exists and FX ≠ defaults | no buffer, baking, or FX already at defaults |
| Reset FX | FX ≠ defaults (or always allowed no-op) | optional: when already at default |
| Export | buffer exists | no buffer, or baking |
| Save settings | always | never (library is independent of buffer) |
| Record | always (if supported) | unsupported browser / active bake |
| Upload | always | active bake |

#### Skip behavior (retained from v2.1)

```js
function skip(deltaSec) {
  if (!S.buffer) return;
  const wasPlaying = S.playing;
  const newTime = Math.max(0, Math.min(S.buffer.duration, S.playhead + deltaSec));
  S.playhead = newTime;
  if (wasPlaying) startPlayback();
  else { drawWave(); updateTimeChip(); syncVideo(); }
}

function frameStep(dir) {
  const fps = S.videoMeta?.fps || 30;
  skip(dir * (1 / fps));
}
```

- Clamp `0..duration`; edge toast once per ~1s: `Start of track` / `End of track`
- Long-press skip: repeat every 200ms, accelerate after 1.5s
- Keyboard: `←`/`J` −5s, `Shift+←`/`Shift+J` −10s, `→`/`L` +5s, `Shift+→`/`Shift+L` +10s, `,`/`.` frame, `Home`/`0` start, `End` end, `Space` play/pause
- Guard: no shortcuts when `INPUT` / `TEXTAREA` / `[contenteditable]` / range focused
- Skip during bake: disabled

---

### 4.3 Voice Changer — FX Lab (retained in full)

Live preview via `buildFxChain()`, identical for playback and offline bake — **WYSIWYE** (What You Hear Is What You Export).

| Group | Parameters |
|---|---|
| Pitch & Formant | pitchSemi ±12st, formant ±12st, Reverse toggle |
| Time & Speed | speed, fadeIn/out, sampleRateCrush, bitcrush |
| Filters | bandpass (freq, Q, mix), lowpass, highpass, bass/mid/treble, distortion, ringFreq, noiseMix |
| Space | reverbMix, reverbSize, reverbDecay, delayTime/Feedback/Mix |
| Modulation | chorus, flanger, tremolo, vibrato (rate/depth/mix) |
| Dynamics | gain, compressorThresh/Ratio |

**Behavior**

- All sliders show live numeric value next to the label
- **Live preview:** always uses `buildFxChain()` during playback (no bake required to hear the voice)
- **Bake (Apply FX):** optional offline render into the buffer via OfflineAudioContext with `tailSeconds = reverbDecay + delayTime + 0.5`, then bitcrush/SR-crush/fade, then anti-clip peak limiter at **0.89**. After bake, treat buffer as the new dry source and reset FX UI to defaults (or leave wet values — **decision: after successful bake, reset `S.fx` to `defaultFx` and clear active preset/custom** so a second bake does not double-process). Toast: `FX applied to clip.`
- During bake: spinner, disable Play / Export / Skip until complete
- **Reset FX:** restore `defaultFx`, deselect any active built-in or custom preset highlight, mark state dirty for persistence write
- Manually adjusting a slider after loading a preset: mark preset as **(edited)** or deselect card — UI must not claim an unmodified preset when values have drifted
- **Export always wet:** if FX ≠ defaults, export renders through the live chain (or uses already-baked buffer if user baked and FX was reset). Never export a dry buffer while non-default FX are active
- **Prep without audio:** presets, custom load/save, and FX Lab are fully usable with no buffer; Play / Skip / Export / Apply FX stay disabled until a buffer exists (see §19.1)

---

### 4.4 Built-in Presets (retained)

- Grid of ~16 voice presets: e.g. Deep, Chipmunk, Radio, Robot, etc.
- Shape: `{ id, name, emoji, desc, fx: { ... } }`
- Apply → `S.fx = { ...defaultFx, ...p.fx }`, rebuild panel, set `activePresetId`, clear `activeCustomId` (or vice versa for customs)
- Selected card: visible active state (border + non-color-only indicator)
- Built-in presets are **read-only** (cannot overwrite); users create **custom** entries via Settings Manager (§5)

---

### 4.5 Custom Settings Manager (required — new)

See **§5** for full specification. Summary:

- Save current FX as a named custom setting
- Load, rename, overwrite, delete customs
- List customs separately from built-ins (or unified grid with “Custom” badge)
- All customs stored in localStorage as part of the persistence model (§6)

---

### 4.6 Export

- **WAV:** `bufferToWav()` → Blob → `voxclip-{timestamp}.wav`
- **MP3:** lamejs (CDN), `Mp3Encoder(channels, sampleRate, 192kbps)`, chunked; fallback toast if library fails
- Export disabled when no buffer; tooltip `Record or upload audio first`
- Success toast: `Exported voxclip-….wav` / `…mp3`
- Unbaked FX applied automatically at export

---

### 4.7 Reset Project

- Clears: audio buffer, playhead, recording state, video Blob URL + meta, FX to defaults, active preset IDs, undo of any ephemeral UI flags
- **Does not** delete the user’s **saved custom settings** list (those are user library, not project state)
- **Does** reset session UI flags that are project-scoped (e.g. last playhead, last source name)
- Confirmation: `This clears your current audio and FX. Saved custom settings are kept. Continue?`
- Optional secondary action in Settings: **Clear all saved data** (customs + preferences) — see §6.5

---

### 4.8 PWA / Offline

- Dynamic manifest, service-worker cache, offline pill, lazy-loaded lamejs
- Offline first-load: MP3 may fail gracefully; WAV still works with clear toast

---

## 5. Custom Settings Manager

### 5.1 Problem

Built-in presets are fixed. Power users dial in multi-parameter FX and lose them on refresh or when switching presets. They need a first-class **save / load / manage** flow for personal voice profiles.

### 5.2 Goals

1. Save the **entire current FX object** under a user-chosen name
2. Load a custom setting in one tap (same as applying a built-in preset)
3. Rename, overwrite, and delete without account/backend
4. Survive browser restarts via localStorage
5. Stay simple on mobile (thumb-friendly list + confirm dialogs)

### 5.3 UI

**Entry points**

1. Button **Save settings** in FX Lab header / near Apply FX  
2. Section **My settings** (or tab) next to / below built-in presets grid  
3. Optional gear → Settings panel includes “Manage custom settings”

**Save flow**

1. User taps **Save settings**
2. Modal / sheet: name field (prefill: active custom name if editing, else empty; placeholder `e.g. Streamer Villain`)
3. If name collides with existing custom → offer **Overwrite** or force rename
4. On confirm: write to storage, toast `Saved “{name}”`, select that custom as active, refresh list

**Load flow**

1. User taps a custom card/row
2. `S.fx = { ...defaultFx, ...custom.fx }`, rebuild panel, set `activeCustomId`, clear `activePresetId` (built-in highlight)
3. Live chain rebuilds immediately if playing

**Manage actions (per item)**

| Action | Behavior |
|---|---|
| Load | Apply FX (default tap) |
| Rename | Modal; unique name check |
| Overwrite with current | Confirm; replace `fx` blob with current `S.fx` |
| Delete | Confirm: `Delete “{name}”? This can’t be undone.` |

**Empty library state**

- Copy: `No saved settings yet. Tweak the FX Lab, then tap Save settings.`
- Primary CTA: **Save settings** (disabled if no meaningful FX change optional — product may allow saving defaults)

### 5.4 Data model

```ts
type FxSettings = Record<string, number | boolean>; // matches defaultFx keys

type CustomSetting = {
  id: string;           // uuid or nanoid
  name: string;         // 1–40 chars, unique among customs (case-insensitive)
  fx: FxSettings;       // full partial or full override vs defaultFx
  createdAt: number;    // epoch ms
  updatedAt: number;    // epoch ms
  emoji?: string;       // optional, user or auto
};
```

**Validation**

- Name: trim, length 1–40, no empty; reject only-whitespace
- FX: merge with `defaultFx` on load so unknown keys from older versions are ignored and new keys get defaults
- Max customs: **50** (soft cap); toast if exceeded: `Limit of 50 custom settings reached. Delete one to save another.`

### 5.5 Acceptance criteria

- [ ] User can save current FX under a new unique name and see it in My settings after reload
- [ ] Loading a custom restores all parameters (within float tolerance) and rebuilds the lab UI
- [ ] Overwrite updates `fx` and `updatedAt` without changing `id`
- [ ] Delete removes from list and localStorage; if it was active, deselect and leave current `S.fx` as-is (or reset — prefer leave as-is)
- [ ] Built-in presets are never overwritten by Save settings
- [ ] Name collision is handled with explicit overwrite or rename
- [ ] Works fully offline
- [ ] Screen-reader labels and keyboard access for save modal and list actions

---

## 6. localStorage Persistence Model

### 6.1 Principle

**Settings and UI status are managed by browser localStorage**, including custom FX settings. Audio buffers are **not** persisted (too large / private); only lightweight state.

### 6.2 Storage key namespace

Use a single versioned root key to avoid collisions and enable migrations:

```
localStorage key: "voxclip.studio.v3"
```

```ts
type PersistedState = {
  version: 3;
  // Preferences / UI status
  ui: {
    loop: boolean;
    skipIntervalSec: 1 | 3 | 5 | 10;
    lastExportFormat: "wav" | "mp3";
    advancedLabExpanded: boolean;
    presetsSection: "built-in" | "custom";
    // theme: omitted in v3.0 — ship a single dark studio theme; add theme + persist only if light mode ships later
    // playhead is session-only (no buffer) — do not persist playhead
  };
  // Last-used FX (so refresh keeps the dialed voice even without Save)
  fx: FxSettings;
  activePresetId: string | null;
  activeCustomId: string | null;
  // User library
  customSettings: CustomSetting[];
  // Meta
  updatedAt: number;
};
```

### 6.3 What is persisted vs not

| Data | Persist? | Notes |
|---|---|---|
| Custom settings library | **Yes** | Core requirement |
| Current FX parameters | **Yes** | Last-used voice character |
| Active built-in / custom IDs | **Yes** | UI highlight restore |
| Loop, skip interval, lab expanded, last export format | **Yes** | UI status |
| Audio buffer / recording | **No** | Memory + privacy; user re-records or re-uploads |
| Video Blob URL | **No** | Session only; revoke on unload/reset |
| Playhead | **No** | Meaningless without buffer |
| Undo stacks | **N/A** | Removed with editor |

### 6.4 Read / write rules

1. **On load:** `JSON.parse(localStorage.getItem(KEY))` → migrate if needed → apply to `S` and UI before first paint of FX panel when possible (avoid flash of defaults)
2. **On change (debounced 300ms):** write full `PersistedState` snapshot after FX slider moves, preset apply, custom save/delete, loop toggle, etc.
3. **Atomicity:** write one JSON blob; optional `try/catch` for `QuotaExceededError`
4. **Corruption:** if parse fails, backup raw string under `voxclip.studio.v3.bak` if possible, then reset to defaults and toast `Settings were reset (storage was unreadable).`
5. **Migration:** if `version < 3`, map known fields; drop unknown; set `version: 3`

### 6.5 User-facing storage controls

In a simple **Settings** (gear) panel:

| Control | Effect |
|---|---|
| Skip interval | 1 / 3 / 5 / 10 s → persists |
| Export default format | WAV / MP3 preference |
| **Export custom settings** | Download JSON of `customSettings` (portability) |
| **Import custom settings** | Merge or replace library from JSON file |
| **Clear saved settings** | Confirm → wipe customs + UI prefs + last FX; keep app usable |
| Reset Project | Project only; keeps custom library (§4.7) |

### 6.6 Privacy note (persistence)

- localStorage holds only FX numbers/booleans, names, and UI flags — **never** audio samples
- Cleared if user clears site data; document this in About / Privacy blurb
- No cross-origin or third-party storage

### 6.7 Acceptance criteria

- [ ] Reload page after adjusting FX → same FX values and active preset/custom highlight
- [ ] Reload after saving customs → library intact
- [ ] Loop and skip interval survive reload
- [ ] Reset Project does **not** wipe custom library
- [ ] Clear saved settings wipes library + prefs after confirm
- [ ] Quota / parse errors degrade with toast, not a white screen
- [ ] Import/export JSON round-trip preserves custom FX within tolerance

---

## 7. UX Wireframes

### 7.1 Main layout (desktop)

```
┌─────────────────────────────────────────────────────────────┐
│ VoxClip Studio          [Offline pill]        [⚙ Settings]  │
├─────────────────────────────────────────────────────────────┤
│ SOURCE                                                      │
│  [ ● Record ]   [ Upload ]                                  │
│  ┌ Drop zone: WAV · MP3 · AAC · M4A · MP4 · MOV · WebM ┐   │
│  └─────────────────────────────────────────────────────┘   │
├─────────────────────────────────────────────────────────────┤
│ [Video preview if video source — muted, playsinline]        │
│ Waveform canvas (playhead; click to seek)                   │
│ timeChip  0:12.30 / 1:04.00                                 │
│ [−10] [−5] [ ▶ Play ] [+5] [+10] [Frame◀▶ if video] [⏹] [Loop]│
│              [ Apply FX ]  [ Reset FX ]                     │
├─────────────────────────────────────────────────────────────┤
│ PRESETS          [ Built-in | My settings ]                 │
│ [Deep] [Chipmunk] [Radio] ...   |  [Streamer Villain] ...   │
│                    [ 💾 Save settings ]                     │
├─────────────────────────────────────────────────────────────┤
│ ADVANCED LAB (collapsible)                                  │
│  Pitch & Formant | Time | Filters | Space | Mod | Dynamics  │
│  sliders with live numeric values                           │
├─────────────────────────────────────────────────────────────┤
│ EXPORT   [ WAV ]  [ MP3 ]                                   │
│ Footer: All processing stays on your device.                │
└─────────────────────────────────────────────────────────────┘
```

### 7.2 Empty state (no audio)

```
[ Drop zone / Record primary CTA / Upload secondary ]
Helper: "Pick a voice, then record or upload"
Transport + Export + Apply FX disabled until buffer exists
Presets + My settings + FX Lab fully interactive (prep path, §19.1)
Save settings enabled (library does not require a buffer)
```

### 7.3 Mobile

```
[Record] [Upload]
[Video?]
[Waveform]
[−5] [▶] [+5] [⋯]
[Presets tabs]
[Save settings]
[Lab accordion]
[Export]
```

### 7.4 Save settings modal

```
┌ Save voice settings ─────────────┐
│ Name: [________________]         │
│ [ Cancel ]  [ Save ]             │
│ (If exists: [ Overwrite ])       │
└──────────────────────────────────┘
```

---

## 8. Technical Implementation Plan

### 8.1 Remove / gate editor surface

1. Remove or hide UI and handlers for: Trim, Delete selection, Reverse (tool), Duplicate Tail, Clear, Undo, Redo, selection drag, Append, Insert at playhead
2. Simplify pointer handlers on canvas to **seek only** (mousedown/touch → playhead)
3. Remove selection state from `S` (`selStart`, `selEnd`, etc.)
4. Keep buffer helpers needed for ingest/FX: `toMonoBuffer`, `normalizeRecordingBuffer`, `cloneBuffer` (for bake safety); drop `concatBuffers`/`sliceBuffer` if unused

### 8.2 Recorder & uploader

1. Record path: getUserMedia → MediaRecorder → decode → **`toMonoBuffer`** → normalize → `setBuffer(buf)`
2. Upload / drop (including **`.mp4`**):
   - Detect video via MIME (`video/mp4`, etc.) and/or extension (`.mp4`, `.mov`, `.m4v`, …)
   - If video: create Blob URL + load `videoMeta` for muted preview
   - `arrayBuffer()` → `decodeAudioData()` (extracts audio track from MP4)
   - **`toMonoBuffer(decoded)`** — hard requirement; project buffer is always mono
   - Optional: `normalizeRecordingBuffer(mono)` for consistent loudness
   - Replace-confirm if buffer exists → `setBuffer(monoBuf)`
3. File input `accept` must include `.mp4` and `video/mp4` explicitly (not only `audio/*`)
4. Feature-detect mic support on boot
5. Unit-test / assert after every ingest: `buffer.numberOfChannels === 1`

### 8.3 Voice FX (unchanged chain)

1. Keep `defaultFx`, `buildFxChain()`, bake path, limiter, presets grid
2. Wire Reset FX to deselect built-in + custom active IDs
3. Slider edits → mark active preset dirty / deselect + schedule persist

### 8.4 Custom Settings Manager

1. CRUD helpers: `listCustoms()`, `saveCustom(name, fx)`, `loadCustom(id)`, `renameCustom`, `deleteCustom`, `overwriteCustom`
2. UI list + modal
3. Merge on load: `{ ...defaultFx, ...stored.fx }`

### 8.5 Persistence layer

```js
const STORAGE_KEY = "voxclip.studio.v3";

function loadPersisted() { /* parse, migrate, return PersistedState | defaults */ }
function savePersisted(partial) { /* merge into snapshot, debounce write */ }
function clearPersisted() { localStorage.removeItem(STORAGE_KEY); }
```

1. Call `loadPersisted()` early in boot; apply `fx` / UI before binding listeners
2. Debounced save on FX/UI/custom mutations
3. Settings panel: import/export JSON, clear all

### 8.6 Accessibility hooks

- `aria-label` on all icon-only controls
- `aria-live="polite"` for toasts
- Focus trap in save/settings modals
- `:focus-visible` styles

### 8.7 Video sync & skip

Retain v2.1 skip + video preview implementation details from prior PRD (syncVideo, frameStep, keyboard map).

---

## 9. Testing Plan

### Unit / pure logic

- Normalize: peak 0.23 → gain ~4.13, cap 8×, skip when peak ≥ 0.90
- `skip()` clamps; `frameStep` uses fps fallback 30
- Custom save: unique names, max 50, merge defaults on load
- Persistence migrate v0/corrupt → safe defaults
- FX merge: missing keys filled from `defaultFx`

### Manual matrix

| Scenario | Expected |
|---|---|
| iOS Safari record | Normalized loudness, no clip |
| Upload stereo MP4 (AAC) | Decodes; **mono** buffer (`numberOfChannels === 1`); both channels mixed; waveform + play work |
| Upload mono MP4 / M4A | Loads as mono; no error |
| Upload .mp4 via picker on iOS | File chooser accepts MP4 from Photos/Files |
| Drop .mp4 on zone | Same mono extract path as button upload |
| MP4 video preview | Muted; heard audio is mono Web Audio only |
| Play / Pause / click-seek | Correct playhead, no selection UI |
| No Trim/Delete/Undo visible | Editor controls absent |
| Apply built-in preset | FX match; card active |
| Save custom → reload → load custom | Identical FX |
| Overwrite / rename / delete custom | Storage + UI consistent |
| Reset Project | Buffer/FX cleared; customs remain |
| Clear saved settings | Customs + prefs gone |
| Export unbaked FX | File matches live sound |
| Offline MP3 | Graceful toast; WAV works |
| Keyboard-only flow | Record/upload → FX → export |
| Screen reader (VoiceOver/NVDA) | Labels + live regions |
| Rapid skip while playing | No double audio |
| Storage full (mock QuotaExceeded) | Toast; app still runs |
| Prep FX with no buffer, then record | Live playback uses pre-selected preset/custom immediately |
| Apply FX then Apply again | Second Apply disabled (FX at defaults post-bake) |
| Audio-only source | Frame buttons hidden; ±5/±10 still work |
| Video source | Frame buttons visible; frame step uses detected fps |
| Replace with buffer loaded, cancel confirm | Old buffer retained |

---

## 10. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Users expect trim/cut from v2.x | Onboarding note / changelog: “v3 focuses on voice change; edit in your DAW if needed.” Keep waveform seek + skip for navigation |
| localStorage quota / private mode | try/catch; in-memory fallback for session; toast on failure |
| Corrupted JSON | Backup key + reset to defaults |
| Accidental replace of buffer | Confirm when replacing non-empty audio |
| Accidental delete of custom | Confirm dialog; optional export JSON before bulk clear |
| Built-in vs custom confusion | Tabs + badges; Save never overwrites built-ins |
| Video codec unsupported | Specific toasts; keep preview when possible |
| lamejs CDN offline | WAV always available |
| Scope creep back into DAW | Non-goals enforced; no selection model in state |

---

## 11. Accessibility

- Descriptive `aria-label`s on Record, Upload, Play/Pause, Skip, Loop, Apply FX, Save settings, Export, Settings
- Full keyboard operability + dedicated shortcuts (§4.2)
- Visible `:focus-visible` rings; no outline suppression
- Color never sole state signal (active preset/custom: border + checkmark or “Active” text)
- Toasts via `aria-live="polite"`
- Sliders: `aria-valuenow` / `aria-valuetext` with numeric values
- Min tap target 36×36px
- Modals: focus trap, Escape to close, return focus to opener
- Target: zero critical axe issues + manual SR pass before release

---

## 12. Browser / Device Support Matrix

| Browser | Record | Upload audio | Upload video | WebM | MP3 export | localStorage |
|---|---|---|---|---|---|---|
| Chrome desktop/Android | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Safari macOS/iOS | ✅ (mime fallback) | ✅ | ✅ | ⚠️ toast | ✅ lamejs | ✅ |
| Firefox desktop | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Firefox Android | ⚠️ verify mime | ✅ | ✅ | ✅ | ✅ | ✅ |
| Private / strict mode | ✅ | ✅ | ✅ | — | ✅ | ⚠️ may fail write — toast |

Re-verify each release.

---

## 13. Performance Budgets

- Seek / skip: **&lt;16ms**
- Waveform render: **&lt;500ms** for up to 1 hour audio
- Live FX slider tweak: no audible dropout mid-playback
- Apply FX bake: progress UI; target **&lt;5s** for 5-minute buffer on mid-tier hardware; never appear frozen
- Persisted state write: debounced; must not block audio thread
- App shell: interactive **&lt;2s** mid-tier mobile first load; instant on SW cache hit

---

## 14. Privacy & Data Handling

- All audio processing client-side; **no** upload of audio to servers
- localStorage: FX parameters, UI flags, custom setting **names** only — no audio samples
- Blob URLs session-local; revoked on replace/reset
- No analytics payload may include audio content or sensitive filenames
- In-app privacy line: `All processing stays on your device.`
- User can clear site data or use in-app **Clear saved settings**

---

## 15. Success Metrics

Privacy-respecting, interaction-only (if instrumented):

- **Task completion:** % sessions that export after record or upload
- **Time-to-first-export** median
- **Custom settings adoption:** % sessions that save or load a custom ≥1
- **Return persistence:** % return visits that load with non-default FX from storage
- **Error recovery:** % of toast sessions that still export
- **Accessibility:** zero critical audit issues; keyboard + SR pass

---

## 16. Error & Empty States Catalog

| Trigger | Message |
|---|---|
| Mic permission denied | Microphone access is blocked. Enable it in your browser settings to record. |
| Recording too short | Recording too short — try again. |
| Unsupported video codec | This video codec is unsupported. |
| Video has no audio | This video has no audio track. |
| Generic decode failure | Couldn't read this file. Try a different format. |
| Unsupported drop type | Couldn't read this file. Try a different format. |
| Large file | Large file — this may take a moment to decode. |
| Replace buffer (record) | Replace current audio with this recording? Your current clip will be discarded. |
| Replace buffer (upload) | Replace current audio with this file? Your current clip will be discarded. |
| FX applied (bake) | FX applied to clip. |
| Apply FX nothing to do | Nothing to apply |
| Skip past start | Start of track |
| Skip past end | End of track |
| MP3 encoder unavailable | MP3 export isn't available right now — try WAV instead. |
| Export success | Exported voxclip-….wav / …mp3 |
| No buffer export | Record or upload audio first |
| Browser no recording | Recording isn't supported in this browser — try uploading a file instead. |
| Custom saved | Saved “{name}” |
| Custom name empty | Enter a name for your settings. |
| Custom name collision | A setting named “{name}” already exists. Overwrite it? |
| Custom limit | Limit of 50 custom settings reached. Delete one to save another. |
| Delete custom confirm | Delete “{name}”? This can’t be undone. |
| Reset Project confirm | This clears your current audio and FX. Saved custom settings are kept. Continue? |
| Clear all saved confirm | Clear all saved settings and preferences on this device? This can’t be undone. |
| Storage unreadable | Settings were reset (storage was unreadable). |
| Storage quota | Couldn't save settings — browser storage is full. |
| Import invalid JSON | Couldn't import settings. Check the file and try again. |

---

## 17. Migration from v2.x

| Topic | Action |
|---|---|
| Editor tools | Remove from UI and code paths; no migrate needed |
| Users who relied on trim | Document workaround: edit externally, then upload |
| Session-only skip interval | Now persisted in localStorage |
| Existing local data | If any v2 keys exist, ignore or one-way map UI prefs only |
| Product messaging | Version badge / About: “Voice Changer Studio” |

No server migration. No audio migration.

---

## 18. Roadmap

- **v2.0 (Done):** Normalization, MP4 support, Reset Project  
- **v2.1 (Specified):** Backward/Forward + video preview  
- **v2.2 (Done as spec quality):** A11y, errors, matrix, metrics  
- **v3.0 (This PRD):** Voice changer focus; remove editor/cutter; recorder + uploader; full FX retained; Custom Settings Manager; localStorage for settings + UI status  
- **v3.1 (Future):** Import/export packs of customs; optional FX-only undo; waveform zoom  
- **v3.2 (Future):** WebCodecs mux “export audio into MP4”; A/B dry vs wet toggle  
- **Later:** AI denoise / transcription (optional, still client-side if possible)

---

## 19. Decided Product Rules

Former open questions, locked for v3.0 implementation. Revisit only with user feedback evidence.

### 19.1 Prep FX before audio — **Yes**

| Rule | Detail |
|---|---|
| Decision | Presets, My settings, Save settings, and Advanced Lab work **with or without** a loaded buffer |
| Why | Users often want to pick “Deep Voice” *then* hit Record; blocking the lab until audio feels broken |
| Enabled without buffer | Built-in presets, custom load/save/manage, all FX sliders, Reset FX, Settings gear |
| Disabled without buffer | Play / Pause / Stop / Loop / Skip / Frame / Apply FX / Export |
| Preview | Silent until a buffer exists; after record/upload, live chain uses whatever FX is already dialed |
| Helper copy | Empty state: `Pick a voice, then record or upload` |

### 19.2 Apply FX bake vs export — **Keep both; export always wet**

| Rule | Detail |
|---|---|
| Decision | **Live preview** always. **Export** always renders wet FX when parameters ≠ defaults. **Apply FX** remains an optional bake that commits wet audio into the buffer |
| Why | Casual users export once and never need bake. Power users bake to stack a second character or re-export dry+wet workflows without re-selecting presets |
| After successful bake | Reset `S.fx` → `defaultFx`, clear active preset/custom highlight, toast `FX applied to clip.` Prevents accidental double-processing on a second bake |
| Apply FX disabled when | No buffer, or already baking, or FX already equals defaults (button disabled + tooltip `Nothing to apply`) |
| Export | Never writes a dry file while non-default FX are active; no separate “export dry” in v3.0 |

### 19.3 Max custom settings — **50 hard cap for v3.0**

| Rule | Detail |
|---|---|
| Decision | Soft product limit of **50** named customs; block save beyond 50 with toast |
| Why | Enough for streamer/podcaster libraries; bounds localStorage size and list UI on mobile |
| UX when full | `Limit of 50 custom settings reached. Delete one to save another.` Prefer delete/overwrite over raising the cap |
| Later | Raise cap or add folders only if users hit the limit in real use; import/export JSON already mitigates portability |

### 19.4 Theme persistence — **Omit in v3.0**

| Rule | Detail |
|---|---|
| Decision | Ship a **single dark studio theme**. Do **not** add `theme` to `PersistedState.ui` in v3.0 |
| Why | No dual-theme design in scope; empty fields invite incomplete light-mode bugs |
| Later | If light/system theme ships, add `ui.theme: "dark" \| "light" \| "system"` and persist it then |

### 19.5 Replace source confirm — **Always when buffer exists**

| Rule | Detail |
|---|---|
| Decision | Any new **Record (after Stop)** or **Upload/drop** that would replace a non-empty buffer requires confirm |
| Copy (record) | `Replace current audio with this recording? Your current clip will be discarded.` |
| Copy (upload) | `Replace current audio with this file? Your current clip will be discarded.` |
| Why | One rule, no “duration &gt; N” or “FX dirty” edge cases; safest on touch devices |
| No confirm when | Buffer is empty / no project audio loaded |
| Note | Confirmation runs **before** committing the new buffer (for upload: after decode success is OK if we show a short “decoded” state; for record: after stop+normalize, before `setBuffer`). Discard the new clip if user cancels |

### 19.6 Frame step visibility — **Video-origin only**

| Rule | Detail |
|---|---|
| Decision | Frame ◀ / ▶ controls visible **only** when `S.videoMeta` is set. Second-based skip (±5 / ±10) always available when a buffer exists |
| Why | Frame step is for lip-sync / video scrubbing; meaningless (and noisy) for pure voice recordings |
| Keyboard | `,` / `.` (and `Shift` variants if any) active only when frame controls are shown |
| Audio-only / mic | Hide frame buttons entirely; do not show disabled stubs |

---

## 20. Glossary

| Term | Meaning |
|---|---|
| Buffer | Decoded `AudioBuffer` currently loaded for play/FX/export |
| Bake / Apply FX | Offline render of live FX into the buffer |
| Playhead | Current playback position (seconds) |
| WYSIWYE | What you hear is what you export — same FX chain for preview and export |
| Built-in preset | Ship-defined read-only voice recipe |
| Custom setting | User-named saved FX blob in localStorage |
| UI status | Non-audio prefs: loop, skip interval, panels, last export format, active IDs |
| Replace source | New record/upload overwrites the single project buffer |
| Clamp | Constrain playhead to `[0, duration]` |
| Frame step | Skip of one video frame (`1/fps`) when video metadata exists |

---

## 21. Appendix

### 21.1 Requirement traceability (user request → PRD)

| User requirement | PRD sections |
|---|---|
| 1. Voice recorder and uploader | §4.1 |
| 2. Remove audio editor/cutter; only play/pause/waveform | §4.2, §2 Non-Goals, §8.1 |
| 3. Retain all voice changer functions | §4.3, §4.4 |
| 4. Voice changer custom settings manager (save/load) | §5 |
| 5. Settings + UI status in localStorage (incl. customs) | §6 |
| 6. New PRD | This document v3.0 |

### 21.2 Review notes on v2.2 (inputs to v3.0)

**Strengths kept**

- Thorough ingest, normalization, video decode edge cases  
- Skip/keyboard/video sync specification quality  
- Accessibility, error catalog, browser matrix, privacy, performance  
- WYSIWYE FX model and bake details  

**Gaps addressed in v3.0**

- Product identity mixed “editor” vs “voice change” — **resolved by pivot**  
- No user-defined presets / save-load of FX  
- No durable UI/settings persistence model  
- Selection/trim complexity for users who only want a voice effect  
- Open question on localStorage skip interval — **promoted to required persistence**  
- Append/Insert multi-clip over-scoped for voice-first JTBD  

**Explicit removals vs v2.2**

- Timeline editing tool row and selection model  
- Undo/Redo buffer stacks  
- Duplicate Tail open question (feature removed)  
- “Audio editor” language in positioning  

### 21.3 Suggested file layout (still single-file OK)

```
voxclip-studio.html    # app (or split later)
voxclip-studio-prd-v3.0.md
```

If splitting JS later: `persist.js`, `fx.js`, `customs.js`, `transport.js` — optional, not required for v3.0.

---

*End of PRD v3.0*
