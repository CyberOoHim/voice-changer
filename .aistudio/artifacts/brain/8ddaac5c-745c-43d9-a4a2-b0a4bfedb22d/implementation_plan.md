# VoxClip Studio — iPad Touch Console UI Refinement & Visual Workflow Guidance

This plan transforms VoxClip Studio into a professional **iPad-first Touch Console** featuring a **Split Studio Deck** layout, an **Interactive 3-Step Workflow Banner** that visually guides users from capture to export, and a **Pro Hardware Console** aesthetic with oversized tactile touch faders and zero-scroll ergonomics.

## User Review & Critical Decisions

> [!IMPORTANT]
> The following architectural and UX decisions reflect your confirmed choices from our interactive review:

- **Confirmed Decision 1 — Split Studio Deck Architecture (`iPad Touch Ergonomics`)**: Replaces the long single-column scroll stack with an ergonomic 2-zone **Split Studio Deck** on iPad/desktop (`≥ 768px`)—pairing a persistent **Left Audio & Transport Dock** (Capture, Input Gain, Waveform/Spectrum Visualizer, and Play/A-B Transport) with a **Right Tabbed FX & Master Deck** (`Voice Presets` · `XY Morph & Cleanup` · `Advanced Lab` · `Export & Master`) so users never scroll up and down while tweaking voice effects.
- **Confirmed Decision 2 — Interactive 3-Step Workflow Banner (`Visual Guidance`)**: Adds a live, state-aware **3-Step Studio Stepper** (`1. Capture Voice` → `2. Transform & Sculpt` → `3. Master & Export`) at the top of the deck that automatically advances as the user loads/records audio and applies effects, paired with contextual focus rings and next-action callouts on primary controls.
- **Confirmed Decision 3 — Pro Hardware Console Aesthetic (`Tactile Touch Faders`)**: Upgrades the visual design to a precision dark slate hardware console (`#0b0f14` / `#111722` chassis, crisp `1px` structural hairlines, `Plus Jakarta Sans` + `JetBrains Mono` tabular readouts) with custom-styled $44\text{px}$–$48\text{px}$ touch fader thumbs, hardware LED state indicators, and clean unboxed metadata.

---

## 1. Overview & Core Concept

- **What It Does**: Re-engineers the VoxClip Studio interface into a responsive, touch-optimized voice design workstation tailored for iPad (portrait and landscape) as well as desktop and mobile screens.
- **Target Audience / Persona**: Content creators, voice actors, podcasters, and iPad touch musicians who want immediate visual clarity on what to do next and tactile, finger-friendly control over 64 voice presets, 3-slot preset chains, 2D XY morphing, and broadcast mastering.
- **Key Value**: Eliminates vertical scroll fatigue on iPad, provides unmistakable visual guidance at every stage of the workflow, and upgrades tiny browser-default sliders and buttons into responsive, studio-grade touch controls.

---

## 2. User Experience & Visual Design

- **Key User Flows**:
  1. **Step 1 — Guided Capture (`No Audio Loaded`)**: On launch, Step 1 (`1. Capture Voice`) is highlighted in the workflow banner. The `Record` button and `Drop / Upload` zone feature a subtle cyan guidance glow (`next-action-pulse`) and a clear helper prompt: *"Tap ● Record or drop an audio/video clip to begin."*
  2. **Step 2 — Guided Transformation (`Audio Ready`)**: As soon as a recording finishes or a file decodes, the workflow banner automatically transitions to Step 2 (`2. Transform & Sculpt`), illuminating the `Voice Presets` tab and `▶ Play` button. Users tap presets, build a 3-slot chain with touch-friendly mix sliders, or drag the enlarged 2D Macro XY Pad while keeping the Waveform/Spectrum visualizer and `A/B Dry/Wet` toggle permanently visible in the Left Dock.
  3. **Step 3 — Guided Mastering & Export (`FX Active / Ready to Render`)**: Tapping Step 3 in the banner (or switching to the `Export & Master` tab) reveals the ITU-R BS.1770 LUFS loudness meter, target selector (`-14` / `-16` / `-23 LUFS`), primary format cards (`WAV 16-bit`, `WAV 24-bit`, `MP3`, `Opus`), and `Batch Presets` / `Project Manager` actions.
