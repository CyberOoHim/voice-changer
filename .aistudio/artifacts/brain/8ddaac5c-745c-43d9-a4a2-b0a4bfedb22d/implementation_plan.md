# VoxClip Studio — Audio Cut, Trim & Region Selection Suite

This plan introduces a studio-grade **Audio Cut, Trim & Region Selection Suite** directly into VoxClip Studio's Waveform & Transport dock, enabling non-destructive region auditioning, tactile In/Out drag handles on the waveform, click-free **Trim (Keep Selection)**, **Cut (Delete Selection)**, and **Auto-Trim Silence**—all integrated with the existing Undo/Redo buffer history.

## User Review & Critical Decisions

> [!IMPORTANT]
> Review the recommended design and workflow decisions below. Click **Proceed** to build or let me know if you'd like any adjustments:

- **Recommended Decision 1 — Complete Editing Suite (`Trim`, `Cut`, and `Trim Silence`)**:
  - **Trim (Keep Selection)**: Crops the audio clip to the selected `[In, Out]` region and discards outside audio.
  - **Cut (Delete Selection)**: Removes the selected `[In, Out]` region and seamlessly joins the surrounding audio segments together.
  - **Trim Silence**: Automatically detects and strips leading and trailing dead air/silence below `-45 dB` while preserving natural speech attack and release tails.
- **Recommended Decision 2 — Multi-Modal Region Selection (`Waveform Handles + Playhead Buttons + Time Inputs`)**:
  - **On-Canvas Drag Handles**: Drag directly on the waveform or grab the dedicated **In (`[`)** and **Out (`]`)** bracket handles ($44\text{px}$ touch hitboxes on iPad/mobile) to adjust selection boundaries visually.
  - **Playhead & Precision Controls**: Dedicated **`[ Set In`** and **`] Set Out`** buttons (and keyboard shortcuts `[` / `]`), numeric start/end time inputs (`tabular-nums`), and a **`Clear Selection`** action.
- **Recommended Decision 3 — Click-Free Zero-Crossing & Micro-Crossfade Splicing**:
  - Every **Trim** and **Cut** operation snaps to the nearest zero-crossing (within a `2 ms` window) and applies a `5 ms` equal-power micro-fade/crossfade at the edit boundary so edits never produce audible pops or clicks.
- **Recommended Decision 4 — Region Auditioning, Cue Snapping & Full Undo/Redo Integration**:
  - When a region is active, **Play** and **Loop** can audition the selected range, dragging handles near existing Cue Markers gently snaps to them, and every Trim/Cut/Silence operation pushes a full audio snapshot onto the **Undo / Redo** stack (`Ctrl+Z` / `Ctrl+Y`).

---

## 1. Overview & Core Concept

- **What It Does**: Empowers users to clean up recordings and uploaded clips directly inside the waveform dock—trimming out count-in delays, cutting out stumbles or coughs mid-sentence, or automatically stripping leading/trailing room silence before applying FX or exporting.
- **Target Audience / Persona**: Voice actors, podcasters, streamers, and mobile/iPad creators who need fast, sample-accurate audio editing without leaving VoxClip Studio for an external DAW.
- **Key Value**: Combines visual waveform region editing, tactile touch handles, and click-free DSP splicing with VoxClip Studio's real-time voice transformation pipeline.

---

## 2. User Experience & Visual Design

- **Key User Flows**:
  1. **Selecting a Region on the Waveform**:
     - Users can **Shift+Drag** (or toggle the **Select Region** tool for one-finger touch dragging on iPad/mobile) across the waveform canvas, or tap **`[ In`** and **`] Out`** while playing or paused to bracket a section.
     - The selected region highlights on the waveform canvas with a translucent Studio Cyan overlay (`rgba(56, 189, 248, 0.18)`), dimmed outside regions when previewing, and high-contrast vertical In/Out boundary bars with grab tabs at the top/bottom edges.
     - Dragging an In/Out handle near a Timeline Cue Marker (`#1`, `#2`, etc.) snaps cleanly to the marker timestamp.
  2. **Auditioning & Fine-Tuning the Selection**:
     - The **Cut & Trim Toolbar** displays the exact **`In`**, **`Out`**, and **`Selected Duration`** in `JetBrains Mono` (`tabular-nums`), with editable start/end inputs for `0.01s` precision.
     - Tapping **▶ Play Selection** (or standard Play when a selection is active) plays from `In` to `Out` (and loops between `In` and `Out` when **Loop** is enabled).
  3. **Executing Trim, Cut, or Silence Strip**:
     - Tapping **✂ Trim (Keep)** crops the buffer to `[In, Out]`, updates cue markers relative to the new start offset, rebuilds the FX preview and LUFS readout, and clears the selection.
     - Tapping **🗑 Cut (Remove)** excises `[In, Out]`, applies a `5 ms` micro-crossfade across the splice point, shifts downstream cue markers earlier by the removed duration, and updates the waveform.
     - Tapping **✨ Trim Silence** scans the clip from both ends, trims dead air below threshold with a smooth `15 ms` fade-in/out pad, and reports how much silence was removed via toast notification.
     - If the user wants to revert any edit, tapping **↶ Undo** (`Ctrl+Z`) immediately restores the pre-edit audio buffer, selection, and cue markers.

