# VoxClip Studio

Browser-native **voice changer** (PWA). Record or upload voice, chain presets, tweak the Advanced Lab, export WAV/MP3 — all **client-side**, no server.

**Status:** v3-aligned implementation (HTML + PWA, GitHub Pages ready)  
**App entry:** `index.html`  
**Spec:** `voxclip-studio-prd-v3.0.md`

---

## Features

### Capture & source
- **Record** from the mic (desktop, iPad/Safari, Android Chrome)
- **Mic level** slider (1×–12×) — live gain into `MediaRecorder` when supported; also applied post-stop if needed
- **Input gain** slider (0.5×–9×) — playback/export make-up gain **before** Advanced Lab **FX gain** (cascaded: `inputGain × fx.gain`)
- **Quiet-mic normalize** for iPhone/iPad/Safari: peak target **0.95**, max **32×**, skip if peak ≥ **0.90**; second-pass boost if still quiet
- Defaults favor quiet devices (higher mic level / input gain on iOS/Safari)
- **Upload / drag-drop** audio or video: WAV, MP3, AAC, M4A, **MP4**, MOV, WebM, …
- Always **mono** project buffer (`toMonoBuffer`)
- Optional **muted video preview** + frame skip when source is video
- Replace confirm when a buffer already exists

### Preview & transport
- Live **waveform** with click/tap seek
- Play / Pause / Stop / Loop
- Skip −10 / −5 / +5 / +10 (mobile overflow menu for ±10)
- Frame ◀ / ▶ when video-origin
- Keyboard: Space, ←/→, J/L, Home/End, `,` / `.` (frames), **Ctrl/Cmd+Z** undo, **Ctrl/Cmd+Y** / **Shift+Z** redo

### Voice FX
- **99 built-in presets** in expandable groups (default open):
  - **Ages** — baby → elder / grandma / grandpa
  - **Characters** — deep, villain, hero, pirate, ghost, …
  - **Creatures** — robot, alien, dragon, animals, …
  - **Devices** — radio, phone, walkie, megaphone, intercom, …
  - **Lo-Fi** — cassette, vinyl, old TV, lo-fi, 8-bit, VHS, …
  - **Spaces** — cave, cathedral, helium, reverse, …
- **Chain up to 3 presets** in click order → blended into **Advanced Lab** sliders  
  - Badges **1 / 2 / 3**, chain bar, rolling window (4th unique drop oldest)  
  - Tap a chained card or any step in the chain bar to remove that slot
- Full **Advanced Lab**: pitch/formant, speed, crush, filters, reverb/delay, modulation, dynamics
- **Apply FX** — offline bake into the working buffer (WYSIWYE); resets lab to defaults after bake
- **Reset FX** — restores **original** record/upload audio + clears FX/chain (not only slider defaults)
- **Custom settings** — save / load / rename / overwrite / delete (max 50), import/export JSON

### Undo / redo (session only)
- Tracks **FX + preset chain + input gain**
- **Audio-aware** for Apply FX and Reset FX (buffer clones)
- Dedupes identical consecutive FX-only states
- Caps: **50** steps, **10** audio clones (oldest buffer clones dropped first)
- Cleared on new record/upload / Reset Project

### Export & PWA
- **Export WAV** (always available)
- **Export MP3** via lazy-loaded lamejs (CDN; graceful toast offline)
- Service worker + web manifest → installable / offline shell
- Dark studio UI, large touch targets, safe-area padding

---

## Quick start (local)

Any static server from the **repo root**:

```bash
# Python
python -m http.server 8080

# Node
npx --yes serve -l 8080
```

Open `http://localhost:8080`.  
Microphone access needs a **secure context** (`localhost` or **HTTPS**).

---

## Deploy to GitHub Pages

1. Push this folder to a GitHub repo (`main` or `master`).
2. **Settings → Pages → Build and deployment**
   - Source: **Deploy from a branch**
   - Branch: `main` (or `master`) / folder **`/`** (root)
3. Wait for publish.

**URL:** `https://<user>.github.io/<repo>/`

All asset paths are **relative** (`./sw.js`, `./manifest.webmanifest`, `./icons/…`), so project pages and custom domains work without path rewrites.

`.nojekyll` is included so GitHub Pages does not process the site with Jekyll.

---

## Project layout

| Path | Role |
|------|------|
| `index.html` | Full app (UI, Web Audio, FX, persistence) |
| `fx-presets.json` | Standalone built-in voice FX presets dataset & metadata |
| `sw.js` | Service worker (precache + network/cache) |
| `manifest.webmanifest` | PWA install metadata |
| `icons/` | `icon-192.png`, `icon-512.png`, maskable |
| `.nojekyll` | Disable Jekyll on Pages |
| `README.md` | This file |
| `voxclip-studio-prd-v3.0.md` | Product requirements (source of truth for product rules) |
| `voxclip-studio-prd-v2.2.md` | Prior PRD (reference) |

---

## Browser / device notes

| Area | Notes |
|------|--------|
| **Chrome / Edge / Firefox** | Full path; WebM record preferred |
| **Safari macOS / iOS / iPad** | MIME fallbacks (`mp4` / `aac` / `webm`); resume `AudioContext` on gesture; use **Mic level** + **Input gain** if still quiet |
| **Android Chrome** | Record + upload from Files; touch transport |
| **Recording unsupported** | Record disabled; upload still works |

### iPad / quiet mic checklist
1. Hard-refresh after updates.
2. Raise **Mic level** (e.g. 4–8) until the meter moves while talking.
3. Record → play; if still soft, raise **Input gain** (e.g. 2–4).
4. Prefer **Input gain** for listen/export loudness; **Mic level** for capture loudness.

---

## localStorage

**Key:** `voxclip.studio.v3`  
Corrupt parse → backup `voxclip.studio.v3.bak`, then defaults + toast.

| Stored | Not stored |
|--------|------------|
| FX parameters | Audio samples / buffers |
| Preset chain (up to 3 ids) | Undo / redo stacks |
| Active custom id | Playhead, video blob URLs |
| Custom settings library | |
| UI: loop, skip interval, export format, lab open, tab, mic level, input gain, category expanders | |

**Reset Project** clears audio + FX; **keeps** custom library.  
**Clear all saved data** (Settings) wipes customs + prefs.

---

## Typical workflows

**Fast voice change**  
Record → tap 1–3 presets (e.g. Deep → Robot → Radio) → Export WAV/MP3.

**Bake then layer**  
Dial FX → **Apply FX** → new character on already-processed clip → Export.  
**Undo** steps back through bake; **Reset FX** jumps to original capture.

**Reusable profile**  
Tweak Advanced Lab → **Save settings** → reload later from **My settings**.

---

## Privacy

All processing stays on the device. No accounts, no upload of audio to a server.  
`localStorage` holds numbers, names, and UI flags only.

---

## License

Use and modify freely for personal or product work.