- **Visual Identity & Theme**:
  - *Aesthetic Direction*: **Pro Hardware Console** inspired by modern digital audio workstations and tactile hardware synthesizers.
  - *Color Palette & Mood*:
    - **60% Dominant Canvas**: Deep anodized studio slate (`#090d13` outer chassis, `#0f151f` primary deck surface).
    - **30% Structural Surfaces**: Recessed bay panels (`#141c28`), crisp `1px solid #222f42` hairline borders, and muted steel typography (`#8b9bb0`).
    - **10% Semantic Accents**: Studio Cyan (`#38bdf8` / `#22d3ee`) for active signal paths and primary CTAs, Broadcast Crimson (`#f43f5e`) for active recording/clipping, Warm Amber (`#f59e0b`) for A/B dry comparison, and Nominal Emerald (`#34d399`) for LUFS targets and Eco mode.
  - *Typography & Hierarchy*:
    - Display & UI Controls: System-optimized geometric sans (`Plus Jakarta Sans`, `-apple-system`, `SF Pro Display`) with balanced headings and zero multi-line button wrapping (`whitespace-nowrap`).
    - Telemetry & Numeric Readouts: Strict tabular numerals (`font-variant-numeric: tabular-nums`, `SF Mono` / `JetBrains Mono`) on all timers, dB/LUFS meters, semitone/cent readouts, and zoom ratios.
    - Clean Metadata Discipline: Static status info (source sample rate, duration, take count, privacy note) rendered as clean unboxed inline text with `·` separators rather than cluttered pill badges.
- **Touch Target & Ergonomic Specifications**:
  - **Oversized Touch Faders**: Custom CSS range sliders (`input[type="range"]`) with $44\text{px}$ tall touch hitboxes, high-contrast $28 \times 22\text{px}$ tactile hardware fader caps, and clear track grooves so fingers never slip or mis-tap on iPad.
  - **7-Category Quick-Jump Filter Bar**: Inside the `Voice Presets` view, a horizontal touch-scrollable category selector (`All` · `Ages` · `Characters` · `Creatures` · `Devices` · `Lo-Fi` · `Spaces` · `FX & Utility`) lets iPad users jump to or filter any category with a single tap in addition to accordion browsing.
  - **Enlarged Chain Slot Controls**: The 3-slot Preset Chain bar features larger $44\text{px}$ interactive slot cards with finger-friendly mix sliders and one-tap remove buttons.

---

## 3. Key Product Decisions & Trade-Offs

- **Decision 1: Split Studio Deck with Non-Destructive Tabbed Workspace**
  - *Chosen Approach*: Organize theexisting DOM sections into a 2-column CSS Grid on iPad/desktop (`minmax(340px, 420px) 1fr`) where the Left Column holds the **Capture & Visualizer Transport Dock** and the Right Column hosts a **4-Tab Studio Deck** (`Presets`, `XY & Cleanup`, `Advanced Lab`, `Export & Master`), plus an `"All Panels"` expand toggle for users who ever want a full vertical rack view.
  - *Why*: On an iPad screen ($768\text{px}$–$1366\text{px}$), stacking 64 presets, an XY pad, 38 Advanced Lab sliders, and export controls below the waveform forces constant scrolling back and forth to hit `Play` or `A/B`. Keeping the transport dock stationary on the left while switching right-hand workspace tabs puts every control within immediate thumb reach.
  - *Alternatives Considered*: A strict 1-step-at-a-time modal wizard was rejected because sound designers frequently jump between presets, XY morphing, and playback auditioning non-linearly.
- **Decision 2: State-Driven 3-Step Workflow Banner & Contextual Highlights**
  - *Chosen Approach*: Compute the studio's live workflow stage (`stage 1: empty`, `stage 2: audio loaded`, `stage 3: fx customized or exporting`) inside `updateWorkflowGuide()` and update the interactive 3-step banner, contextual hint bar, and subtle focus rings on the next recommended control. Clicking any step in the banner smoothly activates the corresponding workspace tab and scrolls/focuses the target panel.
  - *Why*: Gives first-time users an obvious visual path from blank canvas to exported audio without intrusive popups or blocking tours, while serving as a fast navigation bar for experienced users.