- **Visual Identity & Theme**:
  - *Aesthetic Direction*: Matches VoxClip Studio's **Pro Hardware Console** dark slate design (`--bg: #080d14`, `--bg2: #0f1622`, `--bg3: #162030`, `--border: #202d40`).
  - *Color Palette & Mood*:
    - **Active Region Fill**: Translucent cyan (`rgba(56, 189, 248, 0.18)`) bounded by `#22d3ee` `2px` vertical markers and tactile handle caps.
    - **Unselected Dimming**: Subtle dark scrim (`rgba(4, 10, 18, 0.45)`) outside the `[In, Out]` range so the kept/targeted audio stands out immediately.
    - **Destructive vs. Constructive Actions**: **Trim (Keep)** uses Studio Cyan accent styling; **Cut (Delete)** uses subtle Rose danger tinting (`--danger: #f43f5e`).
  - *Typography & Layout*:
    - Single-line button labels (`whitespace-nowrap`) with $\ge 44\text{px}$ touch hitboxes for iPad/mobile ergonomics.
    - Unboxed tabular numeral readouts (`0:01.24 – 0:04.80 · 3.56s selected`) using `JetBrains Mono`.

---

## 3. Key Product Decisions & Trade-Offs

- **Decision 1: Dual Pointer Interaction (Seek vs. Region Drag)**
  - *Chosen Approach*: Provide a dedicated **Selection Mode toggle (`⌸ Select` / `Pointer`)** alongside direct handle dragging and **`[ In` / `] Out`** buttons, plus `Shift + Drag` on desktop. Whenever a selection exists, grabbing within `18px` (or `24px` on touch) of the In or Out boundary line directly drags that handle without needing to switch modes.
  - *Why*: Preserves instant single-tap waveform seeking while making region creation effortless on both desktop mice and iPad/mobile touchscreens.
- **Decision 2: Zero-Crossing Snap + Equal-Power Micro-Crossfade**
  - *Chosen Approach*: Implement `trimAudioBuffer(buf, startSec, endSec)` and `cutAudioBufferRegion(buf, startSec, endSec)` inside the DSP engine (`VoxFx`) with automatic zero-crossing search ($\pm 2\text{ms}$) and a `5 ms` cosine micro-fade/crossfade.
  - *Why*: Raw sample-index slicing on speech waveforms almost always cuts mid-wavecycle, causing a sharp transient click that gets amplified by downstream distortion, compression, or vocoding.
- **Decision 3: Cue Marker & Undo History Synchronization**
  - *Chosen Approach*: Snapshot both `S.buffer` (`includeBuffer: true`) and `S.cueMarkers` / `S.selection` in `pushHistory()`, and automatically shift or prune cue markers when audio is trimmed or cut.
  - *Why*: Ensures timeline markers stay aligned with the actual spoken words after an edit and come back intact on Undo.

---

## 4. Technical Architecture & Data Strategy *(Technical Reference)*

- **Architecture & Signal Flow Diagram**:

```
┌───────────────────────────────────────────────────────────────────────────────────┐
│ WAVEFORM & TRANSPORT DOCK                                                         │
│                                                                                   │
│  ┌─────────────────────────────────────────────────────────────────────────────┐  │
│  │ Waveform Canvas (#wave)                                                     │  │
│  │  ░░░░░░░░░┃◄─── Selected Region [In .. Out] ───►┃░░░░░░░░░░░░░░░░░░░░░░░░░  │  │
│  │           ▲ Drag Handle (In)                    ▲ Drag Handle (Out)         │  │
│  └───────────┴─────────────────────────────────────┴───────────────────────────┘  │
│                                                                                   │
│  ┌─────────────────────────────────────────────────────────────────────────────┐  │
│  │ Cut & Trim Toolbar (#trimToolbar)                                           │  │
│  │  [⌸ Select]  [ In ]  [ Out ]   In: 0:01.20  Out: 0:03.85  (2.65s)           │  │
│  │  [▶ Play Sel]  [✂ Trim (Keep)]  [🗑 Cut (Delete)]  [✨ Trim Silence]  [×]   │  │
│  └──────────────────────┬───────────────────┬──────────────────┬───────────────┘  │
└─────────────────────────┼───────────────────┼──────────────────┼──────────────────┘
                          │                   │                  │
                          ▼                   ▼                  ▼
┌───────────────────────────────────────────────────────────────────────────────────┐
│ VOXFX BUFFER EDITING ENGINE (Client-Side DSP)                                     │
│                                                                                   │
│  1. pushHistory({ includeBuffer: true }) ──► Saves AudioBuffer + Cue Markers      │
│  2. Zero-Crossing Search (±2ms)          ──► Finds click-free sample boundaries   │
│  3. Buffer Operation:                                                             │
│     • trimBuffer(buf, inSec, outSec)     ──► Extracts [In..Out] + 5ms edge fades  │
│     • cutBufferRegion(buf, inSec, outSec)──► Splices [0..In] + [Out..End] w/ XFade│
│     • trimSilence(buf, threshDb, padSec) ──► Strips leading/trailing dead air     │
│  4. Rebuild Peak Pyramid & FX Preview    ──► Updates Waveform, Cue Markers & LUFS │
└───────────────────────────────────────────────────────────────────────────────────┘
```

- **Data Model & State Extensions**:
  - **Selection State in `S`**:
    - `selection`: `{ active: false, start: 0, end: 0 }` (in seconds, clamped to `[0, S.buffer.duration]`, where `start < end` and minimum span is `0.05s`).
    - `waveTool`: `'seek' | 'select'` (controls whether dragging on empty waveform seeks or draws a new selection range; dragging on existing In/Out handles always resizes the selection).
    - `draggingHandle`: `null | 'in' | 'out' | 'region' | 'new'` (tracks active pointer interaction on `#wave`).
  - **History Snapshot Extensions**:
    - Extend `snapshotHistory()` and `applyHistory()` to preserve `cueMarkers` and `selection` alongside `buffer` so undoing a Trim or Cut restores both the exact audio and any timeline markers.

- **Interactive Component & State Mapping**:
  - **Waveform Canvas (`#wave`)**:
    - Renders the selection overlay, In/Out handle grips, and duration badge when `S.selection.active` is true (across Waveform, Spectrum, and Spectrogram views).
    - Pointer handlers (`pointerdown`, `pointermove`, `pointerup`) detect handle hit-testing (within `16px` CSS pixels of `In` or `Out`), region Creation (`waveTool === 'select'` or `e.shiftKey`), cue marker magnetic snapping (within `8px`), and standard playhead seeking.
  - **Cut & Trim Toolbar (`#trimToolbar`)**:
    - **Select Mode Toggle (`#btnWaveSelectMode`)**: Toggles between tap-to-seek and drag-to-select on touch devices.
    - **Set In / Set Out (`#btnSetIn`, `#btnSetOut`)**: Sets `selection.start` or `selection.end` to the current `S.playhead` (auto-creating a valid selection if none exists). Hotkeys: `[` and `]`.
    - **Start / End Time Inputs (`#trimInInput`, `#trimOutInput`)**: Accepts seconds or `m:ss.cc` format to nudge boundaries with `0.01s` accuracy.
    - **Play Selection (`#btnPlaySelection`)**: Auditions `[selection.start, selection.end]` through the live FX chain.
    - **Trim / Keep (`#btnTrimKeep`)**: Calls `applyTrimSelection()` to crop the buffer to `[selection.start, selection.end]`.
    - **Cut / Delete (`#btnCutDelete`)**: Calls `applyCutSelection()` to remove `[selection.start, selection.end]` and splice the remaining segments. Hotkey: `Delete` / `Backspace` when a selection is active.
    - **Trim Silence (`#btnTrimSilence`)**: Calls `applyTrimSilence()` to strip leading/trailing silence from the clip.
    - **Clear Selection (`#btnClearSelection`)**: Resets `S.selection.active = false` (Hotkey: `Escape` when no modal is open).