- **Decision 3: 100% DOM ID & Automated Test Compatibility**
  - *Chosen Approach*: Preserve all existing element IDs (`#btnRecord`, `#btnPlay`, `#presetGrid`, `#xyPadCanvas`, `#fxPanel`, `#btnExportPrimary`, etc.), ARIA attributes, and `body.power-eco` rules while upgrading the layout wrapper, workspace tabs, and CSS styling.
  - *Why*: Ensures zero regressions across all 4 automated test suites (`fx-engine`, `local-storage`, `project`, `recording-history`) and maintains full offline PWA reliability.

---

## 4. Technical Architecture & Data Strategy *(Technical Reference)*

- **Architecture & Layout Diagram**:

```
┌───────────────────────────────────────────────────────────────────────────────────┐
│ TOP BAR: [VoxClip Studio]           [1. Capture ── 2. Transform ── 3. Export] [⚙] │
├───────────────────────────────────────┬───────────────────────────────────────────┤
│ LEFT DOCK: CAPTURE & TRANSPORT        │ RIGHT DECK: TABBED FX & MASTER WORKSPACE  │
│ ┌───────────────────────────────────┐ │ ┌───────────────────────────────────────┐ │
│ │ ● Record  🎧 Monitor  ⬆ Upload    │ │ │ [🎭 Presets] [🕹️ XY & Clean] [🎚️ Lab] [⬇ Export] │ │
│ │ [Drop Audio / Video / Project]    │ │ └───────────────────────────────────────┘ │
│ │ Mic Boost [════●══]  In Gain [═●] │ │ ┌───────────────────────────────────────┐ │
│ └───────────────────────────────────┘ │ │ ACTIVE WORKSPACE PANEL                │ │
│ ┌───────────────────────────────────┐ │ │ • Tab 1: 3-Slot Chain Bar + Category  │ │
│ │ [Waveform | Spectrum | Spectrogram]│ │ │   Quick-Pills + 64 Tactile Cards      │ │
│ │ ┌───────────────────────────────┐ │ │ │ • Tab 2: Enlarged 2D Macro XY Pad +   │ │
│ │ │   LIVE AUDIO VISUALIZER       │ │ │ │   Pre-FX Vocal Cleanup Strip          │ │
│ │ └───────────────────────────────┘ │ │ │ • Tab 3: 38-Param Pro Fader Rack      │ │
│ │ [−5] [ ▶ PLAY ] [+5] [⏹] [Loop]  │ │ │ • Tab 4: LUFS Meter + Target Select + │ │
│ │ [A/B Dry] [↶ Undo] [Apply] [Reset]│ │ │   WAV 16/24, MP3, Opus & Batch Export │ │
│ └───────────────────────────────────┘ │ └───────────────────────────────────────┘ │
└───────────────────────────────────────┴───────────────────────────────────────────┘
```

- **Data Model & State**:
  - `S.ui.workspaceTab`: Persisted active right-deck tab (`'presets' | 'xy' | 'lab' | 'export' | 'all'`), defaulting to `'presets'` so users immediately see voice characters alongside the capture/transport dock.
  - `S.ui.presetCatFilter`: Optional quick-filter category selection (`'all'` or one of the 7 category names) for one-tap category filtering on iPad.
  - `Workflow Stage State`: Derived reactively from `Boolean(S.buffer)` and whether non-default FX or presets are active, driving the 3-step banner (`#stepCapture`, `#stepTransform`, `#stepExport`) and contextual guidance prompt (`#workflowHintText`).
- **Interactive Component & State Mapping**:
  - **Interactive 3-Step Banner (`#workflowBanner`)**:
    - Tapping **Step 1 (`1. Capture Voice`)**: Focuses the Source Capture bay and highlights `#btnRecord` / `#dropzone`.
    - Tapping **Step 2 (`2. Transform & Sculpt`)**: Switches the Right Deck to the `Voice Presets` tab (or keeps current FX tab) and highlights the preset browser / `▶ Play` transport.
    - Tapping **Step 3 (`3. Master & Export`)**: Switches the Right Deck to the `Export & Master` tab and highlights the LUFS target & primary export actions.
  - **Workspace Tab Bar (`#deckTabs`)**:
    - Switching tabs toggles visibility of `#panelPresets`, `#panelXyCleanup`, `#panelLab` (automatically opening `#labDetails` when active), and `#panelExport`, plus an `"All"` view option that reveals all four panels simultaneously.
    - Resizes `#xyPadCanvas` and `#wave` cleanly on tab switch or orientation change so canvas dimensions are always crisp on iPad Retina displays.
