  (() => {
    'use strict';

    /* =========================================================
       Constants & defaults
       ========================================================= */
    /**
     * localStorage key: "voxclip.studio.v3"
     * Shape (PersistedState):
     * {
     *   version: 3,
     *   ui: {
     *     loop, skipIntervalSec, lastExportFormat, advancedLabExpanded,
     *     presetsSection: 'built-in'|'custom',
     *     micLevel, inputGain, fxSourceMode, fxRemoteUrl, maxRecordSec,
     *     recentPresetIds, presetSearch,
     *     presetCatOpen: { Ages, Characters, Creatures, Devices, Spaces: boolean }
     *   },
     *   fx: full FX param object (last Advanced Lab values),
     *   presetChain: string[]  // up to 3 built-in preset ids, click order
     *   activePresetId: string|null  // legacy mirror of last chain id
     *   activeCustomId: string|null,
     *   customSettings: [{ id, name, fx, presetChain?, createdAt, updatedAt, emoji? }],
     *   updatedAt: number
     * }
     * NOT stored: audio buffers, undo/redo stacks, playhead, video blobs.
     * Backup on corrupt parse: "voxclip.studio.v3.bak"
     */
    const STORAGE_KEY = 'voxclip.studio.v3';
    const MAX_CUSTOMS = 50;
    // iPad/Safari mics are often extremely quiet — allow large auto boost
    const TARGET_PEAK = 0.95;
    const MAX_NORM_GAIN = 32;
    const SKIP_NORM_PEAK = 0.90;
    const LIMITER_PEAK = 0.89;
    const LARGE_FILE_BYTES = 500 * 1024 * 1024;

    function isQuietMicDevice() {
      const ua = navigator.userAgent || '';
      const iOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
      const safari = /^((?!chrome|android).)*safari/i.test(ua);
      return iOS || (safari && /Macintosh/.test(ua));
    }

    function defaultMicLevel() { return isQuietMicDevice() ? 4 : 2; }
    function defaultInputGain() { return isQuietMicDevice() ? 2.5 : 1; }

    let DEFAULT_FX_VALUES = {
      pitchSemi: 0,
      pitchCents: 0,
      pitchMode: 'hq',
      formant: 0,
      reverse: false,
      speed: 1,
      fadeIn: 0,
      fadeOut: 0,
      sampleRateCrush: 0,
      bitcrush: 0,
      bpFreq: 1200,
      bpQ: 1,
      bpMix: 0,
      lowpass: 18000,
      highpass: 40,
      bass: 0,
      mid: 0,
      treble: 0,
      distortion: 0,
      ringFreq: 0,
      noiseMix: 0,
      reverbMix: 0,
      reverbSize: 0.45,
      reverbDecay: 1.4,
      delayTime: 0,
      delayFeedback: 0.25,
      delayMix: 0,
      chorus: 0,
      flanger: 0,
      tremolo: 0,
      tremoloRate: 5,
      vibrato: 0,
      vibratoRate: 5,
      gain: 1,
      compressorThresh: -18,
      compressorRatio: 3,
      // Phase 1 Vocal Cleanup
      gateThreshold: -100,
      gateRelease: 0.05,
      deEssAmount: 0,
      deEssFreq: 6500,
      humNotch: 0,
      // Phase 2 Synthesis
      harmonyPreset: 'none',
      harmonyMix: 0,
      vocoderMix: 0,
      vocoderCarrier: 'saw',
      vocoderBands: 16,
      // Phase 3 Ambience & Soundscape
      ambiencePreset: 'none',
      ambienceMix: 0,
      ambienceDuck: 0.55,
      ambienceTone: 0
    };

    const defaultFx = () => ({ ...DEFAULT_FX_VALUES });

    let FX_META = [
      { group: 'Pitch & Formant', params: [
        { key: 'pitchMode', label: 'Pitch engine', type: 'select', options: [
          { value: 'hq', label: 'Phase-Vocoder HQ (Artifact-Free)' },
          { value: 'granular', label: 'Granular SOLA (Classic)' }
        ]},
        { key: 'pitchSemi', label: 'Pitch', min: -12, max: 12, step: 0.1, unit: 'st' },
        { key: 'pitchCents', label: 'Fine tune', min: -100, max: 100, step: 1, unit: '¢' },
        { key: 'formant', label: 'Formant', min: -12, max: 12, step: 0.1, unit: 'st' },
        { key: 'reverse', label: 'Reverse', type: 'bool' }
      ]},
      { group: 'Harmonizer & Vocoder', params: [
        { key: 'harmonyPreset', label: 'Harmonizer chord', type: 'select', options: [
          { value: 'none', label: 'None (Off)' },
          { value: 'octave-down', label: 'Octave Down (-12st)' },
          { value: 'octave-up', label: 'Octave Up (+12st)' },
          { value: 'power-fifth', label: 'Power 5th (+7st)' },
          { value: 'major-chord', label: 'Major Triad (+4st, +7st)' },
          { value: 'minor-chord', label: 'Minor Triad (+3st, +7st)' },
          { value: 'choir-wide', label: 'Choir Ensemble (±12st, ±7st)' }
        ]},
        { key: 'harmonyMix', label: 'Harmonizer mix', min: 0, max: 1, step: 0.01, unit: '' },
        { key: 'vocoderMix', label: '16-Band Vocoder mix', min: 0, max: 1, step: 0.01, unit: '' },
        { key: 'vocoderCarrier', label: 'Vocoder carrier', type: 'select', options: [
          { value: 'saw', label: 'Sawtooth Buzz (80 Hz)' },
          { value: 'pulse', label: 'Pulse Wave (110 Hz)' },
          { value: 'chord', label: 'Synth Chord (Cm Triad)' },
          { value: 'noise', label: 'Whisper Noise' }
        ]},
        { key: 'vocoderBands', label: 'Vocoder bands', type: 'select', options: [
          { value: '8', label: '8 Bands (Vintage Lo-Fi)' },
          { value: '16', label: '16 Bands (Studio Clean)' }
        ]}
      ]},
      { group: 'Vocal Cleanup Strip', params: [
        { key: 'gateThreshold', label: 'Noise gate thresh', min: -100, max: -20, step: 1, unit: 'dB' },
        { key: 'gateRelease', label: 'Gate release', min: 0.02, max: 0.5, step: 0.01, unit: 's' },
        { key: 'deEssAmount', label: 'De-Esser amount', min: 0, max: 1, step: 0.01, unit: '' },
        { key: 'deEssFreq', label: 'De-Esser freq', min: 4500, max: 9000, step: 100, unit: 'Hz' }
      ]},
      { group: 'Time & Speed', params: [
        { key: 'speed', label: 'Speed', min: 0.5, max: 2, step: 0.01, unit: '×' },
        { key: 'fadeIn', label: 'Fade in', min: 0, max: 2, step: 0.01, unit: 's' },
        { key: 'fadeOut', label: 'Fade out', min: 0, max: 2, step: 0.01, unit: 's' },
        { key: 'sampleRateCrush', label: 'Sample crush', min: 0, max: 1, step: 0.01, unit: '' },
        { key: 'bitcrush', label: 'Bitcrush', min: 0, max: 1, step: 0.01, unit: '' }
      ]},
      { group: 'Filters', params: [
        { key: 'bpFreq', label: 'Bandpass freq', min: 100, max: 8000, step: 1, unit: 'Hz' },
        { key: 'bpQ', label: 'Bandpass Q', min: 0.2, max: 12, step: 0.1, unit: '' },
        { key: 'bpMix', label: 'Bandpass mix', min: 0, max: 1, step: 0.01, unit: '' },
        { key: 'lowpass', label: 'Lowpass', min: 200, max: 18000, step: 1, unit: 'Hz' },
        { key: 'highpass', label: 'Highpass', min: 20, max: 4000, step: 1, unit: 'Hz' },
        { key: 'bass', label: 'Bass', min: -12, max: 12, step: 0.1, unit: 'dB' },
        { key: 'mid', label: 'Mid', min: -12, max: 12, step: 0.1, unit: 'dB' },
        { key: 'treble', label: 'Treble', min: -12, max: 12, step: 0.1, unit: 'dB' },
        { key: 'distortion', label: 'Distortion', min: 0, max: 1, step: 0.01, unit: '' },
        { key: 'ringFreq', label: 'Ring mod', min: 0, max: 80, step: 0.5, unit: 'Hz' },
        { key: 'noiseMix', label: 'Noise mix', min: 0, max: 0.4, step: 0.01, unit: '' }
      ]},
      { group: 'Space', params: [
        { key: 'reverbMix', label: 'Reverb mix', min: 0, max: 1, step: 0.01, unit: '' },
        { key: 'reverbSize', label: 'Reverb size', min: 0.1, max: 1, step: 0.01, unit: '' },
        { key: 'reverbDecay', label: 'Reverb decay', min: 0.2, max: 4, step: 0.05, unit: 's' },
        { key: 'delayTime', label: 'Delay time', min: 0, max: 1, step: 0.01, unit: 's' },
        { key: 'delayFeedback', label: 'Delay feedback', min: 0, max: 0.9, step: 0.01, unit: '' },
        { key: 'delayMix', label: 'Delay mix', min: 0, max: 1, step: 0.01, unit: '' }
      ]},
      { group: 'Modulation', params: [
        { key: 'chorus', label: 'Chorus', min: 0, max: 1, step: 0.01, unit: '' },
        { key: 'flanger', label: 'Flanger', min: 0, max: 1, step: 0.01, unit: '' },
        { key: 'tremolo', label: 'Tremolo', min: 0, max: 1, step: 0.01, unit: '' },
        { key: 'tremoloRate', label: 'Tremolo rate', min: 0.5, max: 20, step: 0.1, unit: 'Hz' },
        { key: 'vibrato', label: 'Vibrato', min: 0, max: 1, step: 0.01, unit: '' },
        { key: 'vibratoRate', label: 'Vibrato rate', min: 0.5, max: 12, step: 0.1, unit: 'Hz' }
      ]},
      { group: 'Dynamics', params: [
        // inputGain is mirrored from S.inputGain (not stored in presets) — see rebuildFxPanel
        { key: 'inputGain', label: 'Input gain (before FX)', min: 0.5, max: 9, step: 0.1, unit: '×', external: 'inputGain' },
        { key: 'gain', label: 'FX gain', min: 0, max: 3, step: 0.01, unit: '×' },
        { key: 'compressorThresh', label: 'Comp thresh', min: -60, max: 0, step: 1, unit: 'dB' },
        { key: 'compressorRatio', label: 'Comp ratio', min: 1, max: 20, step: 0.1, unit: ':1' }
      ]},
      { group: 'Background Ambience', params: [
        { key: 'ambiencePreset', label: 'Soundscape scene', type: 'select', options: [
          { value: 'none', label: 'Off (No Soundscape)' },
          { value: 'vinyl', label: 'Vinyl & Tape Crackle' },
          { value: 'rain', label: 'Rain & Distant Thunder' },
          { value: 'starship', label: 'Starship Bridge Hum' },
          { value: 'static', label: 'Radio Telemetry Static' },
          { value: 'dungeon', label: 'Dungeon Cavern Wind' },
          { value: 'cyberpunk', label: 'Cyberpunk Neon Rain' },
          { value: 'campfire', label: 'Campfire Crackles' }
        ]},
        { key: 'ambienceMix', label: 'Ambience mix', min: 0, max: 0.8, step: 0.01, unit: '' },
        { key: 'ambienceDuck', label: 'Voice auto-duck', min: 0, max: 1, step: 0.01, unit: '' },
        { key: 'ambienceTone', label: 'Ambience tone', min: -6, max: 6, step: 0.5, unit: 'dB' }
      ]}
    ];

    /** Built-in voice presets — category used only for UI grouping */
    let BUILTIN_PRESETS = [
      {"id":"baby","cat":"Ages","name":"Baby","emoji":"👶","desc":"Tiny high-pitched infant","fx":{"pitchSemi":10,"formant":8.5,"speed":0.94,"highpass":220,"lowpass":11000,"treble":3.5,"mid":1.5,"vibrato":0.14,"vibratoRate":5.5,"compressorThresh":-20,"compressorRatio":2.5,"gain":1.05},"archetype":"tiny-infant"},
      {"id":"kid","cat":"Ages","name":"Kid","emoji":"🧒","desc":"Playful bright child","fx":{"pitchSemi":6,"formant":4.8,"speed":1.04,"highpass":130,"treble":2.5,"mid":1.8,"deEssAmount":0.2,"compressorThresh":-19,"compressorRatio":2.8,"gain":1.04},"archetype":"youthful-child"},
      {"id":"teen-boy","cat":"Ages","name":"Teen Boy","emoji":"👦","desc":"Cracking mid-register voice","fx":{"pitchSemi":1.2,"pitchCents":-25,"formant":0.5,"mid":2.8,"bass":-1.5,"highpass":85,"vibrato":0.12,"vibratoRate":3.6,"tremolo":0.12,"tremoloRate":3.2,"distortion":0.04,"gain":1.05},"archetype":"cracking-adolescent"},
      {"id":"teen-girl","cat":"Ages","name":"Teen Girl","emoji":"👧","desc":"Crisp, upbeat teen tone","fx":{"pitchSemi":4.2,"formant":3.4,"speed":1.03,"highpass":110,"treble":3,"mid":2,"deEssAmount":0.25,"deEssFreq":7000,"compressorThresh":-18,"compressorRatio":3,"gain":1.05},"archetype":"bright-adolescent"},
      {"id":"young-adult","cat":"Ages","name":"Young Adult","emoji":"🧑","desc":"Clear, energetic 20s voice","fx":{"pitchSemi":1.5,"formant":1,"highpass":75,"mid":1.2,"treble":1.4,"deEssAmount":0.2,"compressorThresh":-19,"compressorRatio":2.8,"gain":1.04},"archetype":"fresh-adult"},
      {"id":"adult-deep","cat":"Ages","name":"Mature Deep","emoji":"🧔","desc":"Rich, settled adult baritone","fx":{"pitchSemi":-3.5,"formant":-2.2,"bass":3.5,"mid":1.2,"lowpass":10500,"highpass":55,"deEssAmount":0.2,"compressorThresh":-18,"compressorRatio":3.2,"gain":1.08},"archetype":"settled-baritone"},
      {"id":"grandma","cat":"Ages","name":"Grandma","emoji":"👵","desc":"Warm, gentle quivering elder","fx":{"pitchSemi":1.8,"formant":1.2,"speed":0.9,"highpass":110,"lowpass":6800,"mid":1.2,"treble":-1.5,"vibrato":0.2,"vibratoRate":3.2,"tremolo":0.1,"tremoloRate":2.8,"reverbMix":0.06,"gain":1.05},"archetype":"soft-aged-female"},
      {"id":"grandpa","cat":"Ages","name":"Grandpa","emoji":"👴","desc":"Slow, gravelly weathered elder","fx":{"pitchSemi":-5.5,"formant":-3.2,"speed":0.86,"bass":3.2,"mid":1.5,"lowpass":6000,"highpass":70,"vibrato":0.15,"vibratoRate":2.6,"distortion":0.08,"compressorThresh":-20,"compressorRatio":3.5,"gain":1.1},"archetype":"gravelly-aged-male"},
      {"id":"deep","cat":"Characters","name":"Deep","emoji":"🎙️","desc":"Sub-harmonic cinema bass","fx":{"pitchSemi":-5,"formant":-3,"harmonyPreset":"octave-down","harmonyMix":0.18,"bass":5,"mid":1.5,"lowpass":8500,"distortion":0.04,"compressorThresh":-17,"compressorRatio":4.5,"gain":1.12},"archetype":"sub-cinema-bass"},
      {"id":"chipmunk","cat":"Characters","name":"Chipmunk","emoji":"🐿️","desc":"Hyper-speed helium cartoon","fx":{"pitchSemi":8,"formant":5.5,"speed":1.18,"highpass":200,"treble":3.5,"mid":1.5,"vibrato":0.1,"vibratoRate":6.5,"tremolo":0.1,"tremoloRate":6,"gain":1.05},"archetype":"cartoon-pitched"},
      {"id":"hero","cat":"Characters","name":"Hero","emoji":"🦸","desc":"Bold, commanding cinematic lead","fx":{"pitchSemi":-2.2,"formant":-1.4,"bass":3,"mid":2.8,"treble":1.2,"highpass":65,"deEssAmount":0.25,"compressorThresh":-15,"compressorRatio":4.8,"reverbMix":0.12,"reverbSize":0.55,"reverbDecay":1.5,"gain":1.16},"archetype":"cinematic-bold"},
      {"id":"narrator","cat":"Characters","name":"Narrator","emoji":"📖","desc":"Intimate documentary storyteller","fx":{"pitchSemi":-2,"formant":-1,"bass":2.8,"mid":1.4,"treble":0.8,"highpass":60,"lowpass":12000,"gateThreshold":-52,"deEssAmount":0.35,"deEssFreq":6400,"compressorThresh":-18,"compressorRatio":3.5,"gain":1.1},"archetype":"warm-broadcast"},
      {"id":"news-anchor","cat":"Characters","name":"News Anchor","emoji":"📰","desc":"Crisp studio broadcast desk","fx":{"highpass":95,"lowpass":11500,"bass":1.2,"mid":3,"treble":2.2,"gateThreshold":-48,"deEssAmount":0.45,"deEssFreq":6800,"compressorThresh":-19,"compressorRatio":5.5,"gain":1.15},"archetype":"clean-broadcast"},
      {"id":"villain","cat":"Characters","name":"Villain","emoji":"😈","desc":"Velvet menace with dark shadow","fx":{"pitchSemi":-4.2,"formant":-2.8,"harmonyPreset":"minor-chord","harmonyMix":0.16,"bass":3.8,"mid":1.2,"lowpass":7200,"distortion":0.07,"reverbMix":0.26,"reverbSize":0.7,"reverbDecay":2.2,"delayMix":0.12,"delayTime":0.22,"gain":1.1},"archetype":"dark-reverberant"},
      {"id":"witch","cat":"Characters","name":"Witch","emoji":"🧙‍♀️","desc":"Cackling, raspy mystic","fx":{"pitchSemi":2.5,"formant":-2.8,"speed":0.94,"bpMix":0.35,"bpFreq":1850,"bpQ":2.2,"distortion":0.12,"tremolo":0.18,"tremoloRate":4.8,"reverbMix":0.28,"reverbDecay":2.3,"lowpass":7800,"gain":1.08},"archetype":"creaky-mystic"},
      {"id":"wizard","cat":"Characters","name":"Wizard","emoji":"🧙","desc":"Arcane sage with harmonic aura","fx":{"pitchSemi":-3.2,"formant":2.2,"harmonyPreset":"power-fifth","harmonyMix":0.22,"chorus":0.2,"reverbMix":0.36,"reverbSize":0.82,"reverbDecay":2.9,"delayMix":0.16,"delayTime":0.26,"delayFeedback":0.32,"lowpass":8000,"gain":1.06},"archetype":"arcane-otherworldly"},
      {"id":"pirate","cat":"Characters","name":"Pirate","emoji":"🏴‍☠️","desc":"Weathered, gravelly sea captain","fx":{"pitchSemi":-3.5,"formant":-2.6,"bass":3.2,"mid":2.5,"highpass":85,"lowpass":6200,"distortion":0.24,"noiseMix":0.025,"compressorThresh":-18,"compressorRatio":4,"gain":1.12},"archetype":"rough-gritty"},
      {"id":"knight","cat":"Characters","name":"Knight","emoji":"🛡️","desc":"Resonant iron visor helm","fx":{"pitchSemi":-2.4,"formant":-1.2,"bpMix":0.55,"bpFreq":880,"bpQ":4.2,"mid":3.8,"bass":1.5,"highpass":140,"lowpass":5400,"distortion":0.08,"reverbMix":0.18,"reverbSize":0.25,"reverbDecay":0.65,"gain":1.14},"archetype":"armored-metallic"},
      {"id":"opera","cat":"Characters","name":"Opera","emoji":"🎭","desc":"Soaring vibrato & grand stage hall","fx":{"pitchSemi":1.5,"formant":1,"harmonyPreset":"octave-up","harmonyMix":0.15,"vibrato":0.38,"vibratoRate":5.6,"mid":2,"treble":1.8,"reverbMix":0.48,"reverbSize":0.88,"reverbDecay":2.9,"gain":1.12},"archetype":"vibrato-hall"},
      {"id":"whisper-soft","cat":"Characters","name":"Whisper","emoji":"🤫","desc":"Breathy ASMR close-mic hush","fx":{"vocoderMix":0.28,"vocoderCarrier":"noise","vocoderBands":16,"highpass":280,"lowpass":5200,"treble":2.2,"noiseMix":0.05,"deEssAmount":0.3,"compressorThresh":-28,"compressorRatio":2.4,"gain":1.05},"archetype":"close-breathy"},
      {"id":"giant","cat":"Characters","name":"Giant","emoji":"🗿","desc":"Colossal slow earth-shaking boom","fx":{"pitchSemi":-8.5,"formant":-5.5,"speed":0.82,"harmonyPreset":"octave-down","harmonyMix":0.25,"bass":6.5,"lowpass":4800,"reverbMix":0.28,"reverbSize":0.85,"reverbDecay":2.6,"compressorThresh":-16,"compressorRatio":4,"gain":1.15},"archetype":"huge-deep-boom"},
      {"id":"ghost","cat":"Characters","name":"Ghost","emoji":"👻","desc":"Haunting spectral choir apparition","fx":{"pitchSemi":0.5,"formant":2.5,"harmonyPreset":"minor-chord","harmonyMix":0.32,"highpass":420,"lowpass":5800,"flanger":0.28,"reverbMix":0.52,"reverbSize":0.85,"reverbDecay":3.1,"delayMix":0.18,"delayTime":0.19,"noiseMix":0.05,"gain":1.04},"archetype":"breathy-distant"},
      {"id":"demon","cat":"Characters","name":"Demon","emoji":"👿","desc":"Abyssal legion growl & ring-mod","fx":{"pitchSemi":-7.5,"formant":-5,"harmonyPreset":"minor-chord","harmonyMix":0.35,"bass":5.5,"lowpass":4600,"distortion":0.38,"ringFreq":9,"reverbMix":0.32,"reverbSize":0.8,"reverbDecay":2.8,"gain":1.12},"archetype":"infernal-growl"},
      {"id":"angel","cat":"Characters","name":"Angel","emoji":"😇","desc":"Celestial 4-voice choir halo","fx":{"pitchSemi":2.5,"formant":2,"harmonyPreset":"choir-wide","harmonyMix":0.48,"chorus":0.45,"highpass":120,"treble":2.8,"deEssAmount":0.25,"reverbMix":0.44,"reverbSize":0.88,"reverbDecay":2.8,"gain":1.08},"archetype":"airy-choir"},
      {"id":"alien","cat":"Creatures","name":"Alien","emoji":"👽","desc":"Extraterrestrial formant & pulse","fx":{"pitchSemi":3.5,"formant":8.5,"vocoderMix":0.32,"vocoderCarrier":"pulse","vocoderBands":16,"ringFreq":14,"flanger":0.35,"chorus":0.3,"delayMix":0.1,"delayTime":0.06,"gain":1.08},"archetype":"odd-formant"},
      {"id":"robot","cat":"Creatures","name":"Robot","emoji":"🤖","desc":"16-band saw vocoder & mech crush","fx":{"vocoderMix":0.65,"vocoderCarrier":"saw","vocoderBands":16,"ringFreq":30,"bitcrush":0.35,"sampleRateCrush":0.25,"distortion":0.1,"tremolo":0.18,"tremoloRate":8,"compressorThresh":-18,"compressorRatio":4,"gain":1.15},"archetype":"ring-bitcrush-mech"},
      {"id":"cyborg","cat":"Creatures","name":"Cyborg","emoji":"🦾","desc":"Bionic sub-octave & 8-band pulse","fx":{"pitchSemi":-1.5,"formant":-1.5,"harmonyPreset":"octave-down","harmonyMix":0.3,"vocoderMix":0.38,"vocoderCarrier":"pulse","vocoderBands":8,"ringFreq":18,"bitcrush":0.18,"mid":2.2,"chorus":0.2,"gain":1.12},"archetype":"half-human-mech"},
      {"id":"android","cat":"Creatures","name":"Android","emoji":"🛰️","desc":"Sleek polyphonic AI chord synth","fx":{"pitchSemi":0.5,"formant":-2.8,"vocoderMix":0.52,"vocoderCarrier":"chord","vocoderBands":16,"highpass":110,"lowpass":9500,"chorus":0.25,"flanger":0.15,"compressorRatio":3.5,"gain":1.12},"archetype":"clean-synthetic"},
      {"id":"monster","cat":"Creatures","name":"Monster","emoji":"👹","desc":"Ferocious sub-octave beast roar","fx":{"pitchSemi":-9.5,"formant":-6.5,"harmonyPreset":"octave-down","harmonyMix":0.3,"bass":6,"mid":1.5,"lowpass":4200,"distortion":0.48,"noiseMix":0.04,"tremolo":0.12,"tremoloRate":2.2,"reverbMix":0.18,"gain":1.14},"archetype":"huge-deep-boom"},
      {"id":"dragon","cat":"Creatures","name":"Dragon","emoji":"🐉","desc":"Smoldering cavern roar & chest Q","fx":{"pitchSemi":-6.5,"formant":-4.2,"bpMix":0.35,"bpFreq":420,"bpQ":2.8,"bass":5.5,"distortion":0.42,"lowpass":5500,"reverbMix":0.36,"reverbSize":0.85,"reverbDecay":2.4,"gain":1.12},"archetype":"roaring-beast"},
      {"id":"goblin","cat":"Creatures","name":"Goblin","emoji":"👺","desc":"Snarling high-pitch nasal trickster","fx":{"pitchSemi":5.5,"formant":-3.5,"speed":1.1,"bpMix":0.6,"bpFreq":1650,"bpQ":3,"mid":3,"distortion":0.14,"highpass":180,"gain":1.1},"archetype":"nasal-mischief"},
      {"id":"cat","cat":"Creatures","name":"Cat","emoji":"🐱","desc":"Agile feline meow & purr mod","fx":{"pitchSemi":5.8,"formant":4.8,"vibrato":0.24,"vibratoRate":6.8,"ringFreq":22,"treble":2.6,"mid":1.5,"highpass":180,"gain":1.06},"archetype":"soft-vibrato-animal"},
      {"id":"bird","cat":"Creatures","name":"Bird","emoji":"🐦","desc":"Chirpy songbird trill & flutter","fx":{"pitchSemi":9.5,"formant":7.5,"speed":1.12,"vibrato":0.38,"vibratoRate":9.5,"tremolo":0.2,"tremoloRate":11,"treble":4.2,"highpass":320,"delayMix":0.08,"delayTime":0.05,"gain":1.05},"archetype":"chirpy-vibrato"},
      {"id":"frog","cat":"Creatures","name":"Frog","emoji":"🐸","desc":"Resonant pond-throat croak","fx":{"pitchSemi":-3.5,"formant":4.5,"bpMix":0.5,"bpFreq":680,"bpQ":3.8,"ringFreq":7,"bass":3.2,"lowpass":3600,"speed":0.94,"gain":1.1},"archetype":"gulpy-croak"},
      {"id":"bee","cat":"Creatures","name":"Bee","emoji":"🐝","desc":"Swarming wing-buzz & rapid pulse","fx":{"pitchSemi":4.5,"formant":3,"vocoderMix":0.25,"vocoderCarrier":"saw","vocoderBands":8,"ringFreq":48,"tremolo":0.55,"tremoloRate":18,"highpass":240,"treble":2.5,"gain":1.1},"archetype":"buzzy-tremolo"},
      {"id":"whale","cat":"Creatures","name":"Whale","emoji":"🐋","desc":"Abyssal slow ocean song","fx":{"pitchSemi":-7,"formant":-3.5,"speed":0.72,"vibrato":0.18,"vibratoRate":1.6,"reverbMix":0.58,"reverbSize":0.96,"reverbDecay":3.6,"lowpass":3600,"bass":4.2,"gain":1.08},"archetype":"deep-ocean-slow"},
      {"id":"radio","cat":"Devices","name":"Radio","emoji":"📻","desc":"1940s AM tube broadcast","fx":{"bpMix":0.85,"bpFreq":1850,"bpQ":2.6,"highpass":340,"lowpass":3300,"mid":2.5,"distortion":0.22,"noiseMix":0.02,"compressorThresh":-22,"compressorRatio":6.5,"gain":1.18},"archetype":"narrowband-broadcast","era":"1940s–50s AM Radio"},
      {"id":"telephone","cat":"Devices","name":"Telephone","emoji":"📞","desc":"Classic PSTN landline handset","fx":{"highpass":420,"lowpass":2800,"bpMix":0.65,"bpFreq":1350,"bpQ":1.8,"mid":2,"distortion":0.06,"compressorThresh":-21,"compressorRatio":5,"gain":1.14},"archetype":"narrowband-clean","era":"1970s–90s Landline"},
      {"id":"megaphone","cat":"Devices","name":"Megaphone","emoji":"📢","desc":"Overdriven street bullhorn","fx":{"highpass":320,"lowpass":4600,"bpMix":0.45,"bpFreq":1600,"bpQ":2.4,"mid":6.5,"distortion":0.38,"compressorThresh":-20,"compressorRatio":8.5,"gain":1.2},"archetype":"loud-mid-push","era":"Timeless / Analog Bullhorn"},
      {"id":"walkie","cat":"Devices","name":"Walkie-Talkie","emoji":"📟","desc":"Handheld two-way radio & squelch","fx":{"highpass":380,"lowpass":3100,"bpMix":0.5,"bpFreq":1650,"bpQ":2.2,"distortion":0.28,"sampleRateCrush":0.24,"bitcrush":0.12,"noiseMix":0.07,"compressorThresh":-20,"compressorRatio":6,"gain":1.15},"archetype":"narrowband-static","era":"1980s Handheld Radio"},
      {"id":"pa-system","cat":"Devices","name":"PA / Intercom","emoji":"🔊","desc":"Hallway & gymnasium horn echo","fx":{"highpass":200,"lowpass":5200,"bpMix":0.3,"bpFreq":1450,"bpQ":2,"mid":4.2,"distortion":0.1,"reverbMix":0.24,"reverbSize":0.68,"reverbDecay":1.6,"delayMix":0.15,"delayTime":0.08,"delayFeedback":0.22,"compressorThresh":-18,"compressorRatio":5.5,"gain":1.16},"archetype":"hall-boom-broadcast","era":"Timeless / Public Address"},
      {"id":"headphones","cat":"Devices","name":"Close Mic","emoji":"🎧","desc":"Warm studio condenser proximity","fx":{"bass":2.8,"mid":0.8,"treble":1.5,"highpass":50,"lowpass":15000,"gateThreshold":-54,"deEssAmount":0.32,"deEssFreq":6600,"compressorThresh":-17,"compressorRatio":3.2,"gain":1.1},"archetype":"close-proximity","era":"Modern Studio Mic"},
      {"id":"space-radio","cat":"Devices","name":"Space Radio","emoji":"📡","desc":"Deep-space mission telemetry","fx":{"highpass":420,"lowpass":3400,"bpMix":0.4,"bpFreq":1550,"bpQ":2.2,"bitcrush":0.18,"sampleRateCrush":0.15,"noiseMix":0.055,"delayMix":0.22,"delayTime":0.24,"delayFeedback":0.36,"reverbMix":0.22,"gain":1.14},"archetype":"distant-comms-delay","era":"Orbital / Deep Space Comms"},
      {"id":"cassette","cat":"Lo-Fi","name":"Cassette","emoji":"📼","desc":"1980s warm tape wow & flutter","fx":{"highpass":110,"lowpass":6800,"bass":1.8,"mid":1,"treble":-1.5,"vibrato":0.2,"vibratoRate":2.1,"chorus":0.08,"distortion":0.06,"sampleRateCrush":0.18,"noiseMix":0.028,"gain":1.06},"archetype":"tape-wobble","era":"1980s Cassette Tape"},
      {"id":"lofi","cat":"Lo-Fi","name":"Lo-Fi Crush","emoji":"💽","desc":"90s SP-1200 sampler grit","fx":{"sampleRateCrush":0.48,"bitcrush":0.38,"highpass":150,"lowpass":5600,"bass":2,"mid":1.2,"noiseMix":0.035,"compressorThresh":-19,"compressorRatio":3.8,"gain":1.08},"archetype":"digital-crush","era":"1990s 12-Bit Sampler"},
      {"id":"vinyl","cat":"Lo-Fi","name":"Vinyl","emoji":"💿","desc":"Dusty warm turntable groove","fx":{"highpass":65,"lowpass":8200,"bass":2.2,"mid":0.8,"treble":-1.8,"vibrato":0.08,"vibratoRate":1.4,"chorus":0.1,"noiseMix":0.035,"sampleRateCrush":0.08,"gain":1.06},"archetype":"warm-crackle","era":"1960s–70s Vinyl Record"},
      {"id":"lofi-broken-speaker","cat":"Lo-Fi","name":"Broken Speaker","emoji":"💢","desc":"Torn paper cone fuzz","fx":{"highpass":420,"lowpass":3400,"bpMix":0.4,"bpFreq":1250,"bpQ":3.2,"distortion":0.55,"bitcrush":0.15,"noiseMix":0.05,"compressorThresh":-16,"compressorRatio":8,"gain":1.15},"archetype":"harsh-blown-distortion","era":"Damaged Hardware"},
      {"id":"lofi-vhs","cat":"Lo-Fi","name":"VHS Glitch","emoji":"📹","desc":"Warped tracking & tape drift","fx":{"highpass":120,"lowpass":5200,"chorus":0.42,"flanger":0.22,"vibrato":0.28,"vibratoRate":1.7,"tremolo":0.16,"tremoloRate":1.2,"sampleRateCrush":0.2,"bitcrush":0.1,"noiseMix":0.03,"gain":1.06},"archetype":"wobbly-chorus-glitch","era":"1980s–90s VHS Tape"},
      {"id":"lofi-8bit","cat":"Lo-Fi","name":"8-Bit Game","emoji":"🎮","desc":"Retro console chiptune voice","fx":{"pitchSemi":1,"vocoderMix":0.25,"vocoderCarrier":"pulse","vocoderBands":8,"bitcrush":0.68,"sampleRateCrush":0.58,"highpass":220,"lowpass":5800,"distortion":0.12,"gain":1.12},"archetype":"digital-crush","era":"1980s 8-Bit Console"},
      {"id":"cave","cat":"Spaces","name":"Cave","emoji":"🕳️","desc":"Deep stone cavern & multi-tap echo","fx":{"reverbMix":0.48,"reverbSize":0.88,"reverbDecay":3.2,"delayMix":0.22,"delayTime":0.32,"delayFeedback":0.42,"lowpass":7200,"bass":1.5,"gain":1.05},"archetype":"huge-cavernous-echo"},
      {"id":"cathedral","cat":"Spaces","name":"Cathedral","emoji":"⛪","desc":"Sacred vaulted hall & choir tail","fx":{"harmonyPreset":"choir-wide","harmonyMix":0.14,"reverbMix":0.64,"reverbSize":0.98,"reverbDecay":3.9,"highpass":85,"lowpass":10500,"treble":1.2,"delayMix":0.05,"delayTime":0.38,"gain":1.05},"archetype":"sacred-cathedral-hall"},
      {"id":"underwater","cat":"Spaces","name":"Underwater","emoji":"🌊","desc":"Submerged pressure & bubble warble","fx":{"lowpass":580,"highpass":55,"bass":3.5,"bpMix":0.25,"bpFreq":380,"bpQ":2,"chorus":0.35,"vibrato":0.16,"vibratoRate":2.2,"reverbMix":0.38,"reverbSize":0.72,"reverbDecay":2,"gain":1.22},"archetype":"muffled-submerged"},
      {"id":"bathroom","cat":"Spaces","name":"Bathroom","emoji":"🚿","desc":"Bright ceramic tile reflection","fx":{"reverbMix":0.44,"reverbSize":0.26,"reverbDecay":0.65,"bpMix":0.22,"bpFreq":1400,"bpQ":1.8,"highpass":180,"treble":2.8,"mid":1.6,"gain":1.06},"archetype":"tight-tile-slap"},
      {"id":"stadium","cat":"Spaces","name":"Stadium","emoji":"🏟️","desc":"Open-air arena PA & slapback","fx":{"reverbMix":0.38,"reverbSize":0.9,"reverbDecay":2.6,"delayMix":0.28,"delayTime":0.42,"delayFeedback":0.28,"highpass":120,"lowpass":8500,"mid":1.8,"gain":1.08},"archetype":"wide-crowd-echo"},
      {"id":"tunnel","cat":"Spaces","name":"Tunnel","emoji":"🚇","desc":"Cylindrical concrete tube echo","fx":{"bpMix":0.32,"bpFreq":720,"bpQ":3.2,"reverbMix":0.32,"reverbSize":0.6,"reverbDecay":1.9,"delayMix":0.36,"delayTime":0.11,"delayFeedback":0.56,"lowpass":6500,"gain":1.08},"archetype":"long-tube-delay"},
      {"id":"forest","cat":"Spaces","name":"Forest","emoji":"🌲","desc":"Open woodland air & canopy bounce","fx":{"reverbMix":0.24,"reverbSize":0.68,"reverbDecay":1.7,"delayMix":0.12,"delayTime":0.18,"delayFeedback":0.18,"highpass":110,"treble":1.5,"chorus":0.12,"noiseMix":0.015,"gain":1.04},"archetype":"open-airy-outdoor"},
      {"id":"mime-mute","cat":"Spaces","name":"Muffled","emoji":"🤐","desc":"Occluded behind a thick wall","fx":{"lowpass":680,"highpass":110,"bass":2.5,"mid":-3,"reverbMix":0.2,"reverbSize":0.35,"reverbDecay":0.9,"gain":1.2},"archetype":"muffled-behind-wall"},
      {"id":"clean-boost","cat":"FX & Utility","name":"Clean Boost","emoji":"✨","desc":"Studio loudness, gate & de-ess polish","fx":{"highpass":75,"bass":1.4,"mid":0.8,"treble":1.8,"gateThreshold":-50,"deEssAmount":0.35,"deEssFreq":6600,"compressorThresh":-15,"compressorRatio":3.5,"gain":1.25},"archetype":"studio-polish-boost"},
      {"id":"vocoder-synth","cat":"FX & Utility","name":"Vocoder Synth","emoji":"🎹","desc":"16-band polyphonic synth talkbox","fx":{"vocoderMix":0.78,"vocoderCarrier":"chord","vocoderBands":16,"harmonyPreset":"power-fifth","harmonyMix":0.2,"chorus":0.35,"reverbMix":0.22,"reverbSize":0.65,"reverbDecay":1.8,"compressorThresh":-18,"compressorRatio":3.5,"gain":1.15},"archetype":"poly-synth-vocoder"},
      {"id":"helium","cat":"FX & Utility","name":"Helium","emoji":"🎈","desc":"Buoyant party balloon voice","fx":{"pitchSemi":6.5,"formant":4.2,"speed":1.08,"highpass":160,"treble":2.5,"chorus":0.25,"gain":1.06},"archetype":"party-chorus-pitched"},
      {"id":"sulfur","cat":"FX & Utility","name":"Sulfur","emoji":"🧪","desc":"Dense hexafluoride deep gas","fx":{"pitchSemi":-8.5,"formant":-6.5,"bass":5,"lowpass":6500,"ringFreq":4,"compressorThresh":-17,"compressorRatio":3.8,"gain":1.14},"archetype":"deep-gas-shift"},
      {"id":"chorus-vox","cat":"FX & Utility","name":"Chorus Vox","emoji":"🎶","desc":"Lush stereo-style vocal ensemble","fx":{"pitchCents":12,"harmonyPreset":"major-chord","harmonyMix":0.24,"chorus":0.72,"delayMix":0.1,"delayTime":0.035,"vibrato":0.14,"vibratoRate":4.2,"reverbMix":0.16,"gain":1.06},"archetype":"wide-doubled"},
      {"id":"flanger-vox","cat":"FX & Utility","name":"Flanger","emoji":"🌀","desc":"Jet-plane comb filter sweep","fx":{"flanger":0.8,"chorus":0.22,"highpass":80,"treble":1.5,"delayMix":0.08,"delayTime":0.02,"delayFeedback":0.35,"gain":1.06},"archetype":"jet-sweep-mod"},
      {"id":"tremolo-vox","cat":"FX & Utility","name":"Tremolo","emoji":"📳","desc":"Rhythmic chopper amplitude pulse","fx":{"tremolo":0.75,"tremoloRate":7.5,"mid":1.5,"compressorThresh":-18,"compressorRatio":3.2,"gain":1.1},"archetype":"amplitude-pulse"},
      {"id":"slowmo","cat":"FX & Utility","name":"Slow-Mo","emoji":"🐢","desc":"Time-stretched half-speed tape","fx":{"speed":0.72,"pitchSemi":-2.5,"formant":-1.5,"lowpass":8500,"reverbMix":0.16,"gain":1.06},"archetype":"speed-shift-slow"},
      {"id":"fasttalk","cat":"FX & Utility","name":"Fast Talk","emoji":"⚡","desc":"Rapid-fire double-speed delivery","fx":{"speed":1.28,"pitchSemi":1.2,"formant":0.8,"highpass":90,"treble":2,"deEssAmount":0.25,"gain":1.05},"archetype":"speed-shift-fast"},
      {"id":"reverse-vibe","cat":"FX & Utility","name":"Reverse","emoji":"↩️","desc":"Backwards oracle tape playback","fx":{"reverse":true,"reverbMix":0.26,"reverbSize":0.7,"reverbDecay":1.8,"delayMix":0.12,"delayTime":0.16,"gain":1.05},"archetype":"reversed-audio"}
    ];

    let PRESET_CATS = ["Ages","Characters","Creatures","Devices","Lo-Fi","Spaces","FX & Utility"];

    function allowPresetUrl(url) {
      if (!url || url === './fx-presets.json') return './fx-presets.json';
      try {
        const u = new URL(url, location.href);
        if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
        if (u.protocol === 'http:' && location.protocol === 'https:') return null;
        return u.href;
      } catch (_) {
        return null;
      }
    }

    function validatePresetPayload(data) {
      if (!data || !Array.isArray(data.presets) || !data.presets.length) return null;
      const presets = [];
      for (const raw of data.presets) {
        if (!raw || typeof raw !== 'object') continue;
        const id = String(raw.id || '').trim();
        if (!id) continue;
        presets.push({
          id,
          cat: String(raw.cat || 'Other').slice(0, 40),
          name: String(raw.name || id).slice(0, 40),
          emoji: String(raw.emoji || '').slice(0, 8),
          desc: String(raw.desc || '').slice(0, 80),
          fx: mergeFx(raw.fx),
          archetype: raw.archetype ? String(raw.archetype).slice(0, 40) : undefined,
          era: raw.era ? String(raw.era).slice(0, 60) : undefined
        });
      }
      if (!presets.length) return null;
      const cats = Array.isArray(data.categories)
        ? data.categories.map((c) => String(c).slice(0, 40)).filter(Boolean)
        : null;
      let fxMeta = null;
      if (Array.isArray(data.fxMeta) && data.fxMeta.length) {
        const groups = [];
        for (const g of data.fxMeta) {
          if (!g || !Array.isArray(g.params)) continue;
          const params = g.params.filter((p) => p && p.key && typeof p.key === 'string');
          if (!params.length) continue;
          groups.push({ group: String(g.group || 'FX').slice(0, 40), params });
        }
        if (groups.length) fxMeta = groups;
      }
      return {
        presets,
        categories: cats,
        defaultFx: data.defaultFx && typeof data.defaultFx === 'object' ? data.defaultFx : null,
        fxMeta
      };
    }

    function commitPresetPayload(parsed) {
      if (parsed.categories && parsed.categories.length) PRESET_CATS = parsed.categories;
      if (parsed.defaultFx) DEFAULT_FX_VALUES = { ...DEFAULT_FX_VALUES, ...parsed.defaultFx };
      if (parsed.fxMeta) FX_META = parsed.fxMeta;
      BUILTIN_PRESETS = parsed.presets;
      if (!S.ui) S.ui = {};
      S.ui.presetCatOpen = sanitizeCatOpen(S.presetCatOpen || S.ui.presetCatOpen);
      S.presetCatOpen = S.ui.presetCatOpen;
      S.presetChain = sanitizePresetChain(S.presetChain);
      S.presetChainMix = sanitizeChainMix(S.presetChainMix, S.presetChain.length);
    }

    async function loadFxPresetsData(silent = true) {
      if (!S.ui) S.ui = { fxSourceMode: 'local', fxRemoteUrl: '' };
      const mode = S.ui.fxSourceMode === 'github' ? 'github' : 'local';
      const remoteUrl = (S.ui.fxRemoteUrl || '').trim();
      let targetUrl = './fx-presets.json';
      if (mode === 'github' && remoteUrl) {
        const allowed = allowPresetUrl(remoteUrl);
        if (!allowed) {
          if (!silent) toast('Remote preset URL must be http(s).', 'error');
          return false;
        }
        targetUrl = allowed;
      }

      try {
        const res = await fetch(targetUrl);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const data = await res.json();
        const parsed = validatePresetPayload(data);
        if (!parsed) throw new Error('Invalid JSON structure');
        commitPresetPayload(parsed);
        rebuildFxPanel();
        renderPresets();
        updateChainBar();
        if (!silent) {
          toast('Loaded ' + BUILTIN_PRESETS.length + ' FX presets from ' + (mode === 'github' ? 'remote URL' : 'local file'));
        }
        return true;
      } catch (err) {
        console.warn('FX preset load warning (using fallback):', err);
        if (mode === 'github' && targetUrl !== './fx-presets.json') {
          try {
            const locRes = await fetch('./fx-presets.json');
            if (locRes.ok) {
              const parsed = validatePresetPayload(await locRes.json());
              if (parsed) {
                commitPresetPayload(parsed);
                rebuildFxPanel();
                renderPresets();
                updateChainBar();
                if (!silent) toast('Remote failed. Loaded ' + BUILTIN_PRESETS.length + ' presets from local file.', 'error');
                return true;
              }
            }
          } catch (_) {}
        }
        if (!silent) {
          toast('Could not load preset file: ' + (err && err.message ? err.message : 'error') + '. Using embedded fallback.', 'error');
        }
        return false;
      }
    }

    /* =========================================================
       State
       ========================================================= */
    const MAX_PRESET_CHAIN = 3;
    const MAX_UNDO = 50;
    /** Max AudioBuffer clones kept across undo+redo (memory guard) */
    const MAX_BUFFER_SNAPSHOTS = 10;
    /** Max recording history buffer length (FIFO) */
    const MAX_RECORD_HISTORY = 10;

    const S = {
      buffer: null,
      playhead: 0,
      playing: false,
      loop: false,
      baking: false,
      recording: false,
      loading: false,
      comparingDry: false,
      fx: defaultFx(),
      presetChain: [],
      presetChainMix: [],
      activePresetId: null,
      activeCustomId: null,
      customSettings: [],
      videoBlobUrl: null,
      videoMeta: null,
      sourceName: '',
      skipIntervalSec: 5,
      lastExportFormat: 'wav',
      advancedLabExpanded: false,
      presetsSection: 'built-in',
      presetCatOpen: Object.fromEntries(PRESET_CATS.map((c) => [c, true])),
      recordSupport: true,
      micLevel: defaultMicLevel(),
      inputGain: defaultInputGain(),
      originalBuffer: null,
      previewBuf: null,
      peakPyramid: null,
      waveZoom: 1,
      waveViewStart: 0,
      lastExportBlob: null,
      lastExportName: '',
      recCountdownTimer: 0,
      previewTimer: 0,
      recMode: 'standalone',
      liveMonitoring: false,
      liveMonitorStream: null,
      liveMonitorSource: null,
      liveMonitorChain: null,
      liveMonitorFeedbackRaf: 0,
      skipMonitorWarn: false,
      visMode: 'waveform',
      xyAxisMode: 'pitch-formant',
      lufsTarget: '-14',
      cueMarkers: [],
      selection: { active: false, start: 0, end: 0 },
      waveTool: 'seek',
      selectionAudition: null,
      ecoActive: false,
      ui: {
        ecoMode: 'auto',
        fxSourceMode: 'local',
        fxRemoteUrl: '',
        maxRecordSec: 180,
        recMode: 'standalone',
        recentPresetIds: [],
        presetSearch: '',
        visMode: 'waveform',
        xyAxisMode: 'pitch-formant',
        lufsTarget: '-14'
      }
    };

    let audioCtx = null;
    let masterGain = null;
    let masterAnalyser = null;
    let playSource = null;
    let playChainCleanup = null;
    let playStartedAt = 0;
    let playOffset = 0;
    let animRaf = 0;
    let mediaStream = null;
    let mediaRecorder = null;
    let recordChunks = [];
    let recordStartTs = 0;
    let recordAnalyser = null;
    let recordMeterRaf = 0;
    let recordGainNode = null;
    let recordScriptNode = null;
    let recordPeakFromScript = 0;
    let recordDest = null;
    let recordUsedLiveGain = false;
    let meterSmoothPeak = 0;
    let persistTimer = 0;
    let xyDragging = false;
    /** FX history (not persisted — session only) */
    let undoStack = [];
    let redoStack = [];
    let historySuspended = false;
    /** Recording history (FIFO queue of max 10 takes) */
    let recordHistory = [];
    let recordHistoryIndex = -1;
    let takeCounter = 0;
    let edgeToastAt = 0;
    let lameLoading = null;
    let longPressTimer = 0;
    let longPressAccel = null;

    /* =========================================================
       DOM
       ========================================================= */
    const $ = (id) => document.getElementById(id);
    const els = {
      btnRecord: $('btnRecord'),
      btnLiveMonitor: $('btnLiveMonitor'),
      cleanupDetails: $('cleanupDetails'),
      gateThreshold: $('gateThreshold'),
      gateThresholdVal: $('gateThresholdVal'),
      btnAutoCalibrateGate: $('btnAutoCalibrateGate'),
      deEssAmount: $('deEssAmount'),
      deEssAmountVal: $('deEssAmountVal'),
      humNotchSelect: $('humNotchSelect'),
      btnUpload: $('btnUpload'),
      btnUndoRecord: $('btnUndoRecord'),
      btnRedoRecord: $('btnRedoRecord'),
      btnDeleteRecord: $('btnDeleteRecord'),
      recModeStandalone: $('recModeStandalone'),
      recModeAppend: $('recModeAppend'),
      recHistoryBar: $('recHistoryBar'),
      recTakeBadge: $('recTakeBadge'),
      fileInput: $('fileInput'),
      dropzone: $('dropzone'),
      meterWrap: $('meterWrap'),
      meterBar: $('meterBar'),
      recTimer: $('recTimer'),
      micLevel: $('micLevel'),
      micLevelVal: $('micLevelVal'),
      inputGain: $('inputGain'),
      inputGainVal: $('inputGainVal'),
      sourceMeta: $('sourceMeta'),
      videoPreview: $('videoPreview'),
      visTabWave: $('visTabWave'),
      visTabSpectrum: $('visTabSpectrum'),
      visTabSpectrogram: $('visTabSpectrogram'),
      wave: $('wave'),
      waveEmpty: $('waveEmpty'),
      bakeOverlay: $('bakeOverlay'),
      timeChip: $('timeChip'),
      btnAddMarker: $('btnAddMarker'),
      btnClearMarkers: $('btnClearMarkers'),
      cueMarkerList: $('cueMarkerList'),
      btnWaveToolSeek: $('btnWaveToolSeek'),
      btnWaveToolSelect: $('btnWaveToolSelect'),
      btnSetIn: $('btnSetIn'),
      btnSetOut: $('btnSetOut'),
      trimInInput: $('trimInInput'),
      trimOutInput: $('trimOutInput'),
      trimSpanBadge: $('trimSpanBadge'),
      btnPlaySelection: $('btnPlaySelection'),
      btnTrimKeep: $('btnTrimKeep'),
      btnCutDelete: $('btnCutDelete'),
      btnTrimSilence: $('btnTrimSilence'),
      btnClearSelection: $('btnClearSelection'),
      btnPlay: $('btnPlay'),
      btnStop: $('btnStop'),
      btnLoop: $('btnLoop'),
      btnSkipN10: $('btnSkipN10'),
      btnSkipN5: $('btnSkipN5'),
      btnSkipP5: $('btnSkipP5'),
      btnSkipP10: $('btnSkipP10'),
      btnMoreSkip: $('btnMoreSkip'),
      frameBtns: $('frameBtns'),
      btnFramePrev: $('btnFramePrev'),
      btnFrameNext: $('btnFrameNext'),
      btnApplyFx: $('btnApplyFx'),
      btnResetFx: $('btnResetFx'),
      btnResetAudio: $('btnResetAudio'),
      btnUndo: $('btnUndo'),
      btnRedo: $('btnRedo'),
      tabBuiltIn: $('tabBuiltIn'),
      tabCustom: $('tabCustom'),
      presetGrid: $('presetGrid'),
      customEmpty: $('customEmpty'),
      chainBar: $('chainBar'),
      chainLabel: $('chainLabel'),
      btnSaveSettings: $('btnSaveSettings'),
      btnClearChain: $('btnClearChain'),
      xyAxisMode: $('xyAxisMode'),
      xyPadCanvas: $('xyPadCanvas'),
      xyLabelX: $('xyLabelX'),
      xyLabelY: $('xyLabelY'),
      labDetails: $('labDetails'),
      fxPanel: $('fxPanel'),
      lufsTargetSelect: $('lufsTargetSelect'),
      lufsMeterReadout: $('lufsMeterReadout'),
      btnExportPrimary: $('btnExportPrimary'),
      btnExportWav24: $('btnExportWav24'),
      btnExportSecondary: $('btnExportSecondary'),
      btnExportOpus: $('btnExportOpus'),
      btnBatchExport: $('btnBatchExport'),
      btnShare: $('btnShare'),
      btnResetProject: $('btnResetProject'),
      btnAB: $('btnAB'),
      btnMatchLoudness: $('btnMatchLoudness'),
      btnZoomIn: $('btnZoomIn'),
      btnZoomOut: $('btnZoomOut'),
      btnZoomReset: $('btnZoomReset'),
      zoomChip: $('zoomChip'),
      presetSearch: $('presetSearch'),
      presetSearchRow: $('presetSearchRow'),
      recentRow: $('recentRow'),
      countdownOverlay: $('countdownOverlay'),
      maxRecordSec: $('maxRecordSec'),
      packModal: $('packModal'),
      packList: $('packList'),
      packCancel: $('packCancel'),
      packConfirm: $('packConfirm'),
      packApplyAllKeep: $('packApplyAllKeep'),
      netPill: $('netPill'),
      netPillText: $('netPillText'),
      btnEcoToggle: $('btnEcoToggle'),
      ecoPillText: $('ecoPillText'),
      ecoModeSelect: $('ecoModeSelect'),
      dialogModal: $('dialogModal'),
      dialogTitle: $('dialogTitle'),
      dialogDesc: $('dialogDesc'),
      dialogInputGroup: $('dialogInputGroup'),
      dialogInput: $('dialogInput'),
      dialogInputLabel: $('dialogInputLabel'),
      dialogCancel: $('dialogCancel'),
      dialogConfirm: $('dialogConfirm'),
      btnSettings: $('btnSettings'),
      toasts: $('toasts'),
      saveModal: $('saveModal'),
      saveName: $('saveName'),
      saveCancel: $('saveCancel'),
      saveConfirm: $('saveConfirm'),
      saveOverwrite: $('saveOverwrite'),
      settingsModal: $('settingsModal'),
      settingsClose: $('settingsClose'),
      skipInterval: $('skipInterval'),
      exportPref: $('exportPref'),
      fxSourceMode: $('fxSourceMode'),
      fxRemoteUrlGroup: $('fxRemoteUrlGroup'),
      fxRemoteUrl: $('fxRemoteUrl'),
      btnReloadFx: $('btnReloadFx'),
      btnExportCustoms: $('btnExportCustoms'),
      btnImportCustoms: $('btnImportCustoms'),
      importCustomsInput: $('importCustomsInput'),
      btnClearSaved: $('btnClearSaved'),
      moreSkipModal: $('moreSkipModal'),
      moreSkipClose: $('moreSkipClose'),
      btnSkipN10m: $('btnSkipN10m'),
      btnSkipP10m: $('btnSkipP10m'),
      resetAudioModal: $('resetAudioModal'),
      resetAudioCancel: $('resetAudioCancel'),
      resetAudioConfirm: $('resetAudioConfirm'),
      deleteRecordModal: $('deleteRecordModal'),
      deleteRecordTitle: $('deleteRecordTitle'),
      deleteRecordDesc: $('deleteRecordDesc'),
      deleteRecordCancel: $('deleteRecordCancel'),
      deleteRecordConfirm: $('deleteRecordConfirm'),
      resetProjectModal: $('resetProjectModal'),
      resetProjectCancel: $('resetProjectCancel'),
      resetProjectConfirm: $('resetProjectConfirm'),
      btnProject: $('btnProject'),
      btnSaveProject: $('btnSaveProject'),
      btnRestoreProject: $('btnRestoreProject'),
      projectModal: $('projectModal'),
      projectModalTitle: $('projectModalTitle'),
      tabProjectSave: $('tabProjectSave'),
      tabProjectRestore: $('tabProjectRestore'),
      panelProjectSave: $('panelProjectSave'),
      panelProjectRestore: $('panelProjectRestore'),
      projectNameInput: $('projectNameInput'),
      projectSaveSummary: $('projectSaveSummary'),
      btnExportProjectFile: $('btnExportProjectFile'),
      btnSaveProjectDb: $('btnSaveProjectDb'),
      btnOpenProjectFile: $('btnOpenProjectFile'),
      projectFileInput: $('projectFileInput'),
      savedProjectsList: $('savedProjectsList'),
      savedProjectsEmpty: $('savedProjectsEmpty'),
      projectModalClose: $('projectModalClose'),
      liveMonitorModal: $('liveMonitorModal'),
      liveMonitorCancel: $('liveMonitorCancel'),
      liveMonitorConfirm: $('liveMonitorConfirm'),
      chkSkipMonitorWarn: $('chkSkipMonitorWarn'),
      batchExportModal: $('batchExportModal'),
      batchPresetGrid: $('batchPresetGrid'),
      batchProgress: $('batchProgress'),
      batchProgressBar: $('batchProgressBar'),
      batchStatusText: $('batchStatusText'),
      btnBatchSelectAll: $('btnBatchSelectAll'),
      btnBatchDeselectAll: $('btnBatchDeselectAll'),
      batchExportCancel: $('batchExportCancel'),
      batchExportStart: $('batchExportStart'),
      workflowBanner: $('workflowBanner'),
      stepCapture: $('stepCapture'),
      stepTransform: $('stepTransform'),
      stepExport: $('stepExport'),
      workflowHintText: $('workflowHintText'),
      cardSource: $('cardSource'),
      cardWave: $('cardWave'),
      deckTabs: $('deckTabs'),
      tabDeckPresets: $('tabDeckPresets'),
      tabDeckXy: $('tabDeckXy'),
      tabDeckLab: $('tabDeckLab'),
      tabDeckExport: $('tabDeckExport'),
      tabDeckAll: $('tabDeckAll'),
      panelPresets: $('panelPresets'),
      panelXyCleanup: $('panelXyCleanup'),
      panelLab: $('panelLab'),
      panelExport: $('panelExport'),
      catFilterBar: $('catFilterBar'),
      demoVoiceRow: $('demoVoiceRow'),
      demoVoiceSelect: $('demoVoiceSelect'),
      btnLoadDemoVoice: $('btnLoadDemoVoice'),
      ambienceDetails: $('ambienceDetails'),
      ambiencePresetSelect: $('ambiencePresetSelect'),
      ambienceQuickChips: $('ambienceQuickChips'),
      ambienceMix: $('ambienceMix'),
      ambienceMixVal: $('ambienceMixVal'),
      ambienceDuck: $('ambienceDuck'),
      ambienceDuckVal: $('ambienceDuckVal'),
      ambienceTone: $('ambienceTone'),
      ambienceToneVal: $('ambienceToneVal'),
      btnClearAmbience: $('btnClearAmbience')
    };

    /* =========================================================
       Utilities
       ========================================================= */
    function toast(msg, type = '') {
      const el = document.createElement('div');
      el.className = 'toast' + (type ? ' ' + type : '');
      el.textContent = msg;
      els.toasts.appendChild(el);
      setTimeout(() => {
        el.style.opacity = '0';
        el.style.transition = 'opacity .25s';
        setTimeout(() => el.remove(), 280);
      }, 2800);
    }

    function fmtTime(sec, withCs = true) {
      if (!isFinite(sec) || sec < 0) sec = 0;
      const m = Math.floor(sec / 60);
      const s = Math.floor(sec % 60);
      const cs = Math.floor((sec % 1) * 100);
      const base = m + ':' + String(s).padStart(2, '0');
      return withCs ? base + '.' + String(cs).padStart(2, '0') : base;
    }

    function uid() {
      if (crypto.randomUUID) return crypto.randomUUID();
      return 'c_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
    }

    function isTypingTarget(el) {
      if (!el) return false;
      const tag = (el.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
      if (el.isContentEditable) return true;
      if (el.closest && el.closest('[contenteditable="true"]')) return true;
      return false;
    }

    function fxEqualsDefault(fx) {
      const d = defaultFx();
      for (const k of Object.keys(d)) {
        if (fx[k] !== d[k]) return false;
      }
      return true;
    }

    function fxParamMeta(key) {
      for (const g of FX_META) {
        for (const p of g.params) {
          if (p.key === key) return p;
        }
      }
      return null;
    }

    function clampFxValue(key, v) {
      const d = defaultFx();
      if (!(key in d)) return v;
      if (typeof d[key] === 'boolean') return !!v;
      if (typeof d[key] === 'string') return String(v);
      const n = Number(v);
      if (!isFinite(n)) return d[key];
      const meta = fxParamMeta(key);
      if (meta && meta.min != null && meta.max != null) {
        return Math.min(meta.max, Math.max(meta.min, n));
      }
      return n;
    }

    function mergeFx(partial) {
      const out = defaultFx();
      if (!partial || typeof partial !== 'object') return out;
      for (const k of Object.keys(out)) {
        if (k in partial) out[k] = clampFxValue(k, partial[k]);
      }
      return out;
    }

    function isFxWet() {
      if (S.fx.ambiencePreset && S.fx.ambiencePreset !== 'none' && (S.fx.ambienceMix || 0) > 0.001) return true;
      if (!fxEqualsDefault(S.fx)) return true;
      const defIn = defaultInputGain();
      return Math.abs((S.inputGain || 1) - defIn) > 1e-4;
    }

    function sanitizeChainMix(arr, len) {
      const n = Math.max(0, len || 0);
      const out = [];
      for (let i = 0; i < n; i++) {
        out.push(clampNum(arr && arr[i], 0, 1, 1));
      }
      return out;
    }

    function ensureAudioCtx() {
      if (!audioCtx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        audioCtx = new AC();
        masterGain = audioCtx.createGain();
        masterGain.gain.value = 1;
        masterAnalyser = audioCtx.createAnalyser();
        masterAnalyser.fftSize = 256;
        masterAnalyser.smoothingTimeConstant = 0.8;
        masterGain.connect(masterAnalyser);
        masterAnalyser.connect(audioCtx.destination);
      }
      if (audioCtx.state === 'suspended') {
        audioCtx.resume().catch(() => {});
      }
      return audioCtx;
    }

    let audioIdleTimer = 0;
    function markAudioActive() {
      clearTimeout(audioIdleTimer);
      audioIdleTimer = 0;
      if (audioCtx && audioCtx.state === 'suspended') {
        audioCtx.resume().catch(() => {});
      }
    }

    function checkIdleAudio() {
      clearTimeout(audioIdleTimer);
      if (S.playing || S.recording || S.liveMonitoring || S.baking) return;
      audioIdleTimer = setTimeout(() => {
        if (!S.playing && !S.recording && !S.liveMonitoring && !S.baking && audioCtx && audioCtx.state === 'running') {
          audioCtx.suspend().catch(() => {});
        }
      }, 4000);
    }

    /* =========================================================
       iPad & Mobile Power Eco Engine
       ========================================================= */
    function isIPadOrIOS() {
      if (typeof navigator === 'undefined') return false;
      const ua = navigator.userAgent || '';
      const isIOS = /iPad|iPhone|iPod/.test(ua);
      const isIPadOS = (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
      return isIOS || isIPadOS;
    }

    let batteryDischarging = false;
    let batteryLevel = 1;
    function initBatteryMonitor() {
      if (typeof navigator !== 'undefined' && typeof navigator.getBattery === 'function') {
        navigator.getBattery().then((b) => {
          const update = () => {
            batteryDischarging = !b.charging;
            batteryLevel = b.level;
            applyEcoModeState();
          };
          update();
          b.addEventListener('chargingchange', update);
          b.addEventListener('levelchange', update);
        }).catch(() => {});
      }
    }

    function isEcoActive() {
      const mode = (S.ui && S.ui.ecoMode) || 'auto';
      if (mode === 'on') return true;
      if (mode === 'off') return false;
      // Auto: active if iPad/iOS device or on discharging battery
      if (isIPadOrIOS()) return true;
      if (batteryDischarging && batteryLevel <= 0.4) return true;
      return false;
    }

    function getMinFrameIntervalMs() {
      // 24 FPS (~41.67ms) in Eco Mode on iPad / mobile / battery, uncapped otherwise
      return S.ecoActive ? (1000 / 24) : 0;
    }

    function applyEcoModeState() {
      const active = isEcoActive();
      S.ecoActive = active;
      document.documentElement.classList.toggle('power-eco', active);
      if (els.ecoPillText) {
        const mode = (S.ui && S.ui.ecoMode) || 'auto';
        if (active) {
          els.ecoPillText.textContent = mode === 'on' ? 'Eco: 24 FPS' : 'Eco: 24 FPS (Auto)';
        } else {
          els.ecoPillText.textContent = mode === 'off' ? 'Eco: Off' : 'Eco: 60 FPS';
        }
      }
      if (els.btnEcoToggle) {
        els.btnEcoToggle.classList.toggle('active', active);
        els.btnEcoToggle.setAttribute('aria-pressed', String(active));
      }
      if (els.ecoModeSelect && S.ui && S.ui.ecoMode) {
        els.ecoModeSelect.value = S.ui.ecoMode;
      }
    }

    function toggleEcoModeSetting() {
      const cur = (S.ui && S.ui.ecoMode) || 'auto';
      const next = cur === 'auto' ? 'on' : (cur === 'on' ? 'off' : 'auto');
      S.ui = S.ui || {};
      S.ui.ecoMode = next;
      applyEcoModeState();
      schedulePersist();
      const label = next === 'auto' ? 'Auto (iPad & Battery)' : (next === 'on' ? 'Always On (24 FPS Eco)' : 'Off (Full Performance)');
      toast('Power Eco: ' + label, 'ok');
    }

    const fxApi = (window.VoxFx && window.VoxFx.createFxEngine)
      ? window.VoxFx.createFxEngine({
          ensureAudioCtx,
          getInputGain: () => S.inputGain || 1,
          LIMITER_PEAK,
          TARGET_PEAK,
          MAX_NORM_GAIN,
          SKIP_NORM_PEAK
        })
      : null;
    if (!fxApi) throw new Error('VoxFx engine failed to load');
    const cloneBuffer = fxApi.cloneBuffer;
    const concatBuffersWithCrossfade = fxApi.concatBuffersWithCrossfade;
    const toMonoBuffer = fxApi.toMonoBuffer;
    const applyBufferGain = fxApi.applyBufferGain;
    const normalizeRecordingBuffer = fxApi.normalizeRecordingBuffer;
    const peakOf = fxApi.peakOf;
    const applyPeakLimiter = fxApi.applyPeakLimiter;
    const reverseBuffer = fxApi.reverseBuffer;
    const applyNoiseGate = fxApi.applyNoiseGate;
    const applyHumNotch = fxApi.applyHumNotch;
    const applyDeEsser = fxApi.applyDeEsser;
    const applyFadesAndCrush = fxApi.applyFadesAndCrush;
    const pitchShiftKeepLength = fxApi.pitchShiftKeepLength;
    const pitchShiftPhaseVocoder = fxApi.pitchShiftPhaseVocoder;
    const applyHarmonizer = fxApi.applyHarmonizer;
    const applyVocoder = fxApi.applyVocoder;
    const computeLUFS = fxApi.computeLUFS;
    const normalizeToLUFS = fxApi.normalizeToLUFS;
    const buildPeakPyramid = fxApi.buildPeakPyramid;
    const buildFxChain = fxApi.buildFxChain;
    const bufferToWav = fxApi.bufferToWav;
    const bufferToWav24 = fxApi.bufferToWav24;
    const bufferToOpus = fxApi.bufferToOpus;
    const bufferToBase64Wav = fxApi.bufferToBase64Wav;
    const base64ToArrayBuffer = fxApi.base64ToArrayBuffer;
    const getDemoVoices = fxApi.getDemoVoices;
    const synthesizeDemoVoice = fxApi.synthesizeDemoVoice;
    const getAmbienceScenes = fxApi.getAmbienceScenes;
    const applyAmbienceSoundscape = fxApi.applyAmbienceSoundscape;
    const findZeroCrossing = fxApi.findZeroCrossing;
    const trimBuffer = fxApi.trimBuffer;
    const cutBufferRegion = fxApi.cutBufferRegion;
    const trimSilence = fxApi.trimSilence;

    /* =========================================================
       Persistence
       ========================================================= */
    function clampNum(v, min, max, fallback) {
      const n = Number(v);
      if (!isFinite(n)) return fallback;
      return Math.min(max, Math.max(min, n));
    }

    function defaultPersisted() {
      return {
        version: 3,
        ui: {
          loop: false,
          skipIntervalSec: 5,
          lastExportFormat: 'wav',
          advancedLabExpanded: false,
          presetsSection: 'built-in',
          micLevel: defaultMicLevel(),
          inputGain: defaultInputGain(),
          ecoMode: 'auto',
          fxSourceMode: 'local',
          fxRemoteUrl: '',
          maxRecordSec: 180,
          recMode: 'standalone',
          recentPresetIds: [],
          presetSearch: '',
          presetCatOpen: Object.fromEntries(PRESET_CATS.map((c) => [c, true]))
        },
        fx: defaultFx(),
        // dual-chain of built-in preset ids (click order)
        presetChain: [],
        presetChainMix: [],
        activePresetId: null, // legacy single-select; migrated into presetChain
        activeCustomId: null,
        customSettings: [],
        updatedAt: Date.now()
      };
    }

    function sanitizePresetChain(arr) {
      if (!Array.isArray(arr)) return [];
      const known = new Set(BUILTIN_PRESETS.map((p) => p.id));
      const out = [];
      for (const id of arr) {
        const s = String(id);
        if (!known.has(s)) continue;
        if (out.includes(s)) continue;
        out.push(s);
        if (out.length >= MAX_PRESET_CHAIN) break;
      }
      return out;
    }

    function sanitizeCatOpen(raw) {
      const base = Object.fromEntries(PRESET_CATS.map((c) => [c, true]));
      if (!raw || typeof raw !== 'object') return base;
      for (const c of PRESET_CATS) {
        if (typeof raw[c] === 'boolean') base[c] = raw[c];
      }
      return base;
    }

    function loadPersisted() {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return defaultPersisted();
        const data = JSON.parse(raw);
        if (!data || typeof data !== 'object') throw new Error('bad shape');
        const base = defaultPersisted();
        const ui = { ...base.ui, ...(data.ui || {}) };
        if (![1, 3, 5, 10].includes(ui.skipIntervalSec)) ui.skipIntervalSec = 5;
        if (ui.lastExportFormat !== 'wav' && ui.lastExportFormat !== 'mp3') ui.lastExportFormat = 'wav';
        if (ui.fxSourceMode !== 'local' && ui.fxSourceMode !== 'github') ui.fxSourceMode = 'local';
        if (typeof ui.fxRemoteUrl !== 'string') ui.fxRemoteUrl = '';
        ui.maxRecordSec = [60, 180, 300, 600].includes(Number(ui.maxRecordSec)) ? Number(ui.maxRecordSec) : 180;
        ui.recMode = ui.recMode === 'append' ? 'append' : 'standalone';
        ui.presetsSection = ui.presetsSection === 'custom' ? 'custom' : 'built-in';
        ui.recentPresetIds = Array.isArray(ui.recentPresetIds) ? ui.recentPresetIds.map(String).slice(0, 8) : [];
        ui.presetSearch = typeof ui.presetSearch === 'string' ? ui.presetSearch.slice(0, 40) : '';
        ui.micLevel = clampNum(ui.micLevel, 1, 12, defaultMicLevel());
        ui.inputGain = clampNum(ui.inputGain, 0.5, 9, defaultInputGain());
        ui.ecoMode = ['auto', 'on', 'off'].includes(ui.ecoMode) ? ui.ecoMode : 'auto';
        ui.presetCatOpen = sanitizeCatOpen(ui.presetCatOpen);
        const customs = Array.isArray(data.customSettings)
          ? data.customSettings.slice(0, MAX_CUSTOMS).map((c) => ({
              id: String(c.id || uid()),
              name: String(c.name || 'Untitled').slice(0, 40),
              fx: mergeFx(c.fx),
              presetChain: sanitizePresetChain(
                Array.isArray(c.presetChain) ? c.presetChain : (c.presetId ? [c.presetId] : [])
              ),
              presetChainMix: sanitizeChainMix(c.presetChainMix, Array.isArray(c.presetChain) ? c.presetChain.length : 0),
              createdAt: Number(c.createdAt) || Date.now(),
              updatedAt: Number(c.updatedAt) || Date.now(),
              emoji: c.emoji || '⭐'
            }))
          : [];
        // Migrate legacy activePresetId → presetChain
        let chain = sanitizePresetChain(data.presetChain);
        if (!chain.length && data.activePresetId) {
          chain = sanitizePresetChain([data.activePresetId]);
        }
        return {
          version: 3,
          ui,
          fx: mergeFx(data.fx),
          presetChain: chain,
          presetChainMix: sanitizeChainMix(data.presetChainMix, chain.length),
          activePresetId: chain.length ? chain[chain.length - 1] : null,
          activeCustomId: data.activeCustomId || null,
          customSettings: customs,
          updatedAt: Number(data.updatedAt) || Date.now()
        };
      } catch (e) {
        try {
          const raw = localStorage.getItem(STORAGE_KEY);
          if (raw) localStorage.setItem(STORAGE_KEY + '.bak', raw);
        } catch (_) {}
        toast('Settings were reset (storage was unreadable).', 'error');
        return defaultPersisted();
      }
    }

    function snapshotPersisted() {
      return {
        version: 3,
        ui: {
          loop: !!S.loop,
          skipIntervalSec: S.skipIntervalSec,
          lastExportFormat: S.lastExportFormat,
          advancedLabExpanded: !!S.advancedLabExpanded,
          presetsSection: S.presetsSection || 'built-in',
          micLevel: S.micLevel,
          inputGain: S.inputGain,
          ecoMode: (S.ui && S.ui.ecoMode) || 'auto',
          fxSourceMode: (S.ui && S.ui.fxSourceMode) || 'local',
          fxRemoteUrl: (S.ui && S.ui.fxRemoteUrl) || '',
          maxRecordSec: (S.ui && S.ui.maxRecordSec) || 180,
          recMode: S.recMode || (S.ui && S.ui.recMode) || 'standalone',
          recentPresetIds: (S.ui && S.ui.recentPresetIds) ? S.ui.recentPresetIds.slice(0, 8) : [],
          presetSearch: (S.ui && S.ui.presetSearch) || '',
          presetCatOpen: { ...S.presetCatOpen },
          workspaceTab: (S.ui && S.ui.workspaceTab) || 'presets',
          presetCatFilter: (S.ui && S.ui.presetCatFilter) || 'all'
        },
        fx: { ...S.fx },
        presetChain: [...S.presetChain],
        presetChainMix: sanitizeChainMix(S.presetChainMix, S.presetChain.length),
        activePresetId: S.presetChain.length ? S.presetChain[S.presetChain.length - 1] : null,
        activeCustomId: S.activeCustomId,
        customSettings: S.customSettings,
        updatedAt: Date.now()
      };
    }

    function savePersistedNow() {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshotPersisted()));
      } catch (e) {
        if (e && (e.name === 'QuotaExceededError' || e.code === 22)) {
          toast('Storage full — settings may not persist.', 'error');
        }
      }
    }

    function schedulePersist() {
      clearTimeout(persistTimer);
      persistTimer = setTimeout(savePersistedNow, 300);
    }

    function flushPersist() {
      clearTimeout(persistTimer);
      persistTimer = 0;
      savePersistedNow();
    }

    function applyPersisted(p) {
      S.loop = !!p.ui.loop;
      S.skipIntervalSec = p.ui.skipIntervalSec;
      S.lastExportFormat = p.ui.lastExportFormat;
      S.advancedLabExpanded = !!p.ui.advancedLabExpanded;
      S.presetsSection = p.ui.presetsSection === 'custom' ? 'custom' : 'built-in';
      S.fx = mergeFx(p.fx);
      S.presetChain = sanitizePresetChain(p.presetChain);
      S.presetChainMix = sanitizeChainMix(p.presetChainMix, S.presetChain.length);
      S.activePresetId = S.presetChain.length ? S.presetChain[S.presetChain.length - 1] : null;
      S.activeCustomId = p.activeCustomId;
      S.customSettings = p.customSettings || [];
      S.presetCatOpen = sanitizeCatOpen(p.ui.presetCatOpen);
      S.micLevel = clampNum(p.ui.micLevel, 1, 12, defaultMicLevel());
      S.inputGain = clampNum(p.ui.inputGain, 0.5, 9, defaultInputGain());
      S.ui = S.ui || {};
      S.ui.ecoMode = ['auto', 'on', 'off'].includes(p.ui.ecoMode) ? p.ui.ecoMode : 'auto';
      S.ui.fxSourceMode = p.ui.fxSourceMode === 'github' ? 'github' : 'local';
      S.ui.fxRemoteUrl = typeof p.ui.fxRemoteUrl === 'string' ? p.ui.fxRemoteUrl : '';
      S.ui.maxRecordSec = [60, 180, 300, 600].includes(Number(p.ui.maxRecordSec)) ? Number(p.ui.maxRecordSec) : 180;
      S.ui.recentPresetIds = Array.isArray(p.ui.recentPresetIds) ? p.ui.recentPresetIds.map(String).slice(0, 8) : [];
      S.ui.presetSearch = typeof p.ui.presetSearch === 'string' ? p.ui.presetSearch : '';
      S.ui.presetCatOpen = S.presetCatOpen;
      S.ui.workspaceTab = (p.ui && p.ui.workspaceTab) || 'presets';
      S.ui.presetCatFilter = (p.ui && p.ui.presetCatFilter) || 'all';
      const m = (p.ui && p.ui.recMode) || S.recMode || 'standalone';
      S.recMode = m === 'append' ? 'append' : 'standalone';
      S.ui.recMode = S.recMode;

      els.btnLoop.classList.toggle('active-loop', S.loop);
      els.btnLoop.setAttribute('aria-pressed', String(S.loop));
      els.labDetails.open = S.advancedLabExpanded;
      els.skipInterval.value = String(S.skipIntervalSec);
      els.exportPref.value = S.lastExportFormat;
      if (els.maxRecordSec) els.maxRecordSec.value = String(S.ui.maxRecordSec);
      if (els.presetSearch) els.presetSearch.value = S.ui.presetSearch;
      if (els.fxSourceMode) els.fxSourceMode.value = S.ui.fxSourceMode;
      if (els.fxRemoteUrl) els.fxRemoteUrl.value = S.ui.fxRemoteUrl;
      if (els.fxRemoteUrlGroup) els.fxRemoteUrlGroup.hidden = (S.ui.fxSourceMode !== 'github');
      if (els.ecoModeSelect) els.ecoModeSelect.value = S.ui.ecoMode;
      applyEcoModeState();
      if (els.recModeStandalone && els.recModeAppend) {
        if (S.recMode === 'append') els.recModeAppend.checked = true;
        else els.recModeStandalone.checked = true;
      }
      syncGainSlidersUI();
      updateSkipLabels();
      updateExportButtons();
      setPresetTab(S.presetsSection, false);
      setWorkspaceTab(S.ui.workspaceTab, false);
      setPresetCatFilter(S.ui.presetCatFilter, false);
      updateChainBar();
      updateUndoButtons();
      updateRecordHistoryUI();
    }

    /* =========================================================
       Undo / Redo (session history — not localStorage)
       - FX-only: chain (up to 3) + Advanced Lab + inputGain
       - Audio steps: clone S.buffer for Apply FX / Reset original
       - Dedupes identical consecutive FX-only states; caps buffer clones
       ========================================================= */
    function snapshotHistory(opts = {}) {
      const includeBuffer = !!opts.includeBuffer && !!S.buffer;
      return {
        kind: includeBuffer ? 'audio' : 'fx',
        fx: { ...S.fx },
        presetChain: [...S.presetChain],
        presetChainMix: sanitizeChainMix(S.presetChainMix, S.presetChain.length),
        activeCustomId: S.activeCustomId,
        inputGain: S.inputGain,
        playhead: S.playhead,
        selection: S.selection ? { ...S.selection } : { active: false, start: 0, end: 0 },
        cueMarkers: S.cueMarkers ? JSON.parse(JSON.stringify(S.cueMarkers)) : [],
        hasBuffer: includeBuffer,
        bufferDropped: false,
        buffer: includeBuffer ? cloneBuffer(S.buffer) : null
      };
    }

    function releaseSnapBuffer(snap) {
      if (!snap) return;
      snap.buffer = null;
      if (snap.hasBuffer) snap.bufferDropped = true;
      snap.hasBuffer = false;
    }

    function releaseSnap(snap) {
      releaseSnapBuffer(snap);
    }

    function countBufferSnaps() {
      let n = 0;
      for (const s of undoStack) if (s && s.hasBuffer && s.buffer) n++;
      for (const s of redoStack) if (s && s.hasBuffer && s.buffer) n++;
      return n;
    }

    /** Drop oldest buffer clones first (undo bottom, then redo bottom). */
    function pruneBufferSnapshots() {
      while (countBufferSnaps() > MAX_BUFFER_SNAPSHOTS) {
        let dropped = false;
        for (let i = 0; i < undoStack.length; i++) {
          if (undoStack[i].hasBuffer && undoStack[i].buffer) {
            releaseSnapBuffer(undoStack[i]);
            dropped = true;
            break;
          }
        }
        if (dropped) continue;
        for (let i = 0; i < redoStack.length; i++) {
          if (redoStack[i].hasBuffer && redoStack[i].buffer) {
            releaseSnapBuffer(redoStack[i]);
            dropped = true;
            break;
          }
        }
        if (!dropped) break;
      }
    }

    function trimHistoryLength() {
      while (undoStack.length > MAX_UNDO) releaseSnap(undoStack.shift());
      while (redoStack.length > MAX_UNDO) releaseSnap(redoStack.shift());
      pruneBufferSnapshots();
    }

    function fxStateEqual(a, b) {
      if (!a || !b) return false;
      if (a.hasBuffer || b.hasBuffer) return false;
      if (clampNum(a.inputGain, 0.5, 9, 1) !== clampNum(b.inputGain, 0.5, 9, 1)) return false;
      if ((a.activeCustomId || null) !== (b.activeCustomId || null)) return false;
      const ca = (a.presetChain || []).join('\0');
      const cb = (b.presetChain || []).join('\0');
      if (ca !== cb) return false;
      const ma = (a.presetChainMix || []).map((v) => clampNum(v, 0, 1, 1)).join(',');
      const mb = (b.presetChainMix || []).map((v) => clampNum(v, 0, 1, 1)).join(',');
      if (ma !== mb) return false;
      const keys = Object.keys(defaultFx());
      for (const k of keys) {
        const va = a.fx[k];
        const vb = b.fx[k];
        if (typeof va === 'number' || typeof vb === 'number') {
          if (Math.abs((va || 0) - (vb || 0)) > 1e-5) return false;
        } else if (va !== vb) return false;
      }
      return true;
    }

    function restoreBufferFromSnap(snap) {
      if (!snap || !snap.hasBuffer || !snap.buffer) return false;
      stopPlayback(false);
      S.buffer = cloneBuffer(snap.buffer);
      S.peakPyramid = buildPeakPyramid(S.buffer);
      invalidatePreview();
      const dur = S.buffer.duration || 0;
      S.playhead = Math.max(0, Math.min(dur, snap.playhead || 0));
      els.waveEmpty.classList.add('hidden');
      if (S.sourceName) {
        els.sourceMeta.textContent =
          S.sourceName + ' · mono · ' + fmtTime(dur, false) + ' · ' + S.buffer.sampleRate + ' Hz';
      }
      updateTimeChip();
      drawWave();
      syncVideo();
      return true;
    }

    function applyHistory(snap) {
      if (!snap) return;
      historySuspended = true;
      const wasPlaying = S.playing;
      stopPlayback(false);

      S.fx = mergeFx(snap.fx);
      S.presetChain = sanitizePresetChain(snap.presetChain);
      S.presetChainMix = sanitizeChainMix(snap.presetChainMix, S.presetChain.length);
      S.activePresetId = S.presetChain.length ? S.presetChain[S.presetChain.length - 1] : null;
      S.activeCustomId = snap.activeCustomId || null;
      S.inputGain = clampNum(snap.inputGain, 0.5, 9, defaultInputGain());

      if (snap.hasBuffer && snap.buffer) {
        restoreBufferFromSnap(snap);
      } else if (S.buffer) {
        S.playhead = Math.max(0, Math.min(S.buffer.duration, snap.playhead || S.playhead || 0));
        updateTimeChip();
        drawWave();
        if (snap.bufferDropped || (snap.kind === 'audio' && !snap.buffer)) {
          toast('Undo restored FX only — audio snapshot was dropped to save memory.');
        }
      }
      invalidatePreview();

      if (snap.selection) {
        S.selection = { ...snap.selection };
      } else {
        S.selection = { active: false, start: 0, end: 0 };
      }
      if (Array.isArray(snap.cueMarkers)) {
        S.cueMarkers = JSON.parse(JSON.stringify(snap.cueMarkers));
        renderCueMarkers();
      }
      updateTrimUI();

      rebuildFxPanel();
      syncGainSlidersUI();
      renderPresets();
      updateChainBar();
      updateTransportEnabled();
      schedulePersist();
      historySuspended = false;
      updateUndoButtons();
      if (wasPlaying && S.buffer) startPlayback();
    }

    /**
     * @param {{ includeBuffer?: boolean }} [opts]
     * includeBuffer: true when working audio is about to change (Apply FX / Reset original)
     */
    function pushHistory(opts = {}) {
      if (historySuspended) return;
      const snap = snapshotHistory(opts);
      const last = undoStack[undoStack.length - 1];
      // Skip no-op consecutive FX-only states (same chain + sliders)
      if (!snap.hasBuffer && last && fxStateEqual(last, snap)) return;
      undoStack.push(snap);
      // New branch kills redo
      while (redoStack.length) releaseSnap(redoStack.pop());
      trimHistoryLength();
      updateUndoButtons();
    }

    function undoFx() {
      if (!undoStack.length) return;
      const target = undoStack[undoStack.length - 1];
      // Capture current for redo; include audio if this step (or target) is audio-related
      const needBuf = !!(target && (target.hasBuffer || target.kind === 'audio'));
      const current = snapshotHistory({ includeBuffer: needBuf });
      redoStack.push(current);
      trimHistoryLength();
      applyHistory(undoStack.pop());
      const audioOk = target && target.buffer && (target.hasBuffer || target.kind === 'audio');
      const audioDropped = target && target.kind === 'audio' && !target.buffer;
      toast(audioDropped ? 'Undo (FX only — audio snapshot dropped)' : audioOk ? 'Undo (audio + FX)' : 'Undo');
    }

    function redoFx() {
      if (!redoStack.length) return;
      const target = redoStack[redoStack.length - 1];
      const needBuf = !!(target && (target.hasBuffer || target.kind === 'audio'));
      undoStack.push(snapshotHistory({ includeBuffer: needBuf }));
      trimHistoryLength();
      applyHistory(redoStack.pop());
      const audioOk = target && target.buffer && (target.hasBuffer || target.kind === 'audio');
      const audioDropped = target && target.kind === 'audio' && !target.buffer;
      toast(audioDropped ? 'Redo (FX only — audio snapshot dropped)' : audioOk ? 'Redo (audio + FX)' : 'Redo');
    }

    function updateUndoButtons() {
      if (els.btnUndo) els.btnUndo.disabled = undoStack.length === 0;
      if (els.btnRedo) els.btnRedo.disabled = redoStack.length === 0;
    }

    function clearHistory() {
      while (undoStack.length) releaseSnap(undoStack.pop());
      while (redoStack.length) releaseSnap(redoStack.pop());
      updateUndoButtons();
    }

    /* =========================================================
       Recording History (FIFO buffer, max 10 takes)
       ========================================================= */
    function updateRecordHistoryUI() {
      const hasHistory = recordHistory.length > 0;
      const canUndo = recordHistoryIndex > 0;
      const canRedo = recordHistoryIndex >= 0 && recordHistoryIndex < recordHistory.length - 1;
      const isBusy = S.baking || S.recording || S.loading;

      if (els.btnUndoRecord) {
        els.btnUndoRecord.disabled = !canUndo || isBusy;
        els.btnUndoRecord.title = canUndo
          ? 'Undo to ' + (recordHistory[recordHistoryIndex - 1] ? recordHistory[recordHistoryIndex - 1].name : ('Take ' + recordHistoryIndex)) + ' (Alt+Z)'
          : 'Undo recording take (Alt+Z)';
      }
      if (els.btnRedoRecord) {
        els.btnRedoRecord.disabled = !canRedo || isBusy;
        els.btnRedoRecord.title = canRedo
          ? 'Redo to ' + (recordHistory[recordHistoryIndex + 1] ? recordHistory[recordHistoryIndex + 1].name : ('Take ' + (recordHistoryIndex + 2))) + ' (Alt+Y)'
          : 'Redo recording take (Alt+Y)';
      }
      if (els.btnDeleteRecord) {
        els.btnDeleteRecord.disabled = !hasHistory || isBusy;
        els.btnDeleteRecord.title = hasHistory
          ? 'Permanently delete ' + (recordHistory[recordHistoryIndex] ? recordHistory[recordHistoryIndex].name : 'this recording')
          : 'Delete recording take forever';
      }
      if (els.recHistoryBar) {
        els.recHistoryBar.hidden = !hasHistory;
      }
      if (els.recTakeBadge && hasHistory && recordHistoryIndex >= 0) {
        const activeTake = recordHistory[recordHistoryIndex];
        const label = activeTake ? activeTake.name : ('Take ' + (recordHistoryIndex + 1));
        els.recTakeBadge.textContent = label + ' (' + (recordHistoryIndex + 1) + '/' + recordHistory.length + ')';
      }
    }

    function pushRecordTake(buf, meta = {}) {
      if (!buf) return;
      takeCounter++;
      // If user had undone to an earlier take, discard future redo branch
      if (recordHistoryIndex >= 0 && recordHistoryIndex < recordHistory.length - 1) {
        recordHistory = recordHistory.slice(0, recordHistoryIndex + 1);
      }
      const takeName = meta.name || ('Take ' + takeCounter);
      const entry = {
        id: uid(),
        name: takeName,
        buffer: cloneBuffer(buf),
        duration: buf.duration,
        sampleRate: buf.sampleRate,
        createdAt: Date.now()
      };
      recordHistory.push(entry);
      // FIFO eviction: remove oldest take when buffer length exceeds max (10)
      while (recordHistory.length > MAX_RECORD_HISTORY) {
        recordHistory.shift();
      }
      recordHistoryIndex = recordHistory.length - 1;
      updateRecordHistoryUI();
    }

    function undoRecording() {
      if (recordHistoryIndex <= 0 || !recordHistory.length || S.recording || S.baking) return;
      recordHistoryIndex--;
      const target = recordHistory[recordHistoryIndex];
      if (!target || !target.buffer) return;
      setBuffer(cloneBuffer(target.buffer), {
        name: target.name,
        clearVideo: true,
        fromRecHistory: true
      });
      updateRecordHistoryUI();
      toast('Restored ' + target.name + ' (' + (recordHistoryIndex + 1) + '/' + recordHistory.length + ')', 'ok');
    }

    function redoRecording() {
      if (recordHistoryIndex < 0 || recordHistoryIndex >= recordHistory.length - 1 || S.recording || S.baking) return;
      recordHistoryIndex++;
      const target = recordHistory[recordHistoryIndex];
      if (!target || !target.buffer) return;
      setBuffer(cloneBuffer(target.buffer), {
        name: target.name,
        clearVideo: true,
        fromRecHistory: true
      });
      updateRecordHistoryUI();
      toast('Restored ' + target.name + ' (' + (recordHistoryIndex + 1) + '/' + recordHistory.length + ')', 'ok');
    }

    function deleteCurrentRecord() {
      if (recordHistoryIndex < 0 || recordHistoryIndex >= recordHistory.length || !recordHistory.length) return;
      const deletedName = recordHistory[recordHistoryIndex].name;
      recordHistory.splice(recordHistoryIndex, 1);
      if (recordHistory.length > 0) {
        if (recordHistoryIndex >= recordHistory.length) {
          recordHistoryIndex = recordHistory.length - 1;
        }
        const target = recordHistory[recordHistoryIndex];
        if (target && target.buffer) {
          setBuffer(cloneBuffer(target.buffer), {
            name: target.name,
            clearVideo: true,
            fromRecHistory: true
          });
        }
        updateRecordHistoryUI();
        toast('Permanently deleted ' + deletedName + '. Active: ' + target.name + ' (' + (recordHistoryIndex + 1) + '/' + recordHistory.length + ')', 'ok');
      } else {
        recordHistoryIndex = -1;
        stopPlayback(true);
        setDry(false, false);
        S.buffer = null;
        S.originalBuffer = null;
        S.playhead = 0;
        S.sourceName = '';
        clearHistory();
        revokeVideo();
        els.waveEmpty.classList.remove('hidden');
        if (els.sourceMeta) els.sourceMeta.textContent = '';
        updateUndoButtons();
        updateRecordHistoryUI();
        updateTransportEnabled();
        updateTimeChip();
        drawWave();
        schedulePersist();
        toast('Permanently deleted ' + deletedName + '. No recordings left.', 'ok');
      }
    }

    function clearRecordHistory() {
      recordHistory = [];
      recordHistoryIndex = -1;
      updateRecordHistoryUI();
    }

    /* =========================================================
       Preset chain (up to 3) → Advanced Lab sliders
       ========================================================= */
    function escapeHtml(str) {
      return String(str || '').replace(/[&<>"']/g, (m) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
      }[m]));
    }

    function getPresetChainItems(chainArr) {
      const sanitized = sanitizePresetChain(chainArr);
      return sanitized.map((id) => {
        const p = getPresetById(id);
        return {
          id,
          name: p ? p.name : id,
          emoji: p ? p.emoji : '',
          fullName: p ? (p.emoji ? p.emoji + ' ' + p.name : p.name) : id
        };
      });
    }

    function getPresetById(id) {
      return BUILTIN_PRESETS.find((p) => p.id === id) || null;
    }

    function scalePresetPartial(partial, mix) {
      const m = clampNum(mix, 0, 1, 1);
      if (m >= 0.999) return partial || {};
      const d = defaultFx();
      const out = {};
      for (const [k, v] of Object.entries(partial || {})) {
        if (!(k in d)) continue;
        if (typeof d[k] === 'boolean') {
          out[k] = m >= 0.5 ? v : d[k];
          continue;
        }
        if (typeof d[k] === 'string') {
          out[k] = m > 0.05 ? v : d[k];
          continue;
        }
        if (k === 'vocoderBands' || k === 'humNotch' || k === 'ambiencePreset') {
          out[k] = m >= 0.25 ? v : d[k];
          continue;
        }
        if (k === 'gateThreshold') {
          out[k] = m <= 0.05 ? -100 : Math.round(d[k] + (v - d[k]) * m);
          continue;
        }
        out[k] = d[k] + (v - d[k]) * m;
      }
      return out;
    }

    /** Blend second partial onto full base (click order: base then next). */
    function blendPartialOnto(base, partial) {
      const d = defaultFx();
      const out = { ...base };
      for (const [k, v] of Object.entries(partial || {})) {
        if (!(k in d)) continue;
        if (typeof d[k] === 'boolean') {
          out[k] = !!(out[k] || v);
          continue;
        }
        if (typeof d[k] === 'string') {
          if (v !== d[k]) out[k] = v;
          continue;
        }
        if (k === 'pitchSemi' || k === 'pitchCents' || k === 'formant' || k === 'bass' || k === 'mid' || k === 'treble') {
          out[k] = (out[k] || 0) + v;
          continue;
        }
        if (k === 'speed' || k === 'gain') {
          out[k] = out[k] * (v === 0 ? 1 : v);
          continue;
        }
        // Wet mixes: screen blend so both contribute without hard overwrite
        if (
          k === 'bpMix' || k === 'distortion' || k === 'noiseMix' || k === 'reverbMix' ||
          k === 'delayMix' || k === 'chorus' || k === 'flanger' || k === 'tremolo' ||
          k === 'vibrato' || k === 'sampleRateCrush' || k === 'bitcrush' || k === 'fadeIn' || k === 'fadeOut' ||
          k === 'harmonyMix' || k === 'vocoderMix' || k === 'deEssAmount' || k === 'ambienceMix' || k === 'ambienceDuck'
        ) {
          out[k] = (out[k] || 0) + v * (1 - Math.min(1, Math.max(0, out[k] || 0)));
          continue;
        }
        if (k === 'lowpass') {
          out[k] = Math.min(out[k], v);
          continue;
        }
        if (k === 'highpass' || k === 'gateThreshold') {
          out[k] = Math.max(out[k], v);
          continue;
        }
        if (k === 'delayFeedback' || k === 'reverbSize' || k === 'reverbDecay' || k === 'delayTime') {
          out[k] = Math.max(out[k], v);
          continue;
        }
        // Rates / freqs / compressor / vocoderBands: last specified wins
        out[k] = v;
      }
      // Soft clamp common ranges
      out.pitchSemi = Math.max(-12, Math.min(12, out.pitchSemi));
      out.pitchCents = Math.max(-100, Math.min(100, out.pitchCents || 0));
      out.formant = Math.max(-12, Math.min(12, out.formant));
      out.speed = Math.max(0.5, Math.min(2, out.speed));
      out.gain = Math.max(0, Math.min(3, out.gain));
      out.bass = Math.max(-12, Math.min(12, out.bass));
      out.mid = Math.max(-12, Math.min(12, out.mid));
      out.treble = Math.max(-12, Math.min(12, out.treble));
      out.gateThreshold = Math.max(-100, Math.min(-20, out.gateThreshold ?? -100));
      for (const mk of ['bpMix', 'distortion', 'noiseMix', 'reverbMix', 'delayMix', 'chorus', 'flanger', 'tremolo', 'vibrato', 'sampleRateCrush', 'bitcrush', 'harmonyMix', 'vocoderMix', 'deEssAmount', 'ambienceMix', 'ambienceDuck']) {
        out[mk] = Math.max(0, Math.min(1, out[mk] || 0));
      }
      out.ambienceTone = Math.max(-6, Math.min(6, out.ambienceTone || 0));
      out.lowpass = Math.max(200, Math.min(18000, out.lowpass));
      out.highpass = Math.max(20, Math.min(4000, out.highpass));
      return out;
    }

    /** Compute S.fx from presetChain (1–3) in click order → Advanced Lab. */
    function recomputeFxFromChain() {
      if (!S.presetChain.length) return;
      let fx = null;
      const kept = [];
      const mixes = [];
      for (let i = 0; i < S.presetChain.length; i++) {
        const id = S.presetChain[i];
        const p = getPresetById(id);
        if (!p) continue;
        kept.push(id);
        const mix = clampNum(S.presetChainMix[i], 0, 1, 1);
        mixes.push(mix);
        const partial = scalePresetPartial(p.fx, mix);
        fx = fx ? blendPartialOnto(fx, partial) : mergeFx(partial);
      }
      S.presetChain = kept.slice(0, MAX_PRESET_CHAIN);
      S.presetChainMix = mixes.slice(0, MAX_PRESET_CHAIN);
      if (!fx || !S.presetChain.length) {
        S.presetChain = [];
        S.presetChainMix = [];
        S.activePresetId = null;
        return;
      }
      S.fx = fx;
      S.activePresetId = S.presetChain[S.presetChain.length - 1];
      S.activeCustomId = null;
    }

    function updateChainBar() {
      if (!els.chainBar || !els.chainLabel) return;
      els.chainLabel.replaceChildren();
      if (!S.presetChain.length) {
        const t = document.createTextNode('Tap up to ');
        const strong = document.createElement('strong');
        strong.textContent = '3';
        els.chainLabel.append(t, strong, document.createTextNode(' presets in order — they combine into Advanced Lab sliders (then tweak freely).'));
        return;
      }
      const steps = document.createElement('span');
      steps.className = 'chain-steps';
      S.presetChain.forEach((id, i) => {
        if (i) {
          const arrow = document.createElement('span');
          arrow.className = 'chain-arrow';
          arrow.textContent = '→';
          steps.appendChild(arrow);
        }
        const p = getPresetById(id);
        const displayName = p ? p.name : id;
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'chain-step step-' + (i + 1);
        btn.dataset.chainIndex = String(i);
        btn.draggable = true;
        btn.setAttribute('aria-label', 'Remove or reorder ' + displayName);
        const ord = document.createElement('span');
        ord.className = 'ord';
        ord.textContent = String(i + 1);
        const label = document.createElement('span');
        label.textContent = p ? ((p.emoji ? p.emoji + ' ' : '') + p.name) : id;
        const mix = document.createElement('input');
        mix.type = 'range';
        mix.className = 'chain-mix';
        mix.min = '0';
        mix.max = '1';
        mix.step = '0.05';
        mix.value = String(clampNum(S.presetChainMix[i], 0, 1, 1));
        mix.setAttribute('aria-label', displayName + ' mix');
        mix.title = 'Slot mix ' + Math.round(clampNum(S.presetChainMix[i], 0, 1, 1) * 100) + '%';
        mix.addEventListener('pointerdown', (e) => e.stopPropagation());
        mix.addEventListener('click', (e) => e.stopPropagation());
        mix.addEventListener('input', (e) => {
          e.stopPropagation();
          S.presetChainMix[i] = clampNum(parseFloat(mix.value), 0, 1, 1);
          mix.title = 'Slot mix ' + Math.round(S.presetChainMix[i] * 100) + '%';
          recomputeFxFromChain();
          rebuildFxPanel();
          schedulePersist();
          invalidatePreview();
          if (S.playing) startPlayback();
        });
        const rm = document.createElement('span');
        rm.className = 'chain-step-remove';
        rm.title = 'Remove preset';
        rm.textContent = '×';
        btn.append(ord, label, mix, rm);
        btn.addEventListener('dragstart', (e) => {
          btn.classList.add('dragging');
          try { e.dataTransfer.setData('text/plain', String(i)); } catch (_) {}
          e.dataTransfer.effectAllowed = 'move';
        });
        btn.addEventListener('dragend', () => btn.classList.remove('dragging'));
        btn.addEventListener('dragover', (e) => {
          e.preventDefault();
          btn.classList.add('drag-over');
        });
        btn.addEventListener('dragleave', () => btn.classList.remove('drag-over'));
        btn.addEventListener('drop', (e) => {
          e.preventDefault();
          btn.classList.remove('drag-over');
          const from = parseInt(e.dataTransfer.getData('text/plain'), 10);
          if (!isNaN(from)) reorderChain(from, i);
        });
        steps.appendChild(btn);
      });
      const hint = document.createElement('span');
      hint.style.marginLeft = '6px';
      hint.textContent = S.presetChain.length < MAX_PRESET_CHAIN
        ? '· drag to reorder, mix per slot (' + S.presetChain.length + '/' + MAX_PRESET_CHAIN + ')'
        : '· full chain (drag to reorder, tap × to remove)';
      els.chainLabel.append(steps, hint);
    }

    function reorderChain(from, to) {
      if (from === to || from < 0 || to < 0 || from >= S.presetChain.length || to >= S.presetChain.length) return;
      pushHistory();
      const [id] = S.presetChain.splice(from, 1);
      const [mix] = S.presetChainMix.splice(from, 1);
      S.presetChain.splice(to, 0, id);
      S.presetChainMix.splice(to, 0, mix);
      recomputeFxFromChain();
      rebuildFxPanel();
      renderPresets();
      updateChainBar();
      updateTransportEnabled();
      schedulePersist();
      invalidatePreview();
      if (S.playing) startPlayback();
    }

    /**
     * Toggle/add built-in preset into chain (click order, max 3).
     * - Click selected slot: remove it and recompute
     * - Click new with room: append
     * - Click new at capacity: drop oldest, append (rolling window of 3)
     */
    function rememberRecentPreset(presetId) {
      if (!S.ui) S.ui = {};
      const list = Array.isArray(S.ui.recentPresetIds) ? S.ui.recentPresetIds.filter((id) => id !== presetId) : [];
      list.unshift(presetId);
      S.ui.recentPresetIds = list.slice(0, 8);
    }

    function togglePresetInChain(presetId) {
      pushHistory();
      const idx = S.presetChain.indexOf(presetId);
      if (idx >= 0) {
        S.presetChain.splice(idx, 1);
        S.presetChainMix.splice(idx, 1);
        if (S.presetChain.length) {
          recomputeFxFromChain();
        } else {
          S.fx = defaultFx();
          S.activePresetId = null;
        }
      } else {
        if (S.presetChain.length >= MAX_PRESET_CHAIN) {
          S.presetChain.shift();
          S.presetChainMix.shift();
        }
        S.presetChain.push(presetId);
        S.presetChainMix.push(1);
        rememberRecentPreset(presetId);
        recomputeFxFromChain();
      }
      S.activeCustomId = null;
      rebuildFxPanel();
      renderPresets();
      updateChainBar();
      updateTransportEnabled();
      schedulePersist();
      invalidatePreview();
      if (S.playing) startPlayback();
      if (S.presetChain.length) {
        const names = S.presetChain.map((id) => (getPresetById(id) || {}).name || id);
        toast(
          names.length > 1 ? 'Chain: ' + names.join(' → ') : 'Preset: ' + names[0]
        );
      } else {
        toast('Chain cleared');
      }
    }

    function removeFromChainByIndex(index) {
      if (index < 0 || index >= S.presetChain.length) return;
      pushHistory();
      const removedId = S.presetChain[index];
      const removedPreset = getPresetById(removedId);
      const name = removedPreset ? (removedPreset.emoji + ' ' + removedPreset.name) : removedId;
      S.presetChain.splice(index, 1);
      S.presetChainMix.splice(index, 1);
      if (S.presetChain.length) {
        recomputeFxFromChain();
      } else {
        S.fx = defaultFx();
        S.activePresetId = null;
      }
      S.activeCustomId = null;
      rebuildFxPanel();
      renderPresets();
      updateChainBar();
      updateTransportEnabled();
      schedulePersist();
      invalidatePreview();
      if (S.playing) startPlayback();
      if (S.presetChain.length) {
        const names = S.presetChain.map((id) => (getPresetById(id) || {}).name || id);
        toast('Removed ' + name + ' (Chain: ' + names.join(' → ') + ')');
      } else {
        toast('Removed ' + name + ' (Chain cleared)');
      }
    }

    function clearPresetChain(fromHistory) {
      if (!S.presetChain.length && !S.activeCustomId && fxEqualsDefault(S.fx)) return;
      if (!fromHistory) pushHistory();
      S.presetChain = [];
      S.presetChainMix = [];
      S.activePresetId = null;
      S.activeCustomId = null;
      S.fx = defaultFx();
      rebuildFxPanel();
      renderPresets();
      updateChainBar();
      updateTransportEnabled();
      schedulePersist();
      invalidatePreview();
      if (S.playing) startPlayback();
      toast('Chain cleared');
    }

    function formatGainX(v) {
      return (Math.round(v * 10) / 10).toFixed(1) + '×';
    }

    function syncGainSlidersUI() {
      if (els.micLevel) {
        els.micLevel.value = String(S.micLevel);
        els.micLevelVal.textContent = formatGainX(S.micLevel);
      }
      if (els.inputGain) {
        els.inputGain.value = String(S.inputGain);
        els.inputGainVal.textContent = formatGainX(S.inputGain);
      }
      // Keep lab Dynamics "Input gain" in sync if mounted
      const labIn = document.getElementById('fx_inputGain');
      const labVal = document.querySelector('[data-val="inputGain"]');
      if (labIn) labIn.value = String(S.inputGain);
      if (labVal) labVal.textContent = formatFxVal('inputGain', S.inputGain, '×');
    }

    /* =========================================================
       Buffer helpers (incl. iPad / quiet-mic normalize)
       ========================================================= */
    const OFFLINE_DSP_KEYS = [
      'pitchSemi', 'pitchCents', 'pitchMode', 'reverse',
      'harmonyPreset', 'harmonyMix', 'vocoderMix', 'vocoderCarrier', 'vocoderBands',
      'gateThreshold', 'gateRelease', 'deEssAmount', 'deEssFreq', 'humNotch',
      'fadeIn', 'fadeOut', 'bitcrush', 'sampleRateCrush', 'speed',
      'ambiencePreset', 'ambienceMix', 'ambienceDuck', 'ambienceTone'
    ];

    function getOfflineDspFingerprint(fx) {
      if (!fx) return '';
      return OFFLINE_DSP_KEYS.map((k) => k + ':' + fx[k]).join('|');
    }

    let lastBakedFingerprint = '';
    let activePlayChain = null;

    function invalidatePreview() {
      S.previewBuf = null;
      clearTimeout(S.previewTimer);
      S.previewTimer = setTimeout(rebuildPreview, 70);
    }

    function rebuildPreview() {
      if (!S.buffer) {
        S.previewBuf = null;
        lastBakedFingerprint = '';
        updateLufsReadout(null);
        return;
      }
      lastBakedFingerprint = getOfflineDspFingerprint(S.fx);
      let b = S.buffer;
      // Pre-cleanup strip
      if ((S.fx.humNotch || 0) > 0) b = applyHumNotch(b, S.fx.humNotch);
      if ((S.fx.gateThreshold || -100) > -95) {
        b = applyNoiseGate(b, { thresholdDb: S.fx.gateThreshold, releaseSec: S.fx.gateRelease });
      }
      if ((S.fx.deEssAmount || 0) > 0.01) {
        b = applyDeEsser(b, { amount: S.fx.deEssAmount, freq: S.fx.deEssFreq || 6500 });
      }

      if (S.fx.reverse) b = reverseBuffer(b);

      const semi = S.fx.pitchSemi || 0;
      const cents = S.fx.pitchCents || 0;
      if (Math.abs(semi) > 1e-4 || Math.abs(cents) > 1e-4) {
        b = pitchShiftKeepLength(b, semi, { mode: S.fx.pitchMode || 'hq', cents });
      }

      if ((S.fx.harmonyMix || 0) > 0.01 && S.fx.harmonyPreset && S.fx.harmonyPreset !== 'none') {
        b = applyHarmonizer(b, S.fx);
      }
      if ((S.fx.vocoderMix || 0) > 0.01) {
        b = applyVocoder(b, S.fx);
      }

      if ((S.fx.fadeIn || 0) > 0.001 || (S.fx.fadeOut || 0) > 0.001 || (S.fx.bitcrush || 0) > 0.001 || (S.fx.sampleRateCrush || 0) > 0.001) {
        b = applyFadesAndCrush(b, S.fx);
      }
      if ((S.fx.ambienceMix || 0) > 0.001 && S.fx.ambiencePreset && S.fx.ambiencePreset !== 'none') {
        b = applyAmbienceSoundscape(b, S.fx);
      }
      S.previewBuf = b;
      updateLufsReadout(b);
      if (S.playing && !S.comparingDry) startPlayback();
    }

    function matchLoudness() {
      if (!S.buffer) return;
      const data = S.buffer.getChannelData(0);
      let sum = 0;
      let peak = 0;
      for (let i = 0; i < data.length; i++) {
        const v = data[i];
        sum += v * v;
        const a = Math.abs(v);
        if (a > peak) peak = a;
      }
      const rms = Math.sqrt(sum / Math.max(1, data.length));
      if (rms < 1e-8) {
        toast('Clip is silent — nothing to match.');
        return;
      }
      const targetRms = 0.12;
      let g = targetRms / rms;
      if (peak * g > LIMITER_PEAK) g = LIMITER_PEAK / peak;
      g = clampNum(g, 0.5, 9, 1);
      pushHistory();
      S.inputGain = g;
      syncGainSlidersUI();
      schedulePersist();
      if (activePlayChain && activePlayChain.updateLiveParams && !S.comparingDry) {
        activePlayChain.updateLiveParams(S.fx, { inputGain: S.inputGain });
      } else if (S.playing) {
        startPlayback();
      }
      toast('Input gain set to ' + formatGainX(g) + ' for matched loudness', 'ok');
    }

    /* =========================================================
       Playback
       ========================================================= */
    function stopPlayback(resetHead = false, keepAudition = false) {
      if (playSource) {
        try { playSource.onended = null; playSource.stop(); } catch (_) {}
        try { playSource.disconnect(); } catch (_) {}
        playSource = null;
      }
      if (playChainCleanup) {
        try { playChainCleanup(); } catch (_) {}
        playChainCleanup = null;
      }
      activePlayChain = null;
      if (S.playing) {
        const ctx = audioCtx;
        if (ctx) {
          let pos = playOffset + Math.max(0, (ctx.currentTime - playStartedAt) * (S._playRate || 1));
          if (S.selectionAudition) {
            pos = Math.min(S.selectionAudition.end, Math.max(S.selectionAudition.start, pos));
          } else {
            pos = Math.min(S.buffer ? S.buffer.duration : 0, pos);
          }
          S.playhead = pos;
        }
      }
      S.playing = false;
      cancelAnimationFrame(animRaf);
      if (resetHead) {
        S.playhead = S.selectionAudition ? S.selectionAudition.start : 0;
      }
      if (!keepAudition) {
        S.selectionAudition = null;
      }
      updatePlayButton();
      updateTimeChip();
      drawWave();
      syncVideo();
      try {
        els.videoPreview.pause();
      } catch (_) {}
      checkIdleAudio();
    }

    function updatePlayButton() {
      els.btnPlay.textContent = S.playing ? '⏸ Pause' : '▶ Play';
      els.btnPlay.setAttribute('aria-label', S.playing ? 'Pause' : 'Play');
      if (els.btnPlaySelection) {
        const isAuditioning = S.playing && !!S.selectionAudition;
        els.btnPlaySelection.textContent = isAuditioning ? '■ Stop Sel' : '▶ Play Sel';
        els.btnPlaySelection.classList.toggle('btn-primary', isAuditioning);
        els.btnPlaySelection.setAttribute('aria-label', isAuditioning ? 'Stop selection audition' : 'Audition selected region');
      }
    }

    function setDry(on, notify = false) {
      if (!S.buffer || S.baking) {
        S.comparingDry = false;
        if (els.btnAB) {
          els.btnAB.classList.remove('active', 'active-ab');
          els.btnAB.setAttribute('aria-pressed', 'false');
          els.btnAB.title = 'Toggle dry / wet comparison (hear original)';
        }
        return;
      }
      S.comparingDry = !!on;
      if (els.btnAB) {
        els.btnAB.classList.toggle('active', S.comparingDry);
        els.btnAB.classList.toggle('active-ab', S.comparingDry);
        els.btnAB.setAttribute('aria-pressed', String(S.comparingDry));
        els.btnAB.title = S.comparingDry
          ? 'Original dry audio active — click to switch back to FX (wet)'
          : 'Toggle dry / wet comparison (hear original)';
      }
      if (S.playing) startPlayback();
      if (notify) {
        toast(S.comparingDry ? 'A/B: Auditioning DRY (original audio)' : 'A/B: Auditioning WET (FX active)', 'ok');
      }
    }

    function startPlayback() {
      if (!S.buffer || S.baking) return;
      markAudioActive();
      const ctx = ensureAudioCtx();
      stopPlayback(false, true);

      const dry = S.comparingDry;
      let buf = dry ? S.buffer : (S.previewBuf || S.buffer);
      if (dry && S.fx.reverse) {
        /* dry is unprocessed working buffer */
      }

      const chain = buildFxChain(ctx, dry ? defaultFx() : S.fx, { inputGain: dry ? 1 : S.inputGain, preBaked: !dry });
      chain.output.connect(masterGain);
      activePlayChain = dry ? null : chain;

      const src = ctx.createBufferSource();
      src.buffer = buf;
      let rate = dry ? 1 : chain.rate;
      src.playbackRate.value = rate;
      S._playRate = rate;

      if (!dry && (S.fx.vibrato || 0) > 0.001) {
        const lfo = ctx.createOscillator();
        lfo.frequency.value = S.fx.vibratoRate || 5;
        const depth = ctx.createGain();
        depth.gain.value = (S.fx.vibrato || 0) * 0.03 * rate;
        lfo.connect(depth);
        depth.connect(src.playbackRate);
        try { lfo.start(0); } catch (_) {}
        playChainCleanup = () => {
          activePlayChain = null;
          try { lfo.stop(); } catch (_) {}
          chain.stopExtras();
          try { chain.output.disconnect(); } catch (_) {}
        };
      } else {
        playChainCleanup = () => {
          activePlayChain = null;
          chain.stopExtras();
          try { chain.output.disconnect(); } catch (_) {}
        };
      }

      src.connect(chain.input);
      let offset = Math.max(0, Math.min(buf.duration - 0.001, S.playhead));

      let auditionDuration = null;
      if (S.selectionAudition) {
        if (offset < S.selectionAudition.start || offset >= S.selectionAudition.end - 0.001) {
          offset = S.selectionAudition.start;
          S.playhead = offset;
        }
        auditionDuration = Math.max(0.001, S.selectionAudition.end - offset);
      }

      playOffset = offset;
      playStartedAt = ctx.currentTime;
      playSource = src;
      S.playing = true;
      updatePlayButton();

      src.onended = () => {
        if (!S.playing) return;
        if (S.selectionAudition) {
          if (S.selectionAudition.loop || S.loop) {
            S.playhead = S.selectionAudition.start;
            startPlayback();
            return;
          } else {
            const end = S.selectionAudition.end;
            stopPlayback(false);
            S.playhead = end;
            updatePlayButton();
            updateTimeChip();
            drawWave();
            syncVideo();
            return;
          }
        }
        if (S.loop) {
          S.playhead = 0;
          startPlayback();
        } else {
          S.playing = false;
          S.playhead = S.buffer ? S.buffer.duration : 0;
          playSource = null;
          if (playChainCleanup) { playChainCleanup(); playChainCleanup = null; }
          activePlayChain = null;
          updatePlayButton();
          updateTimeChip();
          drawWave();
          syncVideo();
          try { els.videoPreview.pause(); } catch (_) {}
          checkIdleAudio();
        }
      };

      try {
        if (auditionDuration != null) {
          src.start(0, offset, auditionDuration);
        } else {
          src.start(0, offset);
        }
      } catch (e) {
        S.playing = false;
        toast('Playback failed — try again.', 'error');
        return;
      }

      if (S.videoMeta && els.videoPreview.src) {
        try {
          els.videoPreview.playbackRate = (S.fx.reverse || dry) ? 1 : rate;
          els.videoPreview.currentTime = offset;
          els.videoPreview.play().catch(() => {});
        } catch (_) {}
      }

      let lastPlayAnimTime = 0;
      const tick = (now) => {
        if (!S.playing) return;
        const minInterval = getMinFrameIntervalMs();
        if (minInterval > 0 && now && lastPlayAnimTime && (now - lastPlayAnimTime < minInterval)) {
          animRaf = requestAnimationFrame(tick);
          return;
        }
        lastPlayAnimTime = now || performance.now();
        const t = playOffset + (ctx.currentTime - playStartedAt) * rate;
        if (S.selectionAudition) {
          if (t >= S.selectionAudition.end) {
            if (S.selectionAudition.loop || S.loop) {
              S.playhead = S.selectionAudition.start;
              startPlayback();
              return;
            } else {
              const end = S.selectionAudition.end;
              stopPlayback(false);
              S.playhead = end;
              updatePlayButton();
              updateTimeChip();
              drawWave();
              syncVideo();
              return;
            }
          }
        }
        S.playhead = S.selectionAudition
          ? Math.min(S.selectionAudition.end, Math.max(S.selectionAudition.start, t))
          : Math.min(buf.duration, Math.max(0, t));
        updateTimeChip();
        drawWave();
        syncVideo(true);
        animRaf = requestAnimationFrame(tick);
      };
      animRaf = requestAnimationFrame(tick);
    }

    function togglePlay() {
      if (!S.buffer || S.baking) return;
      if (S.playing) stopPlayback(false);
      else {
        S.selectionAudition = null;
        if (S.playhead >= (S.buffer.duration - 0.02)) S.playhead = 0;
        startPlayback();
      }
    }

    function skipInterval() {
      return clampNum(S.skipIntervalSec, 1, 10, 5);
    }

    function updateSkipLabels() {
      const sec = skipInterval();
      const labelN = '−' + sec;
      const labelP = '+' + sec;
      if (els.btnSkipN5) {
        els.btnSkipN5.textContent = labelN;
        els.btnSkipN5.setAttribute('aria-label', 'Skip back ' + sec + ' seconds');
      }
      if (els.btnSkipP5) {
        els.btnSkipP5.textContent = labelP;
        els.btnSkipP5.setAttribute('aria-label', 'Skip forward ' + sec + ' seconds');
      }
    }

    function skip(deltaSec) {
      if (!S.buffer || S.baking) return;
      S.selectionAudition = null;
      const wasPlaying = S.playing;
      const target = S.playhead + deltaSec;
      const clamped = Math.max(0, Math.min(S.buffer.duration, target));
      if (clamped !== target && Date.now() - edgeToastAt > 1000) {
        toast(clamped <= 0 ? 'Start of track' : 'End of track');
        edgeToastAt = Date.now();
      }
      S.playhead = clamped;
      if (wasPlaying) startPlayback();
      else {
        updateTimeChip();
        drawWave();
        syncVideo();
      }
    }

    function frameStep(dir) {
      const fps = (S.videoMeta && S.videoMeta.fps) || 30;
      skip(dir * (1 / fps));
    }

    function syncVideo(soft) {
      if (!S.videoMeta || !els.videoPreview.src) return;
      try {
        if (!soft || Math.abs(els.videoPreview.currentTime - S.playhead) > 0.12) {
          els.videoPreview.currentTime = S.playhead;
        }
      } catch (_) {}
    }

    /* =========================================================
       Waveform
       ========================================================= */
    function resizeWave() {
      const canvas = els.wave;
      const rect = canvas.parentElement.getBoundingClientRect();
      const maxDpr = S.ecoActive ? 1.5 : 2;
      const dpr = Math.min(window.devicePixelRatio || 1, maxDpr);
      canvas.width = Math.max(1, Math.floor(rect.width * dpr));
      canvas.height = Math.max(1, Math.floor(rect.height * dpr));
      canvas.style.width = rect.width + 'px';
      canvas.style.height = rect.height + 'px';
      drawWave();
    }

    function viewWindow() {
      const zoom = Math.max(1, S.waveZoom || 1);
      const span = 1 / zoom;
      const maxStart = Math.max(0, 1 - span);
      const start = Math.min(maxStart, Math.max(0, S.waveViewStart || 0));
      return { zoom, span, start, end: start + span };
    }

    function setWaveZoom(next, anchorNorm) {
      const prev = viewWindow();
      const zoom = Math.max(1, Math.min(16, next));
      S.waveZoom = zoom;
      const span = 1 / zoom;
      const anchor = anchorNorm == null ? prev.start + prev.span / 2 : Math.min(1, Math.max(0, anchorNorm));
      S.waveViewStart = Math.min(1 - span, Math.max(0, anchor - span / 2));
      if (els.zoomChip) els.zoomChip.textContent = zoom.toFixed(zoom >= 10 ? 0 : 1) + '×';
      drawWave();
    }

    let spectrogramCanvas = null;
    let spectrogramCtx = null;

    function setVisMode(mode) {
      S.visMode = mode;
      S.ui = S.ui || {};
      S.ui.visMode = mode;
      if (els.visTabWave) els.visTabWave.classList.toggle('active', mode === 'waveform');
      if (els.visTabSpectrum) els.visTabSpectrum.classList.toggle('active', mode === 'spectrum');
      if (els.visTabSpectrogram) els.visTabSpectrogram.classList.toggle('active', mode === 'spectrogram');
      schedulePersist();
      drawWave();
    }

    function addCueMarker(time) {
      if (!S.buffer) return;
      const t = typeof time === 'number' ? time : S.playhead;
      const clamped = Math.max(0, Math.min(S.buffer.duration, t));
      const marker = {
        id: uid(),
        time: Math.round(clamped * 100) / 100,
        label: 'Cue ' + (S.cueMarkers.length + 1)
      };
      S.cueMarkers.push(marker);
      S.cueMarkers.sort((a, b) => a.time - b.time);
      renderCueMarkers();
      drawWave();
      toast('Cue marker #' + (S.cueMarkers.indexOf(marker) + 1) + ' added at ' + fmtTime(marker.time), 'ok');
    }

    function clearCueMarkers() {
      if (!S.cueMarkers.length) return;
      S.cueMarkers = [];
      renderCueMarkers();
      drawWave();
      toast('Cue markers cleared');
    }

    function deleteCueMarker(id) {
      S.cueMarkers = S.cueMarkers.filter((m) => m.id !== id);
      renderCueMarkers();
      drawWave();
    }

    function seekToCueMarker(index) {
      if (!S.buffer || !S.cueMarkers[index]) return;
      S.selectionAudition = null;
      const m = S.cueMarkers[index];
      const wasPlaying = S.playing;
      S.playhead = m.time;
      if (wasPlaying) startPlayback();
      else {
        updateTimeChip();
        drawWave();
        syncVideo();
      }
      toast('Jumped to Cue #' + (index + 1) + ' (' + fmtTime(m.time) + ')');
    }

    function renderCueMarkers() {
      if (!els.cueMarkerList) return;
      els.cueMarkerList.replaceChildren();
      if (!S.cueMarkers.length) {
        const span = document.createElement('span');
        span.className = 'cue-empty-hint';
        span.textContent = 'No cue markers yet (Press “M” during playback to drop markers)';
        els.cueMarkerList.appendChild(span);
        return;
      }
      S.cueMarkers.forEach((m, idx) => {
        const chip = document.createElement('div');
        chip.className = 'cue-chip';
        const num = document.createElement('span');
        num.className = 'cue-chip-num';
        num.textContent = '#' + (idx + 1);
        const time = document.createElement('span');
        time.className = 'cue-chip-time';
        time.textContent = fmtTime(m.time);
        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'cue-chip-del';
        del.textContent = '×';
        del.title = 'Remove cue marker';
        del.addEventListener('click', (e) => {
          e.stopPropagation();
          deleteCueMarker(m.id);
        });
        chip.append(num, time, del);
        chip.addEventListener('click', () => seekToCueMarker(idx));
        els.cueMarkerList.appendChild(chip);
      });
    }

    function drawWave() {
      const canvas = els.wave;
      const ctx = canvas.getContext('2d');
      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = '#0a1018';
      ctx.fillRect(0, 0, w, h);

      if (!S.buffer) return;
      const view = viewWindow();
      const dur = S.buffer.duration || 1;

      if (S.visMode === 'spectrum') {
        // 64-band FFT Spectrum Visualizer
        const activeAnalyser = (S.playing && masterAnalyser) ? masterAnalyser : (S.liveMonitoring || S.recording) ? (recordAnalyser || masterAnalyser) : null;
        const binCount = 64;
        const freqData = new Uint8Array(binCount);
        if (activeAnalyser) {
          activeAnalyser.getByteFrequencyData(freqData);
        } else {
          // Static spectral preview from buffer playhead
          const ch = S.buffer.getChannelData(0);
          const samplePos = Math.floor((S.playhead / dur) * ch.length);
          for (let b = 0; b < binCount; b++) {
            let sum = 0;
            const stride = Math.max(1, Math.floor(64 / (b + 1)));
            for (let s = 0; s < 32; s++) {
              const idx = (samplePos + s * stride) % ch.length;
              sum += Math.abs(ch[idx] || 0);
            }
            freqData[b] = Math.min(255, Math.floor((sum / 32) * 400));
          }
        }

        const barWidth = w / binCount;
        for (let i = 0; i < binCount; i++) {
          const val = freqData[i] / 255;
          const barH = val * h * 0.92;
          const x = i * barWidth;
          const y = h - barH;

          const grad = ctx.createLinearGradient(0, y, 0, h);
          grad.addColorStop(0, '#38bdf8');
          grad.addColorStop(0.5, '#f59e0b');
          grad.addColorStop(1, '#ec4899');
          ctx.fillStyle = grad;
          ctx.fillRect(x + 1, y, Math.max(1, barWidth - 2), barH);
        }
      } else if (S.visMode === 'spectrogram') {
        // Waterfall Spectrogram Visualizer
        if (!spectrogramCanvas || spectrogramCanvas.width !== 300 || spectrogramCanvas.height !== 128) {
          spectrogramCanvas = document.createElement('canvas');
          spectrogramCanvas.width = 300;
          spectrogramCanvas.height = 128;
          spectrogramCtx = spectrogramCanvas.getContext('2d');
          spectrogramCtx.fillStyle = '#06090e';
          spectrogramCtx.fillRect(0, 0, 300, 128);
        }

        const activeAnalyser = (S.playing && masterAnalyser) ? masterAnalyser : (S.liveMonitoring || S.recording) ? (recordAnalyser || masterAnalyser) : null;
        const bins = 128;
        const freqData = new Uint8Array(bins);
        if (activeAnalyser) {
          activeAnalyser.getByteFrequencyData(freqData);
        } else {
          const ch = S.buffer.getChannelData(0);
          const pos = Math.floor((S.playhead / dur) * ch.length);
          for (let b = 0; b < bins; b++) {
            const v = Math.abs(ch[(pos + b * 2) % ch.length] || 0);
            freqData[b] = Math.min(255, Math.floor(v * 300));
          }
        }

        // Shift left by 2px
        spectrogramCtx.drawImage(spectrogramCanvas, -2, 0);

        // Draw new slice on right edge
        for (let y = 0; y < bins; y++) {
          const v = freqData[bins - 1 - y] / 255; // High freq at top
          let r = 0, g = 0, b = 0;
          if (v < 0.25) {
            r = Math.floor(v * 4 * 30);
            g = Math.floor(v * 4 * 100);
            b = Math.floor(v * 4 * 240);
          } else if (v < 0.6) {
            const t = (v - 0.25) / 0.35;
            r = Math.floor(30 + t * 210);
            g = Math.floor(100 + t * 50);
            b = Math.floor(240 * (1 - t));
          } else {
            const t = (v - 0.6) / 0.4;
            r = 240 + Math.floor(t * 15);
            g = Math.floor(150 + t * 105);
            b = Math.floor(t * 220);
          }
          spectrogramCtx.fillStyle = `rgb(${r},${g},${b})`;
          spectrogramCtx.fillRect(298, y, 2, 1);
        }

        ctx.drawImage(spectrogramCanvas, 0, 0, w, h);
      } else {
        // Mode 'waveform'
        const pyr = S.peakPyramid;
        const mid = h / 2;
        ctx.strokeStyle = '#38bdf8';
        ctx.globalAlpha = 0.9;
        ctx.lineWidth = Math.max(1, canvas.width / 900);
        ctx.beginPath();
        if (pyr && pyr.cols) {
          const i0 = Math.floor(view.start * pyr.cols);
          const i1 = Math.max(i0 + 1, Math.ceil(view.end * pyr.cols));
          const span = i1 - i0;
          for (let x = 0; x < w; x++) {
            const pi = Math.min(pyr.cols - 1, i0 + Math.floor((x / w) * span));
            const y1 = mid + pyr.mins[pi] * mid * 0.92;
            const y2 = mid + pyr.maxs[pi] * mid * 0.92;
            ctx.moveTo(x, y1);
            ctx.lineTo(x, y2);
          }
        } else {
          const data = S.buffer.getChannelData(0);
          const n = data.length;
          const start = Math.floor(view.start * n);
          const end = Math.ceil(view.end * n);
          const step = Math.max(1, Math.floor((end - start) / w));
          for (let x = 0; x < w; x++) {
            const s0 = start + x * step;
            let mn = 1, mx = -1;
            for (let i = 0; i < step && s0 + i < n; i++) {
              const v = data[s0 + i] || 0;
              if (v < mn) mn = v;
              if (v > mx) mx = v;
            }
            ctx.moveTo(x, mid + mn * mid * 0.92);
            ctx.lineTo(x, mid + mx * mid * 0.92);
          }
        }
        ctx.stroke();
        ctx.globalAlpha = 1;
      }

      // Draw Cue Markers
      if (S.cueMarkers && S.cueMarkers.length && S.buffer) {
        for (let mIdx = 0; mIdx < S.cueMarkers.length; mIdx++) {
          const marker = S.cueMarkers[mIdx];
          const mNorm = marker.time / dur;
          if (mNorm >= view.start && mNorm <= view.end) {
            const mx = ((mNorm - view.start) / view.span) * w;
            ctx.strokeStyle = '#38bdf8';
            ctx.lineWidth = 1.5;
            ctx.setLineDash([4, 3]);
            ctx.beginPath();
            ctx.moveTo(mx, 0);
            ctx.lineTo(mx, h);
            ctx.stroke();
            ctx.setLineDash([]);
            // Tag
            ctx.fillStyle = '#0284c7';
            ctx.fillRect(mx - 10, 2, 20, 14);
            ctx.fillStyle = '#ffffff';
            ctx.font = 'bold 9px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(String(mIdx + 1), mx, 12);
          }
        }
      }

      // Draw Region Selection & Boundary Handles
      if (S.selection && S.selection.active && S.buffer) {
        const selStart = Math.min(S.selection.start, S.selection.end);
        const selEnd = Math.max(S.selection.start, S.selection.end);
        const inNorm = selStart / dur;
        const outNorm = selEnd / dur;
        const inX = ((inNorm - view.start) / view.span) * w;
        const outX = ((outNorm - view.start) / view.span) * w;
        const leftX = Math.max(0, Math.min(w, Math.min(inX, outX)));
        const rightX = Math.max(0, Math.min(w, Math.max(inX, outX)));

        // Dim unselected audio
        ctx.fillStyle = 'rgba(2, 6, 23, 0.58)';
        if (leftX > 0) ctx.fillRect(0, 0, leftX, h);
        if (rightX < w) ctx.fillRect(rightX, 0, w - rightX, h);

        // Highlight selected region
        ctx.fillStyle = 'rgba(56, 189, 248, 0.16)';
        ctx.fillRect(leftX, 0, Math.max(0, rightX - leftX), h);

        // Top and bottom selection bounding rails
        ctx.strokeStyle = 'rgba(56, 189, 248, 0.5)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(leftX, 1);
        ctx.lineTo(rightX, 1);
        ctx.moveTo(leftX, h - 1);
        ctx.lineTo(rightX, h - 1);
        ctx.stroke();

        // In boundary line and handle
        if (inX >= -10 && inX <= w + 10) {
          ctx.strokeStyle = '#38bdf8';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(inX, 0);
          ctx.lineTo(inX, h);
          ctx.stroke();

          // In tactile handle flag
          ctx.fillStyle = '#0284c7';
          ctx.beginPath();
          if (ctx.roundRect) {
            ctx.roundRect(inX - 18, 0, 18, 22, [0, 0, 4, 4]);
          } else {
            ctx.rect(inX - 18, 0, 18, 22);
          }
          ctx.fill();
          ctx.strokeStyle = '#7dd3fc';
          ctx.lineWidth = 1;
          ctx.stroke();

          ctx.fillStyle = '#ffffff';
          ctx.font = 'bold 11px monospace';
          ctx.textAlign = 'center';
          ctx.fillText('[ In', inX - 9, 15);
        }

        // Out boundary line and handle
        if (outX >= -10 && outX <= w + 10) {
          ctx.strokeStyle = '#ec4899';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(outX, 0);
          ctx.lineTo(outX, h);
          ctx.stroke();

          // Out tactile handle flag
          ctx.fillStyle = '#be185d';
          ctx.beginPath();
          if (ctx.roundRect) {
            ctx.roundRect(outX, 0, 20, 22, [0, 0, 4, 4]);
          } else {
            ctx.rect(outX, 0, 20, 22);
          }
          ctx.fill();
          ctx.strokeStyle = '#f472b6';
          ctx.lineWidth = 1;
          ctx.stroke();

          ctx.fillStyle = '#ffffff';
          ctx.font = 'bold 11px monospace';
          ctx.textAlign = 'center';
          ctx.fillText('Out]', outX + 10, 15);
        }
      }

      // Draw Playhead
      const norm = (S.playhead / dur);
      if (norm >= view.start && norm <= view.end) {
        const px = ((norm - view.start) / view.span) * w;
        ctx.strokeStyle = '#f8fafc';
        ctx.lineWidth = Math.max(2, canvas.width / 400);
        ctx.beginPath();
        ctx.moveTo(px, 0);
        ctx.lineTo(px, h);
        ctx.stroke();
      }
    }

    /* =========================================================
       Trim, Cut & Region Editing Suite
       ========================================================= */
    function timeFromWaveX(clientX) {
      if (!S.buffer || !els.wave) return 0;
      const rect = els.wave.getBoundingClientRect();
      const x = Math.max(0, Math.min(rect.width, clientX - rect.left));
      const view = viewWindow();
      return (view.start + (x / rect.width) * view.span) * S.buffer.duration;
    }

    function xFromWaveTime(timeSec) {
      if (!S.buffer || !els.wave) return 0;
      const rect = els.wave.getBoundingClientRect();
      const view = viewWindow();
      const norm = timeSec / S.buffer.duration;
      return ((norm - view.start) / view.span) * rect.width;
    }

    function setWaveTool(mode) {
      S.waveTool = mode === 'select' ? 'select' : 'seek';
      if (els.btnWaveToolSeek) {
        const isSeek = S.waveTool === 'seek';
        els.btnWaveToolSeek.classList.toggle('active', isSeek);
        els.btnWaveToolSeek.setAttribute('aria-pressed', String(isSeek));
      }
      if (els.btnWaveToolSelect) {
        const isSel = S.waveTool === 'select';
        els.btnWaveToolSelect.classList.toggle('active', isSel);
        els.btnWaveToolSelect.setAttribute('aria-pressed', String(isSel));
      }
      if (els.wave) {
        els.wave.style.cursor = S.waveTool === 'select' ? 'crosshair' : 'pointer';
      }
    }

    function parseTimeInput(str) {
      if (!str) return null;
      const s = String(str).trim();
      if (!s) return null;
      if (s.includes(':')) {
        const parts = s.split(':');
        if (parts.length === 2) {
          const m = parseFloat(parts[0]);
          const sec = parseFloat(parts[1]);
          if (!isNaN(m) && !isNaN(sec)) return m * 60 + sec;
        }
      }
      const num = parseFloat(s);
      return !isNaN(num) && isFinite(num) ? num : null;
    }

    function updateTrimUI() {
      const hasAudio = !!S.buffer && !S.baking;
      const hasSel = !!(hasAudio && S.selection && S.selection.active);
      const dur = S.buffer ? S.buffer.duration : 0;

      if (els.btnWaveToolSeek) els.btnWaveToolSeek.disabled = !hasAudio;
      if (els.btnWaveToolSelect) els.btnWaveToolSelect.disabled = !hasAudio;
      if (els.btnSetIn) els.btnSetIn.disabled = !hasAudio;
      if (els.btnSetOut) els.btnSetOut.disabled = !hasAudio;
      if (els.btnTrimSilence) els.btnTrimSilence.disabled = !hasAudio;

      if (els.btnPlaySelection) els.btnPlaySelection.disabled = !hasSel;
      if (els.btnTrimKeep) els.btnTrimKeep.disabled = !hasSel;
      if (els.btnCutDelete) els.btnCutDelete.disabled = !hasSel;
      if (els.btnClearSelection) els.btnClearSelection.disabled = !hasSel;

      if (els.trimInInput) {
        els.trimInInput.disabled = !hasAudio;
        if (!els.trimInInput.matches(':focus')) {
          els.trimInInput.value = hasSel ? fmtTime(S.selection.start) : '0:00.00';
        }
      }
      if (els.trimOutInput) {
        els.trimOutInput.disabled = !hasAudio;
        if (!els.trimOutInput.matches(':focus')) {
          els.trimOutInput.value = hasSel ? fmtTime(S.selection.end) : fmtTime(dur);
        }
      }
      if (els.trimSpanBadge) {
        if (hasSel) {
          const span = Math.max(0, S.selection.end - S.selection.start);
          els.trimSpanBadge.textContent = span.toFixed(2) + 's';
          els.trimSpanBadge.style.opacity = '1';
        } else {
          els.trimSpanBadge.textContent = '0.00s';
          els.trimSpanBadge.style.opacity = '0.5';
        }
      }
    }

    function setSelection(start, end) {
      if (!S.buffer) return;
      if (S.selectionAudition) {
        stopPlayback(false);
      }
      const dur = S.buffer.duration;
      const s0 = Math.max(0, Math.min(dur, Math.min(start, end)));
      const s1 = Math.max(0, Math.min(dur, Math.max(start, end)));
      if (s1 - s0 < 0.005) {
        clearSelection();
        return;
      }
      S.selection = {
        active: true,
        start: Math.round(s0 * 1000) / 1000,
        end: Math.round(s1 * 1000) / 1000
      };
      updateTrimUI();
      drawWave();
    }

    function clearSelection() {
      S.selection = { active: false, start: 0, end: 0 };
      if (S.selectionAudition) {
        stopPlayback(false);
        S.selectionAudition = null;
      }
      updateTrimUI();
      drawWave();
    }

    function setInPoint() {
      if (!S.buffer) return;
      const inPt = Math.max(0, Math.min(S.buffer.duration, S.playhead));
      const outPt = S.selection.active ? Math.max(inPt + 0.05, S.selection.end) : S.buffer.duration;
      setSelection(inPt, outPt);
      toast('In point set to ' + fmtTime(inPt));
    }

    function setOutPoint() {
      if (!S.buffer) return;
      const outPt = Math.max(0, Math.min(S.buffer.duration, S.playhead));
      const inPt = S.selection.active ? Math.min(outPt - 0.05, S.selection.start) : 0;
      setSelection(inPt, outPt);
      toast('Out point set to ' + fmtTime(outPt));
    }

    function playSelection(loop = false) {
      if (!S.buffer || !S.selection || !S.selection.active) return;
      if (S.playing && S.selectionAudition) {
        stopPlayback(false);
        return;
      }
      const start = Math.min(S.selection.start, S.selection.end);
      const end = Math.max(S.selection.start, S.selection.end);
      if (end - start <= 0.005) return;
      stopPlayback(false);
      S.playhead = start;
      S.selectionAudition = { start, end, loop };
      startPlayback();
    }

    function applyTrimSelection() {
      if (!S.buffer || !S.selection || !S.selection.active || S.baking) return;
      const start = Math.min(S.selection.start, S.selection.end);
      const end = Math.max(S.selection.start, S.selection.end);
      if (end - start < 0.02) {
        toast('Selection is too small to trim.', 'error');
        return;
      }
      stopPlayback(false);
      pushHistory({ includeBuffer: true });

      try {
        const trimmed = trimBuffer(S.buffer, start, end, { crossfadeSec: 0.005, snapZeroCrossing: true });
        const offset = start;
        S.cueMarkers = (S.cueMarkers || [])
          .filter((m) => m.time >= start && m.time <= end)
          .map((m) => ({ ...m, time: Math.round(Math.max(0, m.time - offset) * 100) / 100 }));

        S.buffer = trimmed;
        S.peakPyramid = buildPeakPyramid(trimmed);
        S.playhead = 0;
        clearSelection();
        invalidatePreview();
        updateTimeChip();
        renderCueMarkers();
        updateTransportEnabled();
        drawWave();
        toast('Trimmed clip to selection (' + fmtTime(trimmed.duration) + '). Undo with Ctrl+Z.', 'ok');
      } catch (err) {
        console.error('Trim error:', err);
        if (undoStack.length) releaseSnap(undoStack.pop());
        updateUndoButtons();
        toast('Failed to trim audio: ' + (err.message || 'error'), 'error');
      }
    }

    function applyCutSelection() {
      if (!S.buffer || !S.selection || !S.selection.active || S.baking) return;
      const start = Math.min(S.selection.start, S.selection.end);
      const end = Math.max(S.selection.start, S.selection.end);
      const cutSpan = end - start;
      if (cutSpan < 0.005) {
        toast('Selection is too small to cut.', 'error');
        return;
      }
      stopPlayback(false);
      pushHistory({ includeBuffer: true });

      try {
        const cut = cutBufferRegion(S.buffer, start, end, { crossfadeSec: 0.005, snapZeroCrossing: true });
        S.cueMarkers = (S.cueMarkers || [])
          .filter((m) => m.time < start || m.time > end)
          .map((m) => (m.time > end ? { ...m, time: Math.round(Math.max(0, m.time - cutSpan) * 100) / 100 } : m));

        S.buffer = cut;
        S.peakPyramid = buildPeakPyramid(cut);
        S.playhead = Math.min(cut.duration, start);
        clearSelection();
        invalidatePreview();
        updateTimeChip();
        renderCueMarkers();
        updateTransportEnabled();
        drawWave();
        toast('Cut selected audio. Splice crossfade applied. Undo with Ctrl+Z.', 'ok');
      } catch (err) {
        console.error('Cut error:', err);
        if (undoStack.length) releaseSnap(undoStack.pop());
        updateUndoButtons();
        toast('Failed to cut audio region: ' + (err.message || 'error'), 'error');
      }
    }

    function applyTrimSilence() {
      if (!S.buffer || S.baking) return;
      stopPlayback(false);
      pushHistory({ includeBuffer: true });

      try {
        const res = trimSilence(S.buffer, { thresholdDb: -45, padSec: 0.05 });
        if (res.trimmedStartSec === 0 && res.trimmedEndSec === 0) {
          if (undoStack.length) releaseSnap(undoStack.pop());
          updateUndoButtons();
          toast('No dead air / silence detected below -45 dB at clip boundaries.');
          return;
        }

        const head = res.trimmedStartSec;
        const tail = res.trimmedEndSec;
        const newDur = res.buffer.duration;

        S.cueMarkers = (S.cueMarkers || [])
          .filter((m) => m.time >= head && m.time <= head + newDur)
          .map((m) => ({ ...m, time: Math.round(Math.max(0, m.time - head) * 100) / 100 }));

        S.buffer = res.buffer;
        S.peakPyramid = buildPeakPyramid(res.buffer);
        S.playhead = Math.max(0, Math.min(newDur, S.playhead - head));
        clearSelection();
        invalidatePreview();
        updateTimeChip();
        renderCueMarkers();
        updateTransportEnabled();
        drawWave();
        toast('Trimmed silence (' + head.toFixed(2) + 's head, ' + tail.toFixed(2) + 's tail). Undo with Ctrl+Z.', 'ok');
      } catch (err) {
        console.error('Trim silence error:', err);
        if (undoStack.length) releaseSnap(undoStack.pop());
        updateUndoButtons();
        toast('Failed to trim silence: ' + (err.message || 'error'), 'error');
      }
    }

    function seekFromEvent(e) {
      if (!S.buffer || S.baking) return;
      S.selectionAudition = null;
      const rect = els.wave.getBoundingClientRect();
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const x = Math.max(0, Math.min(rect.width, clientX - rect.left));
      const view = viewWindow();
      const wasPlaying = S.playing;
      S.playhead = (view.start + (x / rect.width) * view.span) * S.buffer.duration;
      if (wasPlaying) startPlayback();
      else {
        updateTimeChip();
        drawWave();
        syncVideo();
      }
    }

    let timeChipB = null;
    let timeChipText = null;
    function updateTimeChip() {
      const cur = S.playhead || 0;
      const dur = S.buffer ? S.buffer.duration : 0;
      if (!timeChipB || !timeChipText || els.timeChip.childElementCount !== 1) {
        els.timeChip.replaceChildren();
        timeChipB = document.createElement('b');
        timeChipText = document.createTextNode('');
        els.timeChip.append(timeChipB, timeChipText);
      }
      timeChipB.textContent = fmtTime(cur);
      timeChipText.data = ' / ' + fmtTime(dur);
    }

    /* =========================================================
       2D Macro XY Morph Pad
       ========================================================= */
    const XY_MODES = {
      'pitch-formant': {
        nameX: 'Pitch (-12 to +12 st)',
        nameY: 'Formant (-12 to +12 st)',
        paramX: 'pitchSemi',
        paramY: 'formant',
        minX: -12, maxX: 12,
        minY: -12, maxY: 12
      },
      'space-grit': {
        nameX: 'Distortion (0 to 0.8)',
        nameY: 'Reverb Mix (0 to 0.8)',
        paramX: 'distortion',
        paramY: 'reverbMix',
        minX: 0, maxX: 0.8,
        minY: 0, maxY: 0.8
      },
      'robot-mod': {
        nameX: 'Ring Mod (0 to 60 Hz)',
        nameY: 'Bitcrush (0 to 0.8)',
        paramX: 'ringFreq',
        paramY: 'bitcrush',
        minX: 0, maxX: 60,
        minY: 0, maxY: 0.8
      },
      'vocal-polish': {
        nameX: 'De-Esser (0 to 0.8)',
        nameY: 'Comp Ratio (1 to 12)',
        paramX: 'deEssAmount',
        paramY: 'compressorRatio',
        minX: 0, maxX: 0.8,
        minY: 1, maxY: 12
      }
    };

    function updateXyLabels() {
      const mode = XY_MODES[S.xyAxisMode] || XY_MODES['pitch-formant'];
      if (els.xyLabelX) els.xyLabelX.textContent = '↔ ' + mode.nameX;
      if (els.xyLabelY) els.xyLabelY.textContent = '↕ ' + mode.nameY;
    }

    function drawXyPad() {
      const canvas = els.xyPadCanvas;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);

      ctx.fillStyle = '#070b10';
      ctx.fillRect(0, 0, w, h);

      ctx.strokeStyle = '#1e293b';
      ctx.lineWidth = 1;
      for (let i = 1; i < 4; i++) {
        const x = (w / 4) * i;
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
        const y = (h / 4) * i;
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
      }

      ctx.strokeStyle = '#334155';
      ctx.beginPath();
      ctx.moveTo(w / 2, 0); ctx.lineTo(w / 2, h);
      ctx.moveTo(0, h / 2); ctx.lineTo(w, h / 2);
      ctx.stroke();

      const mode = XY_MODES[S.xyAxisMode] || XY_MODES['pitch-formant'];
      const valX = S.fx[mode.paramX] != null ? S.fx[mode.paramX] : 0;
      const valY = S.fx[mode.paramY] != null ? S.fx[mode.paramY] : 0;
      const normX = Math.max(0, Math.min(1, (valX - mode.minX) / (mode.maxX - mode.minX)));
      const normY = Math.max(0, Math.min(1, (valY - mode.minY) / (mode.maxY - mode.minY)));

      const px = normX * w;
      const py = (1 - normY) * h;

      const grad = ctx.createRadialGradient(px, py, 2, px, py, 16);
      grad.addColorStop(0, 'rgba(56, 189, 248, 0.9)');
      grad.addColorStop(0.5, 'rgba(56, 189, 248, 0.4)');
      grad.addColorStop(1, 'rgba(56, 189, 248, 0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(px, py, 16, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#38bdf8';
      ctx.beginPath();
      ctx.arc(px, py, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    function handleXyPointer(e) {
      const canvas = els.xyPadCanvas;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const clientY = e.touches ? e.touches[0].clientY : e.clientY;
      const normX = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      const normY = Math.max(0, Math.min(1, 1 - (clientY - rect.top) / rect.height));

      const mode = XY_MODES[S.xyAxisMode] || XY_MODES['pitch-formant'];
      const targetValX = mode.minX + normX * (mode.maxX - mode.minX);
      const targetValY = mode.minY + normY * (mode.maxY - mode.minY);

      S.fx[mode.paramX] = Math.round(targetValX * 100) / 100;
      S.fx[mode.paramY] = Math.round(targetValY * 100) / 100;

      const elX = document.getElementById('fx_' + mode.paramX);
      const valElX = document.querySelector('[data-val="' + mode.paramX + '"]');
      if (elX) elX.value = String(S.fx[mode.paramX]);
      if (valElX) valElX.textContent = formatFxVal(mode.paramX, S.fx[mode.paramX]);

      const elY = document.getElementById('fx_' + mode.paramY);
      const valElY = document.querySelector('[data-val="' + mode.paramY + '"]');
      if (elY) elY.value = String(S.fx[mode.paramY]);
      if (valElY) valElY.textContent = formatFxVal(mode.paramY, S.fx[mode.paramY]);

      drawXyPad();
      onFxEdited(false);
    }

    /* =========================================================
       Live Monitoring & Feedback Guard
       ========================================================= */
    async function startLiveMonitor() {
      if (S.liveMonitoring) return;
      if (S.recording) {
        toast('Cannot monitor while recording.');
        return;
      }
      try {
        ensureAudioCtx();
        await audioCtx.resume();

        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false
          }
        });
        S.liveMonitorStream = stream;

        const srcNode = audioCtx.createMediaStreamSource(stream);
        S.liveMonitorSource = srcNode;

        const monitorAnalyser = audioCtx.createAnalyser();
        monitorAnalyser.fftSize = 256;
        const monitorGain = audioCtx.createGain();
        monitorGain.gain.value = 1;

        const chain = buildFxChain(audioCtx, S.fx, { live: true });
        S.liveMonitorChain = chain;

        srcNode.connect(chain.input);
        chain.output.connect(monitorGain);
        monitorGain.connect(monitorAnalyser);
        monitorAnalyser.connect(masterGain);

        S.liveMonitoring = true;
        if (els.btnLiveMonitor) {
          els.btnLiveMonitor.classList.add('active', 'recording');
          els.btnLiveMonitor.textContent = '🔴 Monitor Active';
          els.btnLiveMonitor.title = 'Live mic monitoring is active (Click to mute)';
        }

        markAudioActive();
        const timeDomain = new Float32Array(monitorAnalyser.fftSize);
        let highPeakCount = 0;
        let lastFeedbackTime = 0;
        const checkFeedback = (now) => {
          if (!S.liveMonitoring) return;
          const minInterval = getMinFrameIntervalMs();
          if (minInterval > 0 && now && lastFeedbackTime && (now - lastFeedbackTime < minInterval)) {
            S.liveMonitorFeedbackRaf = requestAnimationFrame(checkFeedback);
            return;
          }
          lastFeedbackTime = now || performance.now();
          monitorAnalyser.getFloatTimeDomainData(timeDomain);
          let peak = 0;
          for (let i = 0; i < timeDomain.length; i++) {
            const a = Math.abs(timeDomain[i]);
            if (a > peak) peak = a;
          }
          if (peak > 0.96) {
            highPeakCount++;
            if (highPeakCount > 18) {
              stopLiveMonitor();
              toast('Acoustic feedback loop detected! Live monitor was muted to protect your ears.', 'error');
              return;
            }
          } else {
            highPeakCount = Math.max(0, highPeakCount - 1);
          }
          S.liveMonitorFeedbackRaf = requestAnimationFrame(checkFeedback);
        };
        S.liveMonitorFeedbackRaf = requestAnimationFrame(checkFeedback);
        toast('Live monitor active (headphones recommended)', 'ok');
      } catch (err) {
        console.error(err);
        stopLiveMonitor();
        toast('Could not access microphone for live monitoring.', 'error');
      }
    }

    function stopLiveMonitor() {
      if (S.liveMonitorFeedbackRaf) {
        cancelAnimationFrame(S.liveMonitorFeedbackRaf);
        S.liveMonitorFeedbackRaf = 0;
      }
      if (S.liveMonitorSource) {
        try { S.liveMonitorSource.disconnect(); } catch (_) {}
        S.liveMonitorSource = null;
      }
      if (S.liveMonitorChain) {
        try { S.liveMonitorChain.stopExtras(); S.liveMonitorChain.output.disconnect(); } catch (_) {}
        S.liveMonitorChain = null;
      }
      if (S.liveMonitorStream) {
        try {
          S.liveMonitorStream.getTracks().forEach((t) => t.stop());
        } catch (_) {}
        S.liveMonitorStream = null;
      }
      S.liveMonitoring = false;
      if (els.btnLiveMonitor) {
        els.btnLiveMonitor.classList.remove('active', 'recording');
        els.btnLiveMonitor.textContent = '🎧 Live Monitor';
        els.btnLiveMonitor.title = 'Hear your voice with FX in real-time through headphones';
      }
      checkIdleAudio();
    }

    function toggleLiveMonitor() {
      if (S.liveMonitoring) {
        stopLiveMonitor();
        toast('Live monitor disabled');
        return;
      }
      if (!S.skipMonitorWarn) {
        showModal(els.liveMonitorModal);
      } else {
        startLiveMonitor();
      }
    }

    async function autoCalibrateGate() {
      if (S.recording || S.baking) return;
      toast('Sampling background noise floor for 1 second... please stay quiet', 'ok');
      try {
        ensureAudioCtx();
        await audioCtx.resume();
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
        });
        const src = audioCtx.createMediaStreamSource(stream);
        const analyser = audioCtx.createAnalyser();
        analyser.fftSize = 512;
        src.connect(analyser);

        const data = new Float32Array(analyser.fftSize);
        let sumSquared = 0;
        let count = 0;
        const start = Date.now();

        await new Promise((resolve) => {
          const sample = () => {
            analyser.getFloatTimeDomainData(data);
            for (let i = 0; i < data.length; i++) {
              sumSquared += data[i] * data[i];
              count++;
            }
            if (Date.now() - start < 800) {
              requestAnimationFrame(sample);
            } else {
              resolve();
            }
          };
          sample();
        });

        src.disconnect();
        stream.getTracks().forEach((t) => t.stop());

        const rms = Math.sqrt(sumSquared / Math.max(1, count));
        const noiseDb = rms > 1e-6 ? 20 * Math.log10(rms) : -95;
        const targetGate = Math.max(-95, Math.min(-20, Math.round(noiseDb + 5)));

        pushHistory();
        S.fx.gateThreshold = targetGate;
        if (els.gateThreshold) {
          els.gateThreshold.value = String(targetGate);
          els.gateThresholdVal.textContent = targetGate + ' dB';
        }
        const labGate = document.getElementById('fx_gateThreshold');
        const labValGate = document.querySelector('[data-val="gateThreshold"]');
        if (labGate) labGate.value = String(targetGate);
        if (labValGate) labValGate.textContent = targetGate + ' dB';

        schedulePersist();
        invalidatePreview();
        toast('Noise gate calibrated to ' + targetGate + ' dB (Floor: ' + noiseDb.toFixed(1) + ' dB)', 'ok');
      } catch (e) {
        toast('Microphone access needed to calibrate noise gate.', 'error');
      }
    }

    /* =========================================================
       LUFS Metering & Batch Preset Renderer
       ========================================================= */
    function updateLufsReadout(buf) {
      if (!els.lufsMeterReadout) return;
      if (!buf || buf.duration < 0.1) {
        els.lufsMeterReadout.textContent = '— LUFS · Peak: — dBFS';
        return;
      }
      try {
        const stats = computeLUFS(buf);
        const lufsStr = isFinite(stats.lufs) ? stats.lufs.toFixed(1) + ' LUFS' : '— LUFS';
        const peakStr = isFinite(stats.truePeakDb) ? stats.truePeakDb.toFixed(1) + ' dBFS' : '— dBFS';
        els.lufsMeterReadout.textContent = lufsStr + ' · True Peak: ' + peakStr;
      } catch (_) {
        els.lufsMeterReadout.textContent = '— LUFS · Peak: — dBFS';
      }
    }

    function openBatchExportModal() {
      if (!S.buffer || S.baking) {
        toast('Record or upload audio first');
        return;
      }
      if (!els.batchPresetGrid) return;
      els.batchPresetGrid.replaceChildren();
      if (els.batchProgress) els.batchProgress.hidden = true;
      if (els.batchStatusText) els.batchStatusText.textContent = '';
      if (els.batchExportStart) els.batchExportStart.disabled = false;

      BUILTIN_PRESETS.forEach((p) => {
        const item = document.createElement('label');
        item.className = 'batch-preset-item';
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.value = p.id;
        cb.checked = true;
        const name = document.createElement('span');
        name.textContent = p.emoji + ' ' + p.name;
        item.append(cb, name);
        els.batchPresetGrid.appendChild(item);
      });
      showModal(els.batchExportModal);
    }

    function setAllBatchCheckboxes(checked) {
      if (!els.batchPresetGrid) return;
      els.batchPresetGrid.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
        cb.checked = checked;
      });
    }

    async function runBatchExport() {
      if (!S.buffer || S.baking) return;
      const checkedBoxes = Array.from(els.batchPresetGrid.querySelectorAll('input[type="checkbox"]:checked'));
      if (!checkedBoxes.length) {
        toast('Select at least one preset to batch export.');
        return;
      }
      const selectedIds = checkedBoxes.map((cb) => cb.value);
      if (els.batchProgress) els.batchProgress.hidden = false;
      if (els.batchExportStart) els.batchExportStart.disabled = true;

      const total = selectedIds.length;
      let completed = 0;
      S.baking = true;
      updateTransportEnabled();

      for (let i = 0; i < total; i++) {
        const pId = selectedIds[i];
        const preset = getPresetById(pId);
        const name = preset ? preset.name : pId;
        if (els.batchStatusText) {
          els.batchStatusText.textContent = 'Rendering ' + (i + 1) + '/' + total + ': ' + name + '…';
        }
        if (els.batchProgressBar) {
          els.batchProgressBar.style.width = Math.round((i / total) * 100) + '%';
        }

        try {
          const fxObj = mergeFx(preset ? preset.fx : defaultFx());
          let rendered = await renderWithFx(S.buffer, fxObj);
          if (S.lufsTarget && S.lufsTarget !== 'off') {
            rendered = normalizeToLUFS(rendered, Number(S.lufsTarget));
          }
          const blob = bufferToWav(rendered);
          const safeName = (preset ? preset.name : pId).toLowerCase().replace(/[^a-z0-9]+/g, '-');
          const fileName = 'voxclip-' + safeName + '-' + Date.now() + '.wav';
          downloadBlob(blob, fileName);
          completed++;
          await new Promise((r) => setTimeout(r, 200));
        } catch (err) {
          console.error('Batch render error for ' + pId, err);
        }
      }

      if (els.batchProgressBar) els.batchProgressBar.style.width = '100%';
      if (els.batchStatusText) els.batchStatusText.textContent = 'Completed ' + completed + ' exports!';
      setTimeout(() => {
        hideModal(els.batchExportModal);
        S.baking = false;
        updateTransportEnabled();
        toast('Batch export complete (' + completed + ' files rendered)', 'ok');
      }, 700);
    }

    /* =========================================================
       Set buffer / UI state
       ========================================================= */
    function revokeVideo() {
      if (S.videoBlobUrl) {
        try { URL.revokeObjectURL(S.videoBlobUrl); } catch (_) {}
      }
      S.videoBlobUrl = null;
      S.videoMeta = null;
      els.videoPreview.removeAttribute('src');
      els.videoPreview.load();
      els.videoPreview.classList.remove('show');
      els.frameBtns.classList.remove('show');
    }

    function setBuffer(buf, meta = {}) {
      stopPlayback(true);
      setDry(false, false);
      S.buffer = buf;
      S.originalBuffer = buf ? cloneBuffer(buf) : null;
      S.previewBuf = null;
      S.peakPyramid = buf ? buildPeakPyramid(buf) : null;
      S.waveZoom = 1;
      S.waveViewStart = 0;
      S.lastExportBlob = null;
      S.playhead = 0;
      S.selection = { active: false, start: 0, end: 0 };
      S.sourceName = meta.name || S.sourceName || 'Audio';
      clearHistory();
      if (meta.videoFile) {
        revokeVideo();
        S.videoBlobUrl = URL.createObjectURL(meta.videoFile);
        els.videoPreview.src = S.videoBlobUrl;
        els.videoPreview.muted = true;
        els.videoPreview.playsInline = true;
        els.videoPreview.classList.add('show');
        S.videoMeta = {
          name: meta.videoFile.name,
          type: meta.videoFile.type,
          duration: buf.duration,
          width: 0,
          height: 0,
          fps: 30
        };
        els.frameBtns.classList.add('show');
        els.videoPreview.onloadedmetadata = () => {
          S.videoMeta.width = els.videoPreview.videoWidth;
          S.videoMeta.height = els.videoPreview.videoHeight;
          // Heuristic fps — browsers rarely expose true fps
          S.videoMeta.fps = 30;
        };
      } else if (meta.clearVideo) {
        revokeVideo();
      }
      els.waveEmpty.classList.add('hidden');
      els.sourceMeta.textContent = S.sourceName + ' · mono · ' + fmtTime(buf.duration, false) + ' · ' + buf.sampleRate + ' Hz';
      if (els.zoomChip) els.zoomChip.textContent = '1×';
      updateTransportEnabled();
      updateTimeChip();
      resizeWave();
      drawWave();
      invalidatePreview();
      updateWorkflowGuide();
    }

    /** True when working buffer differs from the ingest original (e.g. after Apply FX). */
    function bufferIsBakedFromOriginal() {
      if (!S.buffer || !S.originalBuffer) return false;
      if (S.buffer === S.originalBuffer) return false;
      if (S.buffer.length !== S.originalBuffer.length) return true;
      if (S.buffer.sampleRate !== S.originalBuffer.sampleRate) return true;
      // Sample-level identity check is expensive; length/rate + reference is enough for UI.
      // We always clone original, so reference inequality after bake is expected.
      // Compare a few peaks as cheap dirty check:
      const a = S.buffer.getChannelData(0);
      const b = S.originalBuffer.getChannelData(0);
      if (a.length !== b.length) return true;
      const step = Math.max(1, Math.floor(a.length / 64));
      for (let i = 0; i < a.length; i += step) {
        if (Math.abs(a[i] - b[i]) > 1e-7) return true;
      }
      return false;
    }

    function updateTransportEnabled() {
      const has = !!S.buffer && !S.baking;
      const hasBuf = !!S.buffer;
      [
        els.btnPlay, els.btnStop, els.btnLoop, els.btnSkipN10, els.btnSkipN5, els.btnSkipP5, els.btnSkipP10,
        els.btnMoreSkip, els.btnFramePrev, els.btnFrameNext, els.btnExportPrimary, els.btnExportSecondary,
        els.btnExportWav24, els.btnExportOpus, els.btnBatchExport, els.btnAddMarker,
        els.btnResetAudio, els.btnAB, els.btnMatchLoudness, els.btnZoomIn, els.btnZoomOut, els.btnZoomReset
      ].forEach((b) => {
        if (b) b.disabled = !has;
      });
      if (els.btnClearMarkers) els.btnClearMarkers.disabled = !has || !S.cueMarkers.length;
      els.btnLoop.disabled = !hasBuf || S.baking;
      els.btnApplyFx.disabled = !has || !isFxWet();
      els.btnRecord.disabled = S.baking || S.loading || !S.recordSupport;
      els.btnUpload.disabled = S.baking || S.loading;
      if (!has && S.comparingDry) {
        setDry(false, false);
      }
      if (els.btnShare) {
        const canShare = !!(S.lastExportBlob && navigator.share);
        els.btnShare.hidden = !canShare;
        els.btnShare.disabled = !canShare || S.baking;
      }
      els.bakeOverlay.classList.toggle('show', S.baking);
      if (els.dropzone) els.dropzone.classList.toggle('busy', S.loading);
      updateRecordHistoryUI();
      updateTrimUI();
    }

    /* =========================================================
       Recording — desktop / iPad / Android
       ========================================================= */
    function pickRecorderMime() {
      const candidates = [
        'audio/webm;codecs=opus',
        'audio/webm',
        'audio/mp4',
        'audio/aac',
        'audio/ogg;codecs=opus'
      ];
      if (!window.MediaRecorder) return '';
      for (const m of candidates) {
        if (MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(m)) return m;
      }
      return '';
    }

    function detectRecordSupport() {
      const ok = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder);
      S.recordSupport = ok;
      if (!ok) {
        els.btnRecord.disabled = true;
        els.btnRecord.title = "Recording isn't supported in this browser — try uploading a file instead.";
        toast("Recording isn't supported in this browser — try uploading a file instead.");
      }
    }

    function cancelRecCountdown() {
      if (S.recCountdownTimer) {
        clearTimeout(S.recCountdownTimer);
        S.recCountdownTimer = 0;
      }
      if (els.countdownOverlay) {
        els.countdownOverlay.classList.remove('show');
        els.countdownOverlay.textContent = '';
      }
    }

    function beginRecordCountdown() {
      if (S.recording || S.baking || S.loading || !S.recordSupport) return;
      cancelRecCountdown();
      let n = 3;
      const tick = () => {
        if (n <= 0) {
          cancelRecCountdown();
          startRecording();
          return;
        }
        if (els.countdownOverlay) {
          els.countdownOverlay.textContent = String(n);
          els.countdownOverlay.classList.add('show');
        }
        n -= 1;
        S.recCountdownTimer = setTimeout(tick, 700);
      };
      tick();
    }

    async function startRecording() {
      if (S.recording || S.baking || S.loading || !S.recordSupport) return;
      markAudioActive();
      try {
        ensureAudioCtx();
        // Important for iOS/iPad: resume AudioContext inside user gesture
        await audioCtx.resume();

        mediaStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: true,
            // Prefer mono if allowed (not all browsers honor channelCount)
            channelCount: { ideal: 1 }
          },
          video: false
        });
        if (audioCtx && audioCtx.state === 'suspended') {
          await audioCtx.resume();
        }
      } catch (err) {
        const name = err && err.name;
        if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
          toast('Microphone access is blocked. Enable it in your browser settings to record.', 'error');
        } else if (name === 'NotFoundError') {
          toast('No microphone found.', 'error');
        } else {
          toast('Could not open microphone.', 'error');
        }
        return;
      }

      recordChunks = [];
      recordUsedLiveGain = false;
      recordGainNode = null;
      recordDest = null;

      // Route mic → Gain (mic level) → Analyser + MediaStreamDestination → MediaRecorder
      // so iPad quiet mics are boosted *into* the file, not only after the fact.
      const srcNode = audioCtx.createMediaStreamSource(mediaStream);
      recordGainNode = audioCtx.createGain();
      recordGainNode.gain.value = Math.max(1, S.micLevel || 1);
      recordAnalyser = audioCtx.createAnalyser();
      recordAnalyser.fftSize = 2048;
      recordAnalyser.smoothingTimeConstant = 0.35;
      srcNode.connect(recordGainNode);
      recordGainNode.connect(recordAnalyser);

      // ScriptProcessorNode forces the audio engine to pull and process mic
      // samples on every platform — iPad Safari, Android Chrome, iOS Safari.
      // Safari's AnalyserNode doesn't get driven from MediaStreamSource alone;
      // the ScriptProcessor callback gives us reliable peak data everywhere.
      try {
        recordScriptNode = audioCtx.createScriptProcessor(2048, 1, 1);
        recordScriptNode.onaudioprocess = function(e) {
          const input = e.inputBuffer.getChannelData(0);
          let pk = 0;
          for (let i = 0; i < input.length; i++) {
            const a = Math.abs(input[i]);
            if (a > pk) pk = a;
          }
          recordPeakFromScript = pk;
          // Output buffer defaults to zeros — no speaker feedback
        };
        recordGainNode.connect(recordScriptNode);
        recordScriptNode.connect(audioCtx.destination);
      } catch (_) {}

      let recordStream = mediaStream;
      try {
        recordDest = audioCtx.createMediaStreamDestination();
        recordGainNode.connect(recordDest);
        recordStream = recordDest.stream;
        recordUsedLiveGain = true;
      } catch (_) {
        // Fallback: record raw mic; mic level applied post-stop
        recordStream = mediaStream;
        recordUsedLiveGain = false;
      }

      const mime = pickRecorderMime();
      try {
        mediaRecorder = mime
          ? new MediaRecorder(recordStream, { mimeType: mime, audioBitsPerSecond: 192000 })
          : new MediaRecorder(recordStream);
      } catch (_) {
        try {
          mediaRecorder = new MediaRecorder(recordStream);
        } catch (e2) {
          // Last resort: raw stream without live gain
          recordUsedLiveGain = false;
          mediaRecorder = mime
            ? new MediaRecorder(mediaStream, { mimeType: mime })
            : new MediaRecorder(mediaStream);
        }
      }

      mediaRecorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) recordChunks.push(e.data);
      };
      mediaRecorder.onerror = () => toast('Recording error.', 'error');
      mediaRecorder.onstop = onRecordStop;

      S.recording = true;
      recordStartTs = performance.now();
      els.btnRecord.classList.add('recording');
      els.btnRecord.textContent = '■ Stop';
      els.btnRecord.setAttribute('aria-label', 'Stop recording');
      els.meterWrap.classList.add('show');
      els.meterWrap.setAttribute('aria-hidden', 'false');

      try {
        mediaRecorder.start(250);
      } catch (_) {
        mediaRecorder.start();
      }
      const maxSec = (S.ui && S.ui.maxRecordSec) || 180;
      S.recCountdownTimer = setTimeout(() => {
        if (S.recording) {
          toast('Max recording length reached (' + maxSec + 's).');
          stopRecording();
        }
      }, maxSec * 1000);
      meterTick();
    }

    let lastMeterTime = 0;
    function meterTick(now) {
      if (!S.recording) return;
      const minInterval = getMinFrameIntervalMs();
      if (minInterval > 0 && now && lastMeterTime && (now - lastMeterTime < minInterval)) {
        recordMeterRaf = requestAnimationFrame(meterTick);
        return;
      }
      lastMeterTime = now || performance.now();
      // Keep live mic gain in sync if user moves slider mid-record
      if (recordGainNode) {
        recordGainNode.gain.value = Math.max(1, S.micLevel || 1);
      }
      if (audioCtx && audioCtx.state === 'suspended') {
        audioCtx.resume().catch(() => {});
      }

      // Prefer ScriptProcessorNode peak (works on all platforms inc. iPad Safari);
      // fall back to AnalyserNode on platforms where ScriptProcessor wasn't created
      let peak = recordPeakFromScript;
      if (peak < 0.0001 && recordAnalyser) {
        const data = new Uint8Array(recordAnalyser.fftSize);
        recordAnalyser.getByteTimeDomainData(data);
        for (let i = 0; i < data.length; i++) {
          const v = Math.abs(data[i] - 128) / 128;
          if (v > peak) peak = v;
        }
      }

      // Meter already after gain node when live boost is active
      const visualBoost = recordUsedLiveGain ? 1 : Math.min(4, S.micLevel || 1);
      const effectivePeak = Math.min(1, peak * visualBoost);

      // Smooth decay for natural VU meter physics
      if (effectivePeak > meterSmoothPeak) {
        meterSmoothPeak = effectivePeak;
      } else {
        meterSmoothPeak = Math.max(0, meterSmoothPeak * 0.88 - 0.002);
      }

      // Non-linear power scale (0.4 exponent) so quiet-to-normal speech (0.005 to 0.1 peak)
      // produces clear, responsive bar movement (12% to 40%+) instead of flat 1%
      let pct = 0;
      if (meterSmoothPeak > 0.001) {
        pct = Math.min(100, Math.round(Math.pow(meterSmoothPeak, 0.4) * 100));
      }

      els.meterBar.style.width = pct + '%';
      const elapsed = (performance.now() - recordStartTs) / 1000;
      els.recTimer.textContent = fmtTime(elapsed, false);
      recordMeterRaf = requestAnimationFrame(meterTick);
    }

    function stopRecording() {
      cancelRecCountdown();
      if (!S.recording || !mediaRecorder) return;
      try {
        if (mediaRecorder.state !== 'inactive') mediaRecorder.stop();
      } catch (_) {
        onRecordStop();
      }
    }

    async function onRecordStop() {
      cancelAnimationFrame(recordMeterRaf);
      S.recording = false;
      els.btnRecord.classList.remove('recording');
      els.btnRecord.textContent = '● Record';
      els.btnRecord.setAttribute('aria-label', 'Record from microphone');
      els.meterWrap.classList.remove('show');
      els.meterWrap.setAttribute('aria-hidden', 'true');
      els.meterBar.style.width = '0%';

      if (mediaStream) {
        mediaStream.getTracks().forEach((t) => t.stop());
        mediaStream = null;
      }
      try { if (recordGainNode) recordGainNode.disconnect(); } catch (_) {}
      try { if (recordScriptNode) { recordScriptNode.onaudioprocess = null; recordScriptNode.disconnect(); } } catch (_) {}
      try { if (recordDest) recordDest.disconnect(); } catch (_) {}
      recordAnalyser = null;
      recordGainNode = null;
      recordScriptNode = null;
      recordPeakFromScript = 0;
      recordDest = null;
      meterSmoothPeak = 0;

      const mime = (mediaRecorder && mediaRecorder.mimeType) || 'audio/webm';
      mediaRecorder = null;
      const blob = new Blob(recordChunks, { type: mime });
      recordChunks = [];
      const usedLive = recordUsedLiveGain;
      recordUsedLiveGain = false;

      if (!blob.size) {
        toast('Recording too short — try again.', 'error');
        return;
      }

      try {
        ensureAudioCtx();
        const ab = await blob.arrayBuffer();
        const decoded = await safeDecodeAudioData(audioCtx, ab);
        let mono = toMonoBuffer(decoded);
        // Auto peak-normalize (up to 32×). If live Web Audio gain was not used,
        // also bake Mic level here so quiet iPad captures still land loud enough.
        const extra = usedLive ? 1 : Math.max(1, S.micLevel || 1);
        mono = normalizeRecordingBuffer(mono, { extraGain: extra, maxGain: MAX_NORM_GAIN });
        // Safety second pass: if still quiet after caps, force target with remaining headroom
        const peakAfter = peakOf(mono);
        if (peakAfter > 1e-8 && peakAfter < 0.35) {
          const boost = Math.min(TARGET_PEAK / peakAfter, 12);
          mono = applyBufferGain(mono, boost);
        }
        if (mono.duration < 0.05) {
          toast('Recording too short — try again.', 'error');
          return;
        }

        const isAppend = S.recMode === 'append' && !!S.buffer && S.buffer.length > 0;
        if (isAppend) {
          const combined = concatBuffersWithCrossfade(S.buffer, mono);
          pushRecordTake(combined, { name: 'Take ' + (takeCounter + 1) + ' (Appended)' });
          const curTake = recordHistory[recordHistoryIndex];
          const takeLabel = curTake ? curTake.name : ('Take ' + takeCounter);
          setBuffer(combined, { name: 'Recording (' + takeLabel + ')', clearVideo: true, fromRecHistory: true });
          toast('Appended with crossfade (' + takeLabel + ')', 'ok');
        } else {
          pushRecordTake(mono);
          const curTake = recordHistory[recordHistoryIndex];
          const takeLabel = curTake ? curTake.name : ('Take ' + takeCounter);
          setBuffer(mono, { name: 'Recording (' + takeLabel + ')', clearVideo: true, fromRecHistory: true });
          toast('Recording ready (' + takeLabel + ')', 'ok');
        }
      } catch (e) {
        console.error(e);
        toast("Couldn't process recording. Try again.", 'error');
      } finally {
        checkIdleAudio();
      }
    }

    function toggleRecord() {
      if (S.recCountdownTimer && !S.recording) {
        cancelRecCountdown();
        toast('Countdown cancelled');
        return;
      }
      if (S.recording) stopRecording();
      else beginRecordCountdown();
    }

    /* =========================================================
       Upload / decode
       ========================================================= */
    function safeDecodeAudioData(ctx, ab) {
      return new Promise((resolve, reject) => {
        let done = false;
        const onSuccess = (buf) => {
          if (!done) { done = true; resolve(buf); }
        };
        const onError = (err) => {
          if (!done) { done = true; reject(err); }
        };
        try {
          const res = ctx.decodeAudioData(ab.slice(0), onSuccess, onError);
          if (res && typeof res.then === 'function') {
            res.then(onSuccess).catch(onError);
          }
        } catch (e) {
          onError(e);
        }
      });
    }

    function isVideoFile(file) {
      const t = (file.type || '').toLowerCase();
      const n = (file.name || '').toLowerCase();
      if (t.startsWith('audio/')) return false;
      if (t.startsWith('video/')) return true;
      return /\.(mp4|mov|m4v)$/i.test(n);
    }

    function setDropzoneIdle() {
      els.dropzone.replaceChildren();
      const strong = document.createElement('strong');
      strong.textContent = 'Drop audio, video or .voxproject';
      const small = document.createElement('small');
      small.textContent = 'WAV · MP3 · AAC · M4A · MP4 · MOV · WebM · .voxproject';
      els.dropzone.append(strong, small);
    }

    function setDropzoneDecoding() {
      els.dropzone.replaceChildren();
      const strong = document.createElement('strong');
      const spin = document.createElement('span');
      spin.className = 'spinner';
      strong.append(spin, document.createTextNode('Decoding…'));
      els.dropzone.appendChild(strong);
    }

    async function loadFile(file) {
      if (!file || S.loading || S.baking) return;

      const fileNameLower = (file.name || '').toLowerCase();
      // Check if file is a .voxproject or project JSON
      if (fileNameLower.endsWith('.voxproject') || (file.type === 'application/json' || fileNameLower.endsWith('.json'))) {
        try {
          const text = await file.text();
          const parsed = JSON.parse(text);
          if (parsed && (parsed.kind === 'voxclip.studio.project.v1' || parsed.kind === 'voxclip.project' || (parsed.settings && parsed.audio) || (parsed.metadata && parsed.settings))) {
            if (S.buffer || (recordHistory && recordHistory.length > 0)) {
              const ok = await studioConfirm('Restore project “' + (parsed.name || (parsed.metadata && parsed.metadata.name) || 'Project') + '”? Current audio and settings will be replaced.', { title: 'Restore Project', confirmText: 'Restore' });
              if (!ok) {
                toast('Project restore cancelled');
                return;
              }
            }
            await restoreProjectFromData(parsed);
            return;
          }
        } catch (e) {
          if (fileNameLower.endsWith('.voxproject')) {
            toast('Invalid or corrupted .voxproject file.', 'error');
            return;
          }
        }
      }

      if (file.size > LARGE_FILE_BYTES) {
        toast('Large file — this may take a moment to decode.');
      }
      S.loading = true;
      updateTransportEnabled();
      els.dropzone.classList.add('busy');
      setDropzoneDecoding();

      try {
        ensureAudioCtx();
        await audioCtx.resume();
        const ab = await file.arrayBuffer();
        let decoded;
        try {
          decoded = await safeDecodeAudioData(audioCtx, ab);
        } catch (err) {
          if (isVideoFile(file)) toast('This video codec is unsupported.', 'error');
          else toast("Couldn't read this file. Try a different format.", 'error');
          return;
        }
        if (!decoded || !decoded.length) {
          if (isVideoFile(file)) toast('This video has no audio track.', 'error');
          else toast("Couldn't read this file. Try a different format.", 'error');
          return;
        }
        let mono = toMonoBuffer(decoded);
        mono = normalizeRecordingBuffer(mono);
        // Replace confirm after successful decode (PRD §19.5)
        if (S.buffer) {
          const ok = await studioConfirm('Replace current audio with this file? Your current clip will be discarded.', { title: 'Replace Audio', confirmText: 'Replace', danger: true });
          if (!ok) {
            toast('Upload cancelled');
            return;
          }
        }
        const video = isVideoFile(file);
        setBuffer(mono, {
          name: file.name,
          videoFile: video ? file : null,
          clearVideo: !video
        });
        toast('Loaded ' + file.name, 'ok');
      } catch (e) {
        console.error(e);
        toast("Couldn't read this file. Try a different format.", 'error');
      } finally {
        S.loading = false;
        els.dropzone.classList.remove('busy');
        setDropzoneIdle();
        updateTransportEnabled();
      }
    }

    /* =========================================================
       Bake / export
       ========================================================= */
    async function renderWithFx(sourceBuf, fx) {
      ensureAudioCtx();
      let buf = sourceBuf;
      // Pre-cleanup strip
      if ((fx.humNotch || 0) > 0) buf = applyHumNotch(buf, fx.humNotch);
      if ((fx.gateThreshold || -100) > -95) {
        buf = applyNoiseGate(buf, { thresholdDb: fx.gateThreshold, releaseSec: fx.gateRelease });
      }
      if ((fx.deEssAmount || 0) > 0.01) {
        buf = applyDeEsser(buf, { amount: fx.deEssAmount, freq: fx.deEssFreq || 6500 });
      }

      if (fx.reverse) buf = reverseBuffer(buf);

      const semi = fx.pitchSemi || 0;
      const cents = fx.pitchCents || 0;
      if (Math.abs(semi) > 1e-4 || Math.abs(cents) > 1e-4) {
        buf = pitchShiftKeepLength(buf, semi, { mode: fx.pitchMode || 'hq', cents });
      }

      if ((fx.harmonyMix || 0) > 0.01 && fx.harmonyPreset && fx.harmonyPreset !== 'none') {
        buf = applyHarmonizer(buf, fx);
      }
      if ((fx.vocoderMix || 0) > 0.01) {
        buf = applyVocoder(buf, fx);
      }

      if ((fx.fadeIn || 0) > 0.001 || (fx.fadeOut || 0) > 0.001 || (fx.bitcrush || 0) > 0.001 || (fx.sampleRateCrush || 0) > 0.001) {
        buf = applyFadesAndCrush(buf, fx);
      }

      const rate = Math.max(0.25, Math.min(4, fx.speed || 1));
      const tail = (fx.reverbMix > 0 ? (fx.reverbDecay || 0) : 0) + (fx.delayMix > 0 ? (fx.delayTime || 0) : 0) + 0.5;
      const outDuration = buf.duration / rate + tail;
      const frames = Math.max(1, Math.ceil(outDuration * buf.sampleRate));
      const offline = new OfflineAudioContext(1, frames, buf.sampleRate);

      const chain = buildFxChain(offline, fx, { offline: true, preBaked: true });
      chain.output.connect(offline.destination);

      const src = offline.createBufferSource();
      src.buffer = buf;
      src.playbackRate.value = rate;
      if ((fx.vibrato || 0) > 0.001) {
        const lfo = offline.createOscillator();
        lfo.frequency.value = fx.vibratoRate || 5;
        const depth = offline.createGain();
        depth.gain.value = fx.vibrato * 0.03 * rate;
        lfo.connect(depth);
        depth.connect(src.playbackRate);
        lfo.start(0);
      }
      src.connect(chain.input);
      src.start(0);

      let rendered = await offline.startRendering();
      rendered = toMonoBuffer(rendered);
      rendered = applyPeakLimiter(rendered, LIMITER_PEAK);
      if ((fx.ambienceMix || 0) > 0.001 && fx.ambiencePreset && fx.ambiencePreset !== 'none') {
        rendered = applyAmbienceSoundscape(rendered, fx);
      }
      return rendered;
    }

    async function applyFxBake() {
      if (!S.buffer || S.baking || !isFxWet()) return;
      setDry(false, false);
      S.baking = true;
      updateTransportEnabled();
      stopPlayback(false);
      try {
        // Snapshot dry (or current) audio + FX *before* replacing the buffer
        pushHistory({ includeBuffer: true });
        const wet = await renderWithFx(S.buffer, S.fx);
        S.buffer = wet;
        S.peakPyramid = buildPeakPyramid(wet);
        S.previewBuf = null;
        S.playhead = 0;
        S.fx = defaultFx();
        S.presetChain = [];
        S.presetChainMix = [];
        S.activePresetId = null;
        S.activeCustomId = null;
        rebuildFxPanel();
        renderPresets();
        updateChainBar();
        schedulePersist();
        drawWave();
        updateTimeChip();
        updateUndoButtons();
        toast('FX applied to clip. Undo restores previous audio.', 'ok');
      } catch (e) {
        console.error(e);
        if (undoStack.length) releaseSnap(undoStack.pop());
        updateUndoButtons();
        toast('FX render failed.', 'error');
      } finally {
        S.baking = false;
        updateTransportEnabled();
      }
    }

    function downloadBlob(blob, filename) {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    }

    async function loadLame() {
      if (window.lamejs) return window.lamejs;
      if (lameLoading) return lameLoading;
      lameLoading = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = 'vendor/lame.min.js';
        s.async = true;
        s.onload = () => resolve(window.lamejs);
        s.onerror = () => reject(new Error('lame load failed'));
        document.head.appendChild(s);
      });
      return lameLoading;
    }

    function rememberExport(blob, name) {
      S.lastExportBlob = blob;
      S.lastExportName = name;
      updateTransportEnabled();
    }

    async function shareLastExport() {
      if (!S.lastExportBlob || !navigator.share) {
        toast('Share is not available.');
        return;
      }
      try {
        const file = new File([S.lastExportBlob], S.lastExportName || 'voxclip.wav', { type: S.lastExportBlob.type || 'audio/wav' });
        const payload = { files: [file], title: S.lastExportName || 'VoxClip export' };
        if (navigator.canShare && !navigator.canShare(payload)) {
          await navigator.share({ title: payload.title });
          return;
        }
        await navigator.share(payload);
      } catch (e) {
        if (e && e.name === 'AbortError') return;
        toast('Share failed — file was still downloaded.', 'error');
      }
    }

    function updateExportButtons() {
      const pref = S.lastExportFormat === 'mp3' ? 'mp3' : 'wav';
      const primary = pref === 'mp3' ? 'mp3' : 'wav';
      const secondary = primary === 'wav' ? 'mp3' : 'wav';
      if (els.btnExportPrimary) {
        els.btnExportPrimary.dataset.format = primary;
        els.btnExportPrimary.textContent = primary === 'wav' ? 'Export WAV' : 'Export MP3';
        els.btnExportPrimary.setAttribute('aria-label', primary === 'wav' ? 'Export WAV' : 'Export MP3');
      }
      if (els.btnExportSecondary) {
        els.btnExportSecondary.dataset.format = secondary;
        els.btnExportSecondary.textContent = secondary === 'wav' ? 'Export WAV' : 'Export MP3';
        els.btnExportSecondary.setAttribute('aria-label', secondary === 'wav' ? 'Export WAV' : 'Export MP3');
      }
    }

    async function exportAudio(format) {
      if (!S.buffer || S.baking) {
        toast('Record or upload audio first');
        return;
      }
      S.baking = true;
      updateTransportEnabled();
      stopPlayback(false);
      try {
        let buf = S.buffer;
        if (isFxWet()) {
          buf = await renderWithFx(S.buffer, S.fx);
        }
        if (S.lufsTarget && S.lufsTarget !== 'off') {
          buf = normalizeToLUFS(buf, Number(S.lufsTarget));
          updateLufsReadout(buf);
        }
        const ts = Date.now();
        if (format === 'wav24') {
          const blob = bufferToWav24(buf);
          const name = 'voxclip-studio24-' + ts + '.wav';
          downloadBlob(blob, name);
          rememberExport(blob, name);
          toast('Exported 24-bit Studio WAV: ' + name, 'ok');
        } else if (format === 'opus') {
          let blob = null;
          let ext = 'opus';
          if (typeof bufferToOpus === 'function') {
            try {
              const res = await bufferToOpus(buf);
              if (res && res.blob) {
                blob = res.blob;
                ext = res.extension || 'opus';
              }
            } catch (err) {
              console.warn('Opus encoding fallback:', err);
            }
          }
          if (!blob) blob = bufferToWav(buf);
          const name = 'voxclip-' + ts + '.' + ext;
          downloadBlob(blob, name);
          rememberExport(blob, name);
          toast('Exported ' + name, 'ok');
        } else if (format === 'wav') {
          const blob = bufferToWav(buf);
          const name = 'voxclip-' + ts + '.wav';
          downloadBlob(blob, name);
          rememberExport(blob, name);
          toast('Exported ' + name, 'ok');
          S.lastExportFormat = 'wav';
        } else {
          try {
            const lamejs = await loadLame();
            const mp3enc = new lamejs.Mp3Encoder(1, buf.sampleRate, 192);
            const samples = buf.getChannelData(0);
            const block = 1152;
            const int16 = new Int16Array(samples.length);
            for (let i = 0; i < samples.length; i++) {
              const s = Math.max(-1, Math.min(1, samples[i]));
              int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
            }
            const parts = [];
            for (let i = 0; i < int16.length; i += block) {
              const chunk = int16.subarray(i, i + block);
              const mp3buf = mp3enc.encodeBuffer(chunk);
              if (mp3buf.length) parts.push(mp3buf);
            }
            const end = mp3enc.flush();
            if (end.length) parts.push(end);
            const blob = new Blob(parts, { type: 'audio/mpeg' });
            const name = 'voxclip-' + ts + '.mp3';
            downloadBlob(blob, name);
            rememberExport(blob, name);
            toast('Exported ' + name, 'ok');
            S.lastExportFormat = 'mp3';
          } catch (e) {
            console.error(e);
            toast("MP3 export isn't available right now — try WAV instead.", 'error');
          }
        }
        updateExportButtons();
        schedulePersist();
      } catch (e) {
        console.error(e);
        toast('Export failed.', 'error');
      } finally {
        S.baking = false;
        updateTransportEnabled();
      }
    }

    /* =========================================================
       Workspace & Guidance Engine (iPad & Desktop Split Deck)
       ========================================================= */
    let currentPulseEl = null;
    function highlightNextAction(targetEl) {
      if (currentPulseEl && currentPulseEl !== targetEl) {
        currentPulseEl.classList.remove('next-action-pulse');
      }
      if (targetEl) {
        targetEl.classList.add('next-action-pulse');
        currentPulseEl = targetEl;
      } else {
        currentPulseEl = null;
      }
    }

    function setWorkspaceTab(tabName, persist = true) {
      const valid = ['presets', 'xy', 'lab', 'export', 'all'];
      const target = valid.includes(tabName) ? tabName : 'presets';
      S.ui = S.ui || {};
      S.ui.workspaceTab = target;

      // Update Tab Button active states
      const tabBtns = [
        ['presets', els.tabDeckPresets],
        ['xy', els.tabDeckXy],
        ['lab', els.tabDeckLab],
        ['export', els.tabDeckExport],
        ['all', els.tabDeckAll]
      ];
      tabBtns.forEach(([name, btn]) => {
        if (!btn) return;
        const isActive = (name === target);
        btn.classList.toggle('active', isActive);
        btn.setAttribute('aria-selected', String(isActive));
      });

      // Update Panel visibility
      const panels = [
        ['presets', els.panelPresets],
        ['xy', els.panelXyCleanup],
        ['lab', els.panelLab],
        ['export', els.panelExport]
      ];

      panels.forEach(([name, panel]) => {
        if (!panel) return;
        if (target === 'all') {
          panel.classList.remove('active');
          panel.classList.add('all-view');
        } else {
          panel.classList.remove('all-view');
          panel.classList.toggle('active', name === target);
        }
      });

      if (target === 'xy') {
        setTimeout(() => drawXyPad(), 20);
      }
      if (target === 'lab' && els.labDetails) {
        els.labDetails.open = true;
      }
      if (persist) schedulePersist();
      updateWorkflowGuide();
    }

    function setPresetCatFilter(cat, persist = true) {
      S.ui = S.ui || {};
      S.ui.presetCatFilter = cat || 'all';
      if (els.catFilterBar) {
        els.catFilterBar.querySelectorAll('.cat-filter-btn').forEach((btn) => {
          btn.classList.toggle('active', btn.dataset.cat === S.ui.presetCatFilter);
        });
      }
      renderPresets();
      if (persist) schedulePersist();
    }

    function updateWorkflowGuide() {
      const hasAudio = Boolean(S.buffer || S.originalBuffer);
      const isExportTab = (S.ui && S.ui.workspaceTab === 'export');

      // Stage 1: No audio captured
      if (!hasAudio) {
        if (els.stepCapture) {
          els.stepCapture.classList.add('active');
          els.stepCapture.classList.remove('completed');
        }
        if (els.stepTransform) {
          els.stepTransform.classList.remove('active', 'completed');
        }
        if (els.stepExport) {
          els.stepExport.classList.remove('active', 'completed');
        }
        if (els.workflowHintText) {
          els.workflowHintText.innerHTML = 'Ready to start — tap <b>● Record</b> or drop an audio/video file.';
        }
        highlightNextAction(els.btnRecord);
        return;
      }

      // Has audio
      if (els.stepCapture) {
        els.stepCapture.classList.remove('active');
        els.stepCapture.classList.add('completed');
      }

      // Stage 3: In export tab
      if (isExportTab) {
        if (els.stepTransform) {
          els.stepTransform.classList.remove('active');
          els.stepTransform.classList.add('completed');
        }
        if (els.stepExport) {
          els.stepExport.classList.add('active');
          els.stepExport.classList.remove('completed');
        }
        if (els.workflowHintText) {
          const targetStr = S.lufsTarget && S.lufsTarget !== 'off' ? S.lufsTarget + ' LUFS' : 'Standard Limiter';
          els.workflowHintText.innerHTML = 'Mastering active (' + targetStr + ') — tap <b>Export WAV</b> or <b>MP3</b> to download.';
        }
        highlightNextAction(els.btnExportPrimary);
        return;
      }

      // Stage 2: Transform & Sculpt
      if (els.stepTransform) {
        els.stepTransform.classList.add('active');
        els.stepTransform.classList.remove('completed');
      }
      if (els.stepExport) {
        els.stepExport.classList.remove('active', 'completed');
      }
      if (els.workflowHintText) {
        const dur = S.buffer ? fmtTime(S.buffer.duration, false) : '0:00';
        if (S.presetChain && S.presetChain.length) {
          els.workflowHintText.innerHTML = 'Clip loaded (' + dur + ') · Chain: <b>' + S.presetChain.join(' + ') + '</b> — tap <b>▶ Play</b> to audition or <b>Master &amp; Export</b> when done.';
        } else {
          els.workflowHintText.innerHTML = 'Clip loaded (' + dur + ') — tap any <b>Voice Preset</b> or drag the <b>XY Pad</b>, then tap <b>▶ Play</b>.';
        }
      }
      if (S.playing) {
        highlightNextAction(null);
      } else {
        highlightNextAction(els.btnPlay);
      }
    }

    /* =========================================================
       Presets & customs
       ========================================================= */
    function setPresetTab(which, persist = true) {
      S.presetsSection = which;
      els.tabBuiltIn.classList.toggle('active', which === 'built-in');
      els.tabCustom.classList.toggle('active', which === 'custom');
      els.tabBuiltIn.setAttribute('aria-selected', String(which === 'built-in'));
      els.tabCustom.setAttribute('aria-selected', String(which === 'custom'));
      renderPresets();
      if (persist) schedulePersist();
    }

    function applyFxObject(fx, { presetId = null, customId = null, presetChain = null, presetChainMix = null, push = true } = {}) {
      if (push) pushHistory();
      S.fx = mergeFx(fx);
      if (customId) {
        S.presetChain = sanitizePresetChain(presetChain !== null ? presetChain : []);
        S.presetChainMix = sanitizeChainMix(presetChainMix, S.presetChain.length);
        S.activePresetId = S.presetChain.length ? S.presetChain[S.presetChain.length - 1] : null;
        S.activeCustomId = customId;
      } else if (presetId) {
        S.presetChain = [presetId];
        S.presetChainMix = [1];
        S.activePresetId = presetId;
        S.activeCustomId = null;
      } else {
        S.presetChain = sanitizePresetChain(presetChain !== null ? presetChain : []);
        S.presetChainMix = sanitizeChainMix(presetChainMix, S.presetChain.length);
        S.activePresetId = S.presetChain.length ? S.presetChain[S.presetChain.length - 1] : null;
        S.activeCustomId = null;
      }
      rebuildFxPanel();
      renderPresets();
      updateChainBar();
      updateTransportEnabled();
      schedulePersist();
      invalidatePreview();
      updateWorkflowGuide();
      if (S.playing) startPlayback();
    }

    function presetMatchesQuery(p, q) {
      if (!q) return true;
      const hay = ((p.name || '') + ' ' + (p.desc || '') + ' ' + (p.cat || '') + ' ' + (p.archetype || '') + ' ' + (p.id || '')).toLowerCase();
      return hay.includes(q);
    }

    function renderRecentRow() {
      if (!els.recentRow) return;
      els.recentRow.replaceChildren();
      if (S.presetsSection !== 'built-in') return;
      const ids = (S.ui && S.ui.recentPresetIds) || [];
      for (const id of ids) {
        const p = getPresetById(id);
        if (!p) continue;
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'recent-chip';
        btn.textContent = (p.emoji ? p.emoji + ' ' : '') + p.name;
        btn.addEventListener('click', () => togglePresetInChain(p.id));
        els.recentRow.appendChild(btn);
      }
    }

    function renderPresets() {
      els.presetGrid.replaceChildren();
      if (els.presetSearchRow) els.presetSearchRow.hidden = S.presetsSection !== 'built-in';
      renderRecentRow();
      if (S.presetsSection === 'built-in') {
        els.customEmpty.hidden = true;
        els.chainBar.hidden = false;
        if (els.catFilterBar) {
          els.catFilterBar.hidden = false;
          const totalCount = BUILTIN_PRESETS.length;
          const allBtn = els.catFilterBar.querySelector('[data-cat="all"]');
          if (allBtn) allBtn.textContent = 'All (' + totalCount + ')';
          els.catFilterBar.querySelectorAll('.cat-filter-btn').forEach((b) => {
            const catKey = b.dataset.cat;
            b.classList.toggle('active', catKey === (S.ui.presetCatFilter || 'all'));
          });
        }
        const q = ((S.ui && S.ui.presetSearch) || '').trim().toLowerCase();
        const byCat = {};
        for (const p of BUILTIN_PRESETS) {
          if (!presetMatchesQuery(p, q)) continue;
          const cat = p.cat || 'Other';
          if (!byCat[cat]) byCat[cat] = [];
          byCat[cat].push(p);
        }
        let cats = PRESET_CATS.filter((c) => byCat[c] && byCat[c].length);
        for (const cat of Object.keys(byCat)) {
          if (!cats.includes(cat)) cats.push(cat);
        }
        const activeFilter = (S.ui && S.ui.presetCatFilter) || 'all';
        if (!q && activeFilter !== 'all') {
          cats = cats.filter((c) => c === activeFilter);
        }
        if (!cats.length) {
          const empty = document.createElement('p');
          empty.className = 'empty-customs';
          empty.textContent = 'No presets match “' + (q || activeFilter) + '”.';
          els.presetGrid.appendChild(empty);
          return;
        }
        for (const cat of cats) {
          const list = byCat[cat] || [];
          const details = document.createElement('details');
          details.className = 'preset-expander';
          details.open = q ? true : S.presetCatOpen[cat] !== false;
          details.dataset.cat = cat;
          const summary = document.createElement('summary');
          const nameEl = document.createElement('span');
          nameEl.textContent = cat;
          const countEl = document.createElement('span');
          countEl.className = 'count';
          countEl.textContent = String(list.length);
          summary.append(nameEl, countEl);
          details.appendChild(summary);
          const grid = document.createElement('div');
          grid.className = 'preset-grid';
          grid.setAttribute('role', 'list');
          for (const p of list) {
            const chainIdx = S.presetChain.indexOf(p.id);
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'preset-card' + (chainIdx >= 0 ? ' active active-' + (chainIdx + 1) : '');
            btn.setAttribute('role', 'listitem');
            btn.setAttribute('aria-label', p.name + ' — ' + p.desc + (chainIdx >= 0 ? ' (chain ' + (chainIdx + 1) + ')' : ''));
            btn.setAttribute('aria-pressed', chainIdx >= 0 ? 'true' : 'false');
            btn.title = p.desc;
            if (chainIdx >= 0) {
              const badge = document.createElement('span');
              badge.className = 'chain-badge';
              badge.setAttribute('aria-hidden', 'true');
              badge.textContent = String(chainIdx + 1);
              btn.appendChild(badge);
            }
            const emoji = document.createElement('span');
            emoji.className = 'emoji';
            emoji.setAttribute('aria-hidden', 'true');
            emoji.textContent = p.emoji || '';
            const nm = document.createElement('div');
            nm.className = 'name';
            nm.textContent = p.name;
            const desc = document.createElement('div');
            desc.className = 'desc';
            desc.textContent = p.desc || '';
            btn.append(emoji, nm, desc);
            btn.addEventListener('click', () => togglePresetInChain(p.id));
            grid.appendChild(btn);
          }
          details.appendChild(grid);
          details.addEventListener('toggle', () => {
            S.presetCatOpen[cat] = details.open;
            schedulePersist();
          });
          els.presetGrid.appendChild(details);
        }
      } else {
        els.chainBar.hidden = true;
        if (els.recentRow) els.recentRow.replaceChildren();
        if (!S.customSettings.length) {
          els.customEmpty.hidden = false;
          return;
        }
        els.customEmpty.hidden = true;
        const grid = document.createElement('div');
        grid.className = 'preset-grid';
        grid.setAttribute('role', 'list');
        for (const c of S.customSettings) {
          const chainItems = getPresetChainItems(c.presetChain);
          const chainDescText = chainItems.length
            ? (chainItems.length > 1 ? 'Chain: ' : 'Preset: ') + chainItems.map((i) => i.fullName).join(' → ')
            : 'Manual sliders';
          const wrap = document.createElement('div');
          wrap.className = 'preset-card custom-actions' + (S.activeCustomId === c.id ? ' active' : '');
          wrap.setAttribute('role', 'listitem');

          const loadBtn = document.createElement('button');
          loadBtn.type = 'button';
          loadBtn.className = 'btn-ghost grow load';
          loadBtn.style.cssText = 'text-align:left;border:none;padding:0;min-height:0;width:100%;';
          loadBtn.setAttribute('aria-label', 'Load setting: ' + c.name + ' (' + chainDescText + ')');
          loadBtn.title = c.name + ' · ' + chainDescText;

          const em = document.createElement('div');
          em.className = 'emoji';
          em.textContent = c.emoji || '⭐';
          const nm = document.createElement('div');
          nm.className = 'name';
          nm.textContent = c.name;
          const desc = document.createElement('div');
          desc.className = 'desc chain-info';
          if (chainItems.length) {
            const lab = document.createElement('span');
            lab.className = 'chain-label';
            lab.textContent = chainItems.length > 1 ? 'Chain:' : 'Preset:';
            desc.appendChild(lab);
            chainItems.forEach((item, i) => {
              if (i) {
                const ar = document.createElement('span');
                ar.className = 'chain-arrow';
                ar.textContent = '→';
                desc.appendChild(ar);
              }
              const tag = document.createElement('span');
              tag.className = 'chain-tag';
              tag.textContent = item.fullName;
              desc.appendChild(tag);
            });
          } else {
            const muted = document.createElement('span');
            muted.className = 'muted-text';
            muted.textContent = 'Manual sliders';
            desc.appendChild(muted);
          }
          loadBtn.append(em, nm, desc);
          loadBtn.addEventListener('click', () => {
            applyFxObject(c.fx, { customId: c.id, presetChain: c.presetChain, presetChainMix: c.presetChainMix });
            toast('Loaded “' + c.name + '”');
          });

          const miniRow = document.createElement('div');
          miniRow.className = 'mini-row';
          const mk = (cls, label, danger) => {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = danger ? cls + ' btn-danger' : cls;
            b.setAttribute('aria-label', label);
            b.textContent = label;
            return b;
          };
          const renameBtn = mk('rename', 'Rename');
          const overwriteBtn = mk('overwrite', 'Overwrite');
          const delBtn = mk('del', 'Delete', true);
          renameBtn.addEventListener('click', () => renameCustom(c.id));
          overwriteBtn.addEventListener('click', () => overwriteCustom(c.id));
          delBtn.addEventListener('click', () => deleteCustom(c.id));
          miniRow.append(renameBtn, overwriteBtn, delBtn);
          wrap.append(loadBtn, miniRow);
          grid.appendChild(wrap);
        }
        els.presetGrid.appendChild(grid);
      }
    }

    function openSaveModal() {
      els.saveName.value = '';
      if (S.activeCustomId) {
        const c = S.customSettings.find((x) => x.id === S.activeCustomId);
        if (c) els.saveName.value = c.name;
      }
      els.saveOverwrite.hidden = true;
      showModal(els.saveModal);
      setTimeout(() => els.saveName.focus(), 50);
    }

    function saveCustomFromModal(forceOverwrite) {
      const name = (els.saveName.value || '').trim();
      if (!name) {
        toast('Enter a name for this setting.', 'error');
        return;
      }
      if (name.length > 40) {
        toast('Name must be 40 characters or fewer.', 'error');
        return;
      }
      const existing = S.customSettings.find((c) => c.name.toLowerCase() === name.toLowerCase());
      if (existing && !forceOverwrite) {
        els.saveOverwrite.hidden = false;
        toast('Name already exists — overwrite or rename.');
        return;
      }
      const chain = sanitizePresetChain(S.presetChain);
      const mix = sanitizeChainMix(S.presetChainMix, chain.length);
      if (existing && forceOverwrite) {
        existing.fx = { ...S.fx };
        existing.presetChain = chain;
        existing.presetChainMix = mix;
        existing.updatedAt = Date.now();
        S.activeCustomId = existing.id;
        S.activePresetId = S.presetChain.length ? S.presetChain[S.presetChain.length - 1] : null;
        hideModal(els.saveModal);
        renderPresets();
        updateChainBar();
        schedulePersist();
        toast('Saved “' + existing.name + '”', 'ok');
        return;
      }
      if (S.customSettings.length >= MAX_CUSTOMS) {
        toast('Limit of 50 custom settings reached. Delete one to save another.', 'error');
        return;
      }
      const item = {
        id: uid(),
        name,
        fx: { ...S.fx },
        presetChain: chain,
        presetChainMix: mix,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        emoji: '⭐'
      };
      S.customSettings.unshift(item);
      S.activeCustomId = item.id;
      S.activePresetId = S.presetChain.length ? S.presetChain[S.presetChain.length - 1] : null;
      hideModal(els.saveModal);
      setPresetTab('custom');
      updateChainBar();
      schedulePersist();
      toast('Saved “' + name + '”', 'ok');
    }

    async function renameCustom(id) {
      const c = S.customSettings.find((x) => x.id === id);
      if (!c) return;
      const name = await studioPrompt('Enter new name for setting:', c.name, { title: 'Rename Custom Voice', label: 'Preset Name', confirmText: 'Rename' });
      if (name == null) return;
      const n = name.trim();
      if (!n || n.length > 40) {
        toast('Invalid name.', 'error');
        return;
      }
      if (S.customSettings.some((x) => x.id !== id && x.name.toLowerCase() === n.toLowerCase())) {
        toast('Name already in use.', 'error');
        return;
      }
      c.name = n;
      c.updatedAt = Date.now();
      renderPresets();
      schedulePersist();
    }

    async function overwriteCustom(id) {
      const c = S.customSettings.find((x) => x.id === id);
      if (!c) return;
      const ok = await studioConfirm('Overwrite “' + c.name + '” with current FX?', { title: 'Overwrite Voice Setting', confirmText: 'Overwrite' });
      if (!ok) return;
      c.fx = { ...S.fx };
      c.presetChain = sanitizePresetChain(S.presetChain);
      c.presetChainMix = sanitizeChainMix(S.presetChainMix, c.presetChain.length);
      c.updatedAt = Date.now();
      S.activeCustomId = c.id;
      S.activePresetId = S.presetChain.length ? S.presetChain[S.presetChain.length - 1] : null;
      renderPresets();
      updateChainBar();
      schedulePersist();
      toast('Updated “' + c.name + '”', 'ok');
    }

    async function deleteCustom(id) {
      const c = S.customSettings.find((x) => x.id === id);
      if (!c) return;
      const ok = await studioConfirm('Delete “' + c.name + '”? This can’t be undone.', { title: 'Delete Custom Voice', confirmText: 'Delete', danger: true });
      if (!ok) return;
      S.customSettings = S.customSettings.filter((x) => x.id !== id);
      if (S.activeCustomId === id) S.activeCustomId = null;
      renderPresets();
      schedulePersist();
      toast('Deleted “' + c.name + '”');
    }

    /* =========================================================
       FX panel
       ========================================================= */
    function formatFxVal(key, v, unit) {
      if (typeof v === 'boolean') return v ? 'On' : 'Off';
      if (unit === 'st' || unit === 'dB' || unit === '×' || unit === ':1') {
        return (Math.round(v * 100) / 100) + (unit ? ' ' + unit : '');
      }
      if (unit === 'Hz' || unit === 's') return (Math.round(v * 100) / 100) + ' ' + unit;
      return String(Math.round(v * 100) / 100);
    }

    function rebuildFxPanel() {
      const root = els.fxPanel;
      root.replaceChildren();
      syncVocalCleanupUI();
      syncAmbienceUI();
      for (const group of FX_META) {
        const sec = document.createElement('div');
        sec.className = 'fx-group';
        const h3 = document.createElement('h3');
        h3.textContent = group.group;
        sec.appendChild(h3);
        for (const p of group.params) {
          if (p.type === 'bool') {
            const row = document.createElement('div');
            row.className = 'toggle-row';
            const span = document.createElement('span');
            span.textContent = p.label;
            const lab = document.createElement('label');
            lab.className = 'switch';
            const cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.dataset.key = p.key;
            cb.checked = !!S.fx[p.key];
            const knob = document.createElement('span');
            lab.append(cb, knob);
            row.append(span, lab);
            cb.addEventListener('change', (e) => {
              pushHistory();
              S.fx[p.key] = e.target.checked;
              onFxEdited();
            });
            sec.appendChild(row);
          } else if (p.type === 'select') {
            const row = document.createElement('div');
            row.className = 'fx-row select-row';
            const id = 'fx_' + p.key;
            const label = document.createElement('label');
            label.setAttribute('for', id);
            const labName = document.createElement('span');
            labName.textContent = p.label;
            label.appendChild(labName);
            const sel = document.createElement('select');
            sel.id = id;
            for (const opt of p.options) {
              const o = document.createElement('option');
              o.value = opt.value;
              o.textContent = opt.label;
              if (String(S.fx[p.key]) === String(opt.value)) o.selected = true;
              sel.appendChild(o);
            }
            sel.addEventListener('change', () => {
              pushHistory();
              S.fx[p.key] = p.key === 'vocoderBands' ? parseInt(sel.value, 10) : sel.value;
              onFxEdited(true);
            });
            row.append(label, sel);
            sec.appendChild(row);
          } else {
            const row = document.createElement('div');
            row.className = 'fx-row';
            const id = 'fx_' + p.key;
            const isExternal = p.external === 'inputGain';
            const cur = isExternal ? S.inputGain : S.fx[p.key];
            const label = document.createElement('label');
            label.setAttribute('for', id);
            const labName = document.createElement('span');
            labName.textContent = p.label;
            const valEl = document.createElement('span');
            valEl.className = 'val';
            valEl.dataset.val = p.key;
            valEl.textContent = formatFxVal(p.key, cur, p.unit);
            label.append(labName, valEl);
            const input = document.createElement('input');
            input.type = 'range';
            input.id = id;
            input.min = String(p.min);
            input.max = String(p.max);
            input.step = String(p.step);
            input.value = String(cur);
            input.setAttribute('aria-valuetext', formatFxVal(p.key, cur, p.unit));
            row.append(label, input);
            let gesturePushed = false;
            const markGesture = () => {
              if (gesturePushed) return;
              pushHistory();
              gesturePushed = true;
            };
            input.addEventListener('pointerdown', markGesture);
            input.addEventListener('touchstart', markGesture, { passive: true });
            input.addEventListener('keydown', (e) => {
              if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(e.key)) {
                markGesture();
              }
            });
            const endGesture = () => { gesturePushed = false; };
            input.addEventListener('pointerup', endGesture);
            input.addEventListener('change', endGesture);
            const onInput = () => {
              const v = parseFloat(input.value);
              if (isExternal) {
                S.inputGain = clampNum(v, 0.5, 9, 1);
                valEl.textContent = formatFxVal(p.key, S.inputGain, p.unit);
                input.setAttribute('aria-valuetext', valEl.textContent);
                if (els.inputGain) {
                  els.inputGain.value = String(S.inputGain);
                  els.inputGainVal.textContent = formatGainX(S.inputGain);
                }
                schedulePersist();
                updateTransportEnabled();
                if (activePlayChain && activePlayChain.updateLiveParams && !S.comparingDry) {
                  activePlayChain.updateLiveParams(S.fx, { inputGain: S.inputGain });
                } else if (S.playing) {
                  startPlayback();
                }
              } else {
                S.fx[p.key] = clampFxValue(p.key, v);
                valEl.textContent = formatFxVal(p.key, S.fx[p.key], p.unit);
                input.setAttribute('aria-valuetext', valEl.textContent);
                onFxEdited(false);
              }
            };
            input.addEventListener('input', onInput);
            input.addEventListener('change', () => {
              if (isExternal) {
                schedulePersist();
                if (activePlayChain && activePlayChain.updateLiveParams && !S.comparingDry) {
                  activePlayChain.updateLiveParams(S.fx, { inputGain: S.inputGain });
                } else if (S.playing) {
                  startPlayback();
                }
              } else onFxEdited(true);
            });
            sec.appendChild(row);
          }
        }
        root.appendChild(sec);
      }
    }

    function fxMatchesChain() {
      if (!S.presetChain.length) return false;
      let expected = null;
      for (let i = 0; i < S.presetChain.length; i++) {
        const p = getPresetById(S.presetChain[i]);
        if (!p) return false;
        const partial = scalePresetPartial(p.fx, S.presetChainMix[i]);
        expected = expected ? blendPartialOnto(expected, partial) : mergeFx(partial);
      }
      if (!expected) return false;
      for (const k of Object.keys(defaultFx())) {
        if (typeof expected[k] === 'number') {
          if (Math.abs((S.fx[k] || 0) - expected[k]) > 0.001) return false;
        } else if (S.fx[k] !== expected[k]) return false;
      }
      return true;
    }

    function syncVocalCleanupUI() {
      if (els.gateThreshold) {
        els.gateThreshold.value = String(S.fx.gateThreshold != null ? S.fx.gateThreshold : -100);
        if (els.gateThresholdVal) els.gateThresholdVal.textContent = (S.fx.gateThreshold != null ? S.fx.gateThreshold : -100) + ' dB';
      }
      if (els.deEssAmount) {
        els.deEssAmount.value = String(S.fx.deEssAmount != null ? S.fx.deEssAmount : 0);
        if (els.deEssAmountVal) els.deEssAmountVal.textContent = Math.round((S.fx.deEssAmount || 0) * 100) + '%';
      }
      if (els.humNotchSelect) {
        els.humNotchSelect.value = String(S.fx.humNotch || 0);
      }
    }

    function syncAmbienceUI() {
      const preset = S.fx.ambiencePreset || 'none';
      const mix = S.fx.ambienceMix != null ? S.fx.ambienceMix : 0;
      const duck = S.fx.ambienceDuck != null ? S.fx.ambienceDuck : 0.55;
      const tone = S.fx.ambienceTone != null ? S.fx.ambienceTone : 0;

      if (els.ambiencePresetSelect) {
        els.ambiencePresetSelect.value = preset;
      }
      if (els.ambienceQuickChips) {
        els.ambienceQuickChips.querySelectorAll('.ambience-chip-btn').forEach((btn) => {
          btn.classList.toggle('active', btn.dataset.scene === preset);
        });
      }
      if (els.ambienceMix) {
        els.ambienceMix.value = String(mix);
        if (els.ambienceMixVal) els.ambienceMixVal.textContent = Math.round(mix * 100) + '%';
      }
      if (els.ambienceDuck) {
        els.ambienceDuck.value = String(duck);
        if (els.ambienceDuckVal) els.ambienceDuckVal.textContent = Math.round(duck * 100) + '%';
      }
      if (els.ambienceTone) {
        els.ambienceTone.value = String(tone);
        if (els.ambienceToneVal) {
          const sign = tone > 0 ? '+' : '';
          els.ambienceToneVal.textContent = sign + tone.toFixed(1) + ' dB';
        }
      }
    }

    async function loadDemoVoice(voiceType) {
      if (S.baking || S.recording || S.loading) return;
      const voices = getDemoVoices ? getDemoVoices() : [];
      const vObj = voices.find((v) => v.id === voiceType) || voices[0];
      const label = vObj ? vObj.name : voiceType;

      if (S.buffer) {
        const ok = await studioConfirm('Load demo speech sample “' + label + '”? Current audio will be replaced.', {
          title: 'Load Demo Speech',
          confirmText: 'Load Demo'
        });
        if (!ok) return;
      }

      try {
        ensureAudioCtx();
        const demoBuf = synthesizeDemoVoice(voiceType || 'baritone');
        if (!demoBuf) throw new Error('Demo synthesis failed');
        setBuffer(demoBuf, {
          name: 'Demo: ' + label,
          clearVideo: true
        });
        toast('Loaded demo voice: ' + label, 'ok');
      } catch (err) {
        console.error(err);
        toast('Failed to generate demo voice sample.', 'error');
      }
    }

    function onFxEdited(restart = true, opts = {}) {
      if (opts.pushHistory) pushHistory();
      // Manual slider drift: keep chain badges until values no longer match chain recipe
      if (S.presetChain.length && !fxMatchesChain()) {
        S.presetChain = [];
        S.presetChainMix = [];
        S.activePresetId = null;
      }
      if (S.activeCustomId) {
        const c = S.customSettings.find((x) => x.id === S.activeCustomId);
        if (c) {
          const m = mergeFx(c.fx);
          for (const k of Object.keys(defaultFx())) {
            if (typeof m[k] === 'number') {
              if (Math.abs((S.fx[k] || 0) - m[k]) > 0.001) {
                S.activeCustomId = null;
                break;
              }
            } else if (S.fx[k] !== m[k]) {
              S.activeCustomId = null;
              break;
            }
          }
        }
      }
      syncVocalCleanupUI();
      syncAmbienceUI();
      renderPresets();
      updateChainBar();
      updateTransportEnabled();
      schedulePersist();

      const currentFp = getOfflineDspFingerprint(S.fx);
      const offlineUnchanged = (currentFp === lastBakedFingerprint && S.previewBuf != null);

      if (offlineUnchanged && S.playing && activePlayChain && activePlayChain.updateLiveParams && !S.comparingDry) {
        activePlayChain.updateLiveParams(S.fx, { inputGain: S.inputGain });
      } else {
        invalidatePreview();
        if (restart && S.playing) startPlayback();
      }
    }

    /**
     * Reset FX → defaults + restore working audio to the most original
     * (record/upload buffer). Any Apply FX bakes are discarded.
     */
    function resetFx() {
      const wasPlaying = S.playing;
      setDry(false, false);
      const needsAudioRestore = !!(S.originalBuffer && S.buffer && bufferIsBakedFromOriginal());
      const needsFxReset =
        !fxEqualsDefault(S.fx) ||
        S.presetChain.length > 0 ||
        !!S.activeCustomId;

      if (!needsAudioRestore && !needsFxReset) {
        toast('Already at original audio and default FX');
        return;
      }

      // Capture current working audio + FX so Undo can bring bake/FX back
      pushHistory({ includeBuffer: true });
      stopPlayback(false);

      if (S.originalBuffer) {
        S.buffer = cloneBuffer(S.originalBuffer);
        S.playhead = 0;
        els.waveEmpty.classList.add('hidden');
        if (S.sourceName) {
          els.sourceMeta.textContent =
            S.sourceName +
            ' · mono · ' +
            fmtTime(S.buffer.duration, false) +
            ' · ' +
            S.buffer.sampleRate +
            ' Hz';
        }
        updateTimeChip();
        drawWave();
        syncVideo();
      }

      S.fx = defaultFx();
      S.presetChain = [];
      S.presetChainMix = [];
      S.activePresetId = null;
      S.activeCustomId = null;
      rebuildFxPanel();
      renderPresets();
      updateChainBar();
      updateTransportEnabled();
      schedulePersist();
      updateUndoButtons();
      if (wasPlaying && S.buffer) startPlayback();
      toast(
        needsAudioRestore
          ? 'Restored original audio + FX defaults'
          : 'FX reset to defaults',
        'ok'
      );
    }

    /**
     * Reset Audio → clears current recording or uploaded audio clip, playhead, history & video preview.
     * Preserves FX parameters and custom preset selections so user can record or upload a new audio file with their desired FX intact.
     */
    function resetAudio() {
      if (!S.buffer && !S.originalBuffer) {
        toast('No audio to reset');
        return;
      }
      stopPlayback(true);
      if (S.recording) stopRecording();
      setDry(false, false);
      S.buffer = null;
      S.originalBuffer = null;
      S.playhead = 0;
      S.sourceName = '';
      clearHistory();
      clearRecordHistory();
      takeCounter = 0;
      revokeVideo();
      els.waveEmpty.classList.remove('hidden');
      if (els.sourceMeta) els.sourceMeta.textContent = '';
      updateUndoButtons();
      updateRecordHistoryUI();
      updateTransportEnabled();
      updateTimeChip();
      drawWave();
      schedulePersist();
      updateWorkflowGuide();
      toast('Audio reset', 'ok');
    }

    /* =========================================================
       Reset project / clear storage
       ========================================================= */
    function resetProject() {
      stopPlayback(true);
      if (S.recording) stopRecording();
      setDry(false, false);
      S.buffer = null;
      S.originalBuffer = null;
      S.playhead = 0;
      S.fx = defaultFx();
      S.presetChain = [];
      S.presetChainMix = [];
      S.activePresetId = null;
      S.activeCustomId = null;
      S.sourceName = '';
      clearHistory();
      clearRecordHistory();
      takeCounter = 0;
      revokeVideo();
      els.waveEmpty.classList.remove('hidden');
      els.sourceMeta.textContent = '';
      rebuildFxPanel();
      renderPresets();
      updateChainBar();
      updateUndoButtons();
      updateRecordHistoryUI();
      updateTransportEnabled();
      updateTimeChip();
      drawWave();
      schedulePersist();
      updateWorkflowGuide();
      toast('Project reset');
    }

    async function clearAllSaved() {
      const ok = await studioConfirm('Clear all saved settings, preferences, and custom voices on this device?', { title: 'Clear All Saved Data', confirmText: 'Clear All', danger: true });
      if (!ok) return;
      try { localStorage.removeItem(STORAGE_KEY); } catch (_) {}
      setDry(false, false);
      S.customSettings = [];
      S.fx = defaultFx();
      S.presetChain = [];
      S.presetChainMix = [];
      S.activePresetId = null;
      S.activeCustomId = null;
      S.loop = false;
      S.skipIntervalSec = 5;
      S.lastExportFormat = 'wav';
      S.advancedLabExpanded = false;
      S.presetsSection = 'built-in';
      S.presetCatOpen = Object.fromEntries(PRESET_CATS.map((c) => [c, true]));
      S.micLevel = defaultMicLevel();
      S.inputGain = defaultInputGain();
      S.recMode = 'standalone';
      S.ui = {
        fxSourceMode: 'local',
        fxRemoteUrl: '',
        maxRecordSec: 180,
        recMode: 'standalone',
        recentPresetIds: [],
        presetSearch: '',
        presetCatOpen: { ...S.presetCatOpen }
      };
      undoStack = [];
      redoStack = [];
      els.btnLoop.classList.remove('active-loop');
      els.btnLoop.setAttribute('aria-pressed', 'false');
      els.labDetails.open = false;
      els.skipInterval.value = '5';
      els.exportPref.value = 'wav';
      if (els.maxRecordSec) els.maxRecordSec.value = '180';
      if (els.presetSearch) els.presetSearch.value = '';
      if (els.fxSourceMode) els.fxSourceMode.value = 'local';
      if (els.fxRemoteUrl) els.fxRemoteUrl.value = '';
      if (els.fxRemoteUrlGroup) els.fxRemoteUrlGroup.hidden = true;
      if (els.recModeStandalone) els.recModeStandalone.checked = true;
      if (els.recModeAppend) els.recModeAppend.checked = false;
      syncGainSlidersUI();
      setPresetTab('built-in', false);
      rebuildFxPanel();
      renderPresets();
      updateChainBar();
      updateUndoButtons();
      updateTransportEnabled();
      toast('All saved data cleared', 'ok');
    }

    /* =========================================================
       Project Manager & IndexedDB Store
       ========================================================= */
    const IDB_NAME = 'VoxClipStudioProjects';
    const IDB_STORE = 'projects';
    const IDB_VERSION = 1;

    function openProjectsDb() {
      return new Promise((resolve, reject) => {
        if (typeof indexedDB === 'undefined') {
          return reject(new Error('IndexedDB is not supported in this environment'));
        }
        const req = indexedDB.open(IDB_NAME, IDB_VERSION);
        req.onupgradeneeded = (e) => {
          const db = e.target.result;
          if (!db.objectStoreNames.contains(IDB_STORE)) {
            const store = db.createObjectStore(IDB_STORE, { keyPath: 'id' });
            store.createIndex('updatedAt', 'updatedAt', { unique: false });
          }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error || new Error('Failed to open projects database'));
      });
    }

    async function saveProjectToDb(projectDoc) {
      const db = await openProjectsDb();
      return new Promise((resolve, reject) => {
        const tx = db.transaction([IDB_STORE], 'readwrite');
        const store = tx.objectStore(IDB_STORE);
        const req = store.put(projectDoc);
        req.onsuccess = () => resolve(projectDoc.id);
        req.onerror = () => reject(req.error || new Error('Failed to save project to IndexedDB'));
      });
    }

    async function listProjectsFromDb() {
      const db = await openProjectsDb();
      return new Promise((resolve, reject) => {
        const tx = db.transaction([IDB_STORE], 'readonly');
        const store = tx.objectStore(IDB_STORE);
        const req = store.getAll();
        req.onsuccess = () => {
          const items = req.result || [];
          items.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
          resolve(items);
        };
        req.onerror = () => reject(req.error || new Error('Failed to list projects'));
      });
    }

    async function getProjectFromDb(id) {
      const db = await openProjectsDb();
      return new Promise((resolve, reject) => {
        const tx = db.transaction([IDB_STORE], 'readonly');
        const store = tx.objectStore(IDB_STORE);
        const req = store.get(id);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error || new Error('Failed to load project'));
      });
    }

    async function deleteProjectFromDb(id) {
      const db = await openProjectsDb();
      return new Promise((resolve, reject) => {
        const tx = db.transaction([IDB_STORE], 'readwrite');
        const store = tx.objectStore(IDB_STORE);
        const req = store.delete(id);
        req.onsuccess = () => resolve(true);
        req.onerror = () => reject(req.error || new Error('Failed to delete project'));
      });
    }

    async function createProjectSnapshot(name) {
      const now = Date.now();
      const projName = String(name || '').trim() || (S.sourceName ? (S.sourceName.startsWith('Take') || S.sourceName.startsWith('Recording') ? ('Project ' + S.sourceName) : S.sourceName) : ('VoxProject ' + new Date().toISOString().slice(0, 10)));

      const takesData = [];
      for (const take of recordHistory) {
        if (!take || !take.buffer) continue;
        let base64 = '';
        try {
          base64 = await bufferToBase64Wav(take.buffer);
        } catch (e) {
          console.warn('Failed to encode take buffer:', e);
        }
        takesData.push({
          id: String(take.id || uid()),
          name: String(take.name || 'Take'),
          duration: take.buffer.duration,
          sampleRate: take.buffer.sampleRate,
          createdAt: Number(take.createdAt) || now,
          wavBase64: base64
        });
      }

      let currentBase64 = '';
      if (S.buffer) {
        try {
          currentBase64 = await bufferToBase64Wav(S.buffer);
        } catch (e) {
          console.warn('Failed to encode current buffer:', e);
        }
      }

      let origBase64 = '';
      if (S.originalBuffer) {
        try {
          origBase64 = await bufferToBase64Wav(S.originalBuffer);
        } catch (e) {
          console.warn('Failed to encode original buffer:', e);
        }
      }

      return {
        id: uid(),
        kind: 'voxclip.studio.project.v1',
        version: 3,
        name: projName,
        createdAt: now,
        updatedAt: now,
        metadata: {
          name: projName,
          sourceName: S.sourceName || '',
          takeCounter,
          recordHistoryIndex,
          createdAt: now,
          updatedAt: now,
          totalTakes: takesData.length,
          duration: S.buffer ? S.buffer.duration : 0
        },
        settings: {
          fx: { ...S.fx },
          presetChain: [...S.presetChain],
          presetChainMix: sanitizeChainMix(S.presetChainMix, S.presetChain.length),
          activePresetId: S.presetChain.length ? S.presetChain[S.presetChain.length - 1] : null,
          activeCustomId: S.activeCustomId,
          customSettings: Array.isArray(S.customSettings) ? JSON.parse(JSON.stringify(S.customSettings)) : [],
          cueMarkers: Array.isArray(S.cueMarkers) ? JSON.parse(JSON.stringify(S.cueMarkers)) : [],
          ui: {
            loop: !!S.loop,
            skipIntervalSec: S.skipIntervalSec,
            lastExportFormat: S.lastExportFormat,
            advancedLabExpanded: !!S.advancedLabExpanded,
            presetsSection: S.presetsSection || 'built-in',
            micLevel: S.micLevel,
            inputGain: S.inputGain,
            fxSourceMode: (S.ui && S.ui.fxSourceMode) || 'local',
            fxRemoteUrl: (S.ui && S.ui.fxRemoteUrl) || '',
            maxRecordSec: (S.ui && S.ui.maxRecordSec) || 180,
            recMode: S.recMode || 'standalone',
            recentPresetIds: (S.ui && S.ui.recentPresetIds) ? S.ui.recentPresetIds.slice(0, 8) : [],
            presetSearch: (S.ui && S.ui.presetSearch) || '',
            waveZoom: S.waveZoom || 1,
            waveViewStart: S.waveViewStart || 0
          }
        },
        audio: {
          hasAudio: !!S.buffer,
          duration: S.buffer ? S.buffer.duration : 0,
          sampleRate: S.buffer ? S.buffer.sampleRate : 48000,
          current: S.buffer ? {
            duration: S.buffer.duration,
            sampleRate: S.buffer.sampleRate,
            wavBase64: currentBase64
          } : null,
          original: S.originalBuffer ? {
            duration: S.originalBuffer.duration,
            sampleRate: S.originalBuffer.sampleRate,
            wavBase64: origBase64
          } : null,
          takes: takesData
        }
      };
    }

    async function restoreProjectFromData(projectDoc) {
      if (!projectDoc || typeof projectDoc !== 'object') {
        throw new Error('Invalid project file format');
      }
      stopPlayback(true);
      if (S.recording) stopRecording();
      setDry(false, false);
      revokeVideo();

      const settings = projectDoc.settings || projectDoc;
      const uiSettings = settings.ui || {};

      // Restore FX
      S.fx = mergeFx(settings.fx || projectDoc.fx);
      S.presetChain = sanitizePresetChain(settings.presetChain !== undefined ? settings.presetChain : projectDoc.presetChain);
      S.presetChainMix = sanitizeChainMix(settings.presetChainMix !== undefined ? settings.presetChainMix : projectDoc.presetChainMix, S.presetChain.length);
      S.activePresetId = S.presetChain.length ? S.presetChain[S.presetChain.length - 1] : (settings.activePresetId || projectDoc.activePresetId || null);
      S.activeCustomId = settings.activeCustomId || projectDoc.activeCustomId || null;

      // Restore Custom presets if present in project
      const rawCustoms = Array.isArray(settings.customSettings) ? settings.customSettings : (Array.isArray(projectDoc.customSettings) ? projectDoc.customSettings : null);
      if (rawCustoms) {
        const mergedCustoms = [...S.customSettings];
        for (const c of rawCustoms) {
          if (!mergedCustoms.some((x) => x.id === c.id || x.name === c.name)) {
            if (mergedCustoms.length < MAX_CUSTOMS) {
              mergedCustoms.push(c);
            }
          }
        }
        S.customSettings = mergedCustoms;
      }

      // If activeCustomId was set and custom preset exists, ensure custom settings are active
      if (fxEqualsDefault(S.fx)) {
        if (S.activeCustomId) {
          const c = S.customSettings.find((x) => x.id === S.activeCustomId);
          if (c && c.fx) {
            S.fx = mergeFx(c.fx);
            if (c.presetChain) S.presetChain = sanitizePresetChain(c.presetChain);
            if (c.presetChainMix) S.presetChainMix = sanitizeChainMix(c.presetChainMix, S.presetChain.length);
          }
        } else if (S.presetChain.length > 0) {
          recomputeFxFromChain();
        }
      }

      // Restore UI flags
      S.loop = !!uiSettings.loop;
      if (els.btnLoop) {
        els.btnLoop.classList.toggle('active-loop', S.loop);
        els.btnLoop.setAttribute('aria-pressed', S.loop ? 'true' : 'false');
      }
      if ([1, 3, 5, 10].includes(uiSettings.skipIntervalSec)) {
        S.skipIntervalSec = uiSettings.skipIntervalSec;
        if (els.skipInterval) els.skipInterval.value = String(S.skipIntervalSec);
      }
      if (uiSettings.lastExportFormat === 'wav' || uiSettings.lastExportFormat === 'mp3') {
        S.lastExportFormat = uiSettings.lastExportFormat;
        if (els.exportPref) els.exportPref.value = S.lastExportFormat;
      }
      S.advancedLabExpanded = !!uiSettings.advancedLabExpanded;
      if (els.labDetails) els.labDetails.open = S.advancedLabExpanded;
      if (uiSettings.micLevel) S.micLevel = clampNum(uiSettings.micLevel, 1, 12, defaultMicLevel());
      if (uiSettings.inputGain) S.inputGain = clampNum(uiSettings.inputGain, 0.5, 9, defaultInputGain());

      if (uiSettings.recMode === 'standalone' || uiSettings.recMode === 'append') {
        S.recMode = uiSettings.recMode;
        if (S.recMode === 'append' && els.recModeAppend) els.recModeAppend.checked = true;
        else if (els.recModeStandalone) els.recModeStandalone.checked = true;
      }

      if (uiSettings.presetsSection === 'custom' || uiSettings.presetsSection === 'built-in') {
        setPresetTab(uiSettings.presetsSection, false);
      }
      if (uiSettings.presetSearch !== undefined) {
        if (!S.ui) S.ui = {};
        S.ui.presetSearch = uiSettings.presetSearch;
        if (els.presetSearch) els.presetSearch.value = S.ui.presetSearch;
      }
      if (Array.isArray(uiSettings.recentPresetIds)) {
        if (!S.ui) S.ui = {};
        S.ui.recentPresetIds = uiSettings.recentPresetIds.slice(0, 8);
      }

      // Restore Cue Markers
      S.cueMarkers = Array.isArray(settings.cueMarkers) ? settings.cueMarkers : [];
      renderCueMarkers();

      // Restore Audio Buffers & Recording History
      ensureAudioCtx();
      await audioCtx.resume().catch(() => {});

      const meta = projectDoc.metadata || {};
      S.sourceName = meta.sourceName || meta.name || projectDoc.name || 'Restored Project';

      clearHistory();
      clearRecordHistory();

      const audioData = projectDoc.audio;
      let restoredBuf = null;
      let restoredOrig = null;

      if (audioData && audioData.hasAudio) {
        // Decode takes
        if (Array.isArray(audioData.takes) && audioData.takes.length > 0) {
          for (const take of audioData.takes) {
            if (!take.wavBase64) continue;
            try {
              const ab = base64ToArrayBuffer(take.wavBase64);
              const decoded = await safeDecodeAudioData(audioCtx, ab);
              const mono = toMonoBuffer(decoded);
              recordHistory.push({
                id: String(take.id || uid()),
                name: String(take.name || 'Take'),
                buffer: mono,
                duration: mono.duration,
                sampleRate: mono.sampleRate,
                createdAt: Number(take.createdAt) || Date.now()
              });
            } catch (e) {
              console.warn('Failed to decode take:', take.name, e);
            }
          }
        }

        // Decode current working buffer
        if (audioData.current && audioData.current.wavBase64) {
          try {
            const ab = base64ToArrayBuffer(audioData.current.wavBase64);
            const decoded = await safeDecodeAudioData(audioCtx, ab);
            restoredBuf = toMonoBuffer(decoded);
          } catch (e) {
            console.warn('Failed to decode current audio:', e);
          }
        }

        // Decode original buffer
        if (audioData.original && audioData.original.wavBase64) {
          try {
            const ab = base64ToArrayBuffer(audioData.original.wavBase64);
            const decoded = await safeDecodeAudioData(audioCtx, ab);
            restoredOrig = toMonoBuffer(decoded);
          } catch (e) {
            console.warn('Failed to decode original audio:', e);
          }
        }

        // Fallbacks if current/original not specified directly but takes exist
        if (!restoredBuf && recordHistory.length > 0) {
          const idx = clampNum(meta.recordHistoryIndex, 0, recordHistory.length - 1, recordHistory.length - 1);
          restoredBuf = cloneBuffer(recordHistory[idx].buffer);
        }
        if (!restoredOrig && restoredBuf) {
          restoredOrig = cloneBuffer(restoredBuf);
        }

        takeCounter = meta.takeCounter || recordHistory.length;
        recordHistoryIndex = clampNum(meta.recordHistoryIndex, 0, Math.max(0, recordHistory.length - 1), recordHistory.length - 1);

        if (restoredBuf) {
          S.buffer = restoredBuf;
          S.originalBuffer = restoredOrig || cloneBuffer(restoredBuf);
          S.peakPyramid = buildPeakPyramid(restoredBuf);
          S.waveZoom = uiSettings.waveZoom || 1;
          S.waveViewStart = uiSettings.waveViewStart || 0;
          if (els.zoomChip) els.zoomChip.textContent = (Math.round(S.waveZoom * 10) / 10) + '×';
          S.playhead = 0;
          els.waveEmpty.classList.add('hidden');
          if (els.sourceMeta) {
            els.sourceMeta.textContent = S.sourceName + ' · mono · ' + fmtTime(restoredBuf.duration, false) + ' · ' + restoredBuf.sampleRate + ' Hz';
          }
          // Immediately generate preview buffer with restored FX (pitch, reverse, crush, etc.) applied to raw audio
          rebuildPreview();
        } else {
          S.buffer = null;
          S.originalBuffer = null;
          S.peakPyramid = null;
          S.previewBuf = null;
          els.waveEmpty.classList.remove('hidden');
          if (els.sourceMeta) els.sourceMeta.textContent = '';
        }
      } else {
        S.buffer = null;
        S.originalBuffer = null;
        S.peakPyramid = null;
        S.previewBuf = null;
        takeCounter = 0;
        recordHistoryIndex = -1;
        els.waveEmpty.classList.remove('hidden');
        if (els.sourceMeta) els.sourceMeta.textContent = '';
      }

      setDry(false, false);
      rebuildFxPanel();
      renderPresets();
      updateChainBar();
      updateUndoButtons();
      updateRecordHistoryUI();
      updateTransportEnabled();
      updateTimeChip();
      syncGainSlidersUI();
      resizeWave();
      drawWave();
      schedulePersist();

      const projDisplayName = meta.name || projectDoc.name || 'Project';
      const takesNote = recordHistory.length ? (' (' + recordHistory.length + ' take' + (recordHistory.length === 1 ? '' : 's') + ')') : '';
      toast('Restored ' + projDisplayName + takesNote, 'ok');
    }

    async function exportProjectFile(name) {
      try {
        const snap = await createProjectSnapshot(name);
        const fileName = (snap.name.replace(/[\\/:*?"<>|]/g, '_').slice(0, 50) || 'voxclip-project') + '.voxproject';
        const blob = new Blob([JSON.stringify(snap, null, 2)], { type: 'application/json' });
        downloadBlob(blob, fileName);
        toast('Exported project: ' + snap.name, 'ok');
        return true;
      } catch (e) {
        console.error(e);
        toast('Failed to export project: ' + e.message, 'error');
        return false;
      }
    }

    async function saveCurrentProjectToBrowser(name) {
      try {
        const snap = await createProjectSnapshot(name);
        await saveProjectToDb(snap);
        toast('Saved project to browser library: ' + snap.name, 'ok');
        await renderSavedProjectsList();
        return true;
      } catch (e) {
        console.error(e);
        toast('Failed to save to browser: ' + e.message, 'error');
        return false;
      }
    }

    async function renderSavedProjectsList() {
      if (!els.savedProjectsList) return;
      try {
        const list = await listProjectsFromDb();
        els.savedProjectsList.replaceChildren();
        if (!list || list.length === 0) {
          if (els.savedProjectsEmpty) els.savedProjectsEmpty.hidden = false;
          return;
        }
        if (els.savedProjectsEmpty) els.savedProjectsEmpty.hidden = true;

        for (const p of list) {
          const card = document.createElement('div');
          card.className = 'saved-project-card';

          const head = document.createElement('div');
          head.className = 'saved-project-header';
          const title = document.createElement('span');
          title.className = 'saved-project-title';
          title.textContent = p.name || 'Untitled Project';
          head.appendChild(title);

          const meta = document.createElement('div');
          meta.className = 'saved-project-meta';
          const time = document.createElement('span');
          const d = new Date(p.updatedAt || p.createdAt || Date.now());
          time.textContent = d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
          const takes = document.createElement('span');
          const tCount = (p.audio && p.audio.takes) ? p.audio.takes.length : (p.metadata ? p.metadata.totalTakes : 0);
          takes.textContent = (tCount || 0) + (tCount === 1 ? ' take' : ' takes');
          const dur = document.createElement('span');
          const dSec = (p.audio && p.audio.duration) || (p.metadata && p.metadata.duration) || 0;
          dur.textContent = fmtTime(dSec, false);
          meta.append(time, document.createTextNode(' · '), takes, document.createTextNode(' · '), dur);

          const actions = document.createElement('div');
          actions.className = 'saved-project-actions';

          const btnLoad = document.createElement('button');
          btnLoad.type = 'button';
          btnLoad.className = 'btn-primary btn-xs';
          btnLoad.textContent = 'Load';
          btnLoad.onclick = async () => {
            hideModal(els.projectModal);
            await restoreProjectFromData(p);
          };

          const btnExport = document.createElement('button');
          btnExport.type = 'button';
          btnExport.className = 'btn-xs';
          btnExport.textContent = '⬇ Export';
          btnExport.onclick = () => {
            const fileName = (p.name.replace(/[\\/:*?"<>|]/g, '_').slice(0, 50) || 'voxclip-project') + '.voxproject';
            const blob = new Blob([JSON.stringify(p, null, 2)], { type: 'application/json' });
            downloadBlob(blob, fileName);
            toast('Exported ' + p.name, 'ok');
          };

          const btnDel = document.createElement('button');
          btnDel.type = 'button';
          btnDel.className = 'btn-danger btn-xs';
          btnDel.textContent = '🗑 Delete';
          btnDel.onclick = async () => {
            const ok = await studioConfirm('Delete project “' + p.name + '” from this browser?', { title: 'Delete Project', confirmText: 'Delete', danger: true });
            if (!ok) return;
            await deleteProjectFromDb(p.id);
            toast('Deleted ' + p.name, 'ok');
            renderSavedProjectsList();
          };

          actions.append(btnLoad, btnExport, btnDel);
          card.append(head, meta, actions);
          els.savedProjectsList.appendChild(card);
        }
      } catch (e) {
        console.warn('Failed to render projects list:', e);
      }
    }

    function openProjectModal(tab = 'save') {
      if (tab === 'restore') {
        if (els.tabProjectSave) {
          els.tabProjectSave.classList.remove('active');
          els.tabProjectSave.setAttribute('aria-selected', 'false');
        }
        if (els.tabProjectRestore) {
          els.tabProjectRestore.classList.add('active');
          els.tabProjectRestore.setAttribute('aria-selected', 'true');
        }
        if (els.panelProjectSave) els.panelProjectSave.hidden = true;
        if (els.panelProjectRestore) els.panelProjectRestore.hidden = false;
        renderSavedProjectsList();
      } else {
        if (els.tabProjectRestore) {
          els.tabProjectRestore.classList.remove('active');
          els.tabProjectRestore.setAttribute('aria-selected', 'false');
        }
        if (els.tabProjectSave) {
          els.tabProjectSave.classList.add('active');
          els.tabProjectSave.setAttribute('aria-selected', 'true');
        }
        if (els.panelProjectRestore) els.panelProjectRestore.hidden = true;
        if (els.panelProjectSave) els.panelProjectSave.hidden = false;

        const defaultName = S.sourceName ? (S.sourceName.startsWith('Take') || S.sourceName.startsWith('Recording') ? ('Project ' + S.sourceName) : S.sourceName) : ('My Voice Project ' + new Date().toISOString().slice(0, 10));
        if (els.projectNameInput) {
          els.projectNameInput.value = defaultName;
          setTimeout(() => {
            els.projectNameInput.focus();
            els.projectNameInput.select();
          }, 50);
        }
        if (els.projectSaveSummary) {
          const takesCount = recordHistory.length;
          const durStr = S.buffer ? fmtTime(S.buffer.duration, false) : '0:00';
          const chainNames = getPresetChainItems(S.presetChain).map((c) => c.fullName).join(' → ') || 'No preset chain';
          els.projectSaveSummary.innerHTML = `<strong>Current Project Snapshot:</strong><br />` +
            `• Audio: ${S.buffer ? (takesCount + ' take' + (takesCount === 1 ? '' : 's') + ' (' + durStr + ')') : 'No audio loaded'}<br />` +
            `• Preset Chain: ${escapeHtml(chainNames)}<br />` +
            `• Custom Voices: ${S.customSettings.length} preset${S.customSettings.length === 1 ? '' : 's'}`;
        }
      }
      showModal(els.projectModal);
    }

    /* =========================================================
       Modals
       ========================================================= */
    let modalOpener = null;
    function modalFocusables(el) {
      return Array.from(el.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'))
        .filter((n) => !n.disabled && n.offsetParent !== null);
    }
    function showModal(el) {
      modalOpener = document.activeElement;
      el.hidden = false;
      el.classList.add('show');
      const list = modalFocusables(el);
      if (list[0]) setTimeout(() => list[0].focus(), 30);
    }
    function hideModal(el) {
      el.classList.remove('show');
      el.hidden = true;
      if (modalOpener && typeof modalOpener.focus === 'function') {
        try { modalOpener.focus(); } catch (_) {}
      }
    }
    function trapModalKey(e, el) {
      if (e.key !== 'Tab') return;
      const list = modalFocusables(el);
      if (!list.length) return;
      const first = list[0];
      const last = list[list.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }

    function studioConfirm(desc, { title = 'Confirm', confirmText = 'Confirm', cancelText = 'Cancel', danger = false } = {}) {
      return new Promise((resolve) => {
        if (!els.dialogModal || !els.dialogConfirm || !els.dialogCancel) {
          resolve(window.confirm(desc));
          return;
        }
        if (els.dialogTitle) els.dialogTitle.textContent = title;
        if (els.dialogDesc) els.dialogDesc.textContent = desc;
        if (els.dialogInputGroup) els.dialogInputGroup.hidden = true;
        els.dialogConfirm.textContent = confirmText;
        els.dialogCancel.textContent = cancelText;
        els.dialogConfirm.className = danger ? 'btn-danger' : 'btn-primary';

        const onConfirm = () => { cleanup(); resolve(true); };
        const onCancel = () => { cleanup(); resolve(false); };
        const onDialogKey = (e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            onCancel();
          } else if (e.key === 'Enter') {
            e.preventDefault();
            onConfirm();
          }
        };
        const cleanup = () => {
          els.dialogConfirm.removeEventListener('click', onConfirm);
          els.dialogCancel.removeEventListener('click', onCancel);
          window.removeEventListener('keydown', onDialogKey, true);
          hideModal(els.dialogModal);
        };

        els.dialogConfirm.addEventListener('click', onConfirm);
        els.dialogCancel.addEventListener('click', onCancel);
        window.addEventListener('keydown', onDialogKey, true);
        showModal(els.dialogModal);
      });
    }

    function studioPrompt(desc, defaultValue = '', { title = 'Enter Value', label = 'Value', confirmText = 'Save', cancelText = 'Cancel' } = {}) {
      return new Promise((resolve) => {
        if (!els.dialogModal || !els.dialogConfirm || !els.dialogCancel || !els.dialogInput) {
          resolve(window.prompt(desc, defaultValue));
          return;
        }
        if (els.dialogTitle) els.dialogTitle.textContent = title;
        if (els.dialogDesc) els.dialogDesc.textContent = desc;
        if (els.dialogInputGroup) els.dialogInputGroup.hidden = false;
        if (els.dialogInputLabel) els.dialogInputLabel.textContent = label;
        els.dialogInput.value = defaultValue || '';
        els.dialogConfirm.textContent = confirmText;
        els.dialogCancel.textContent = cancelText;
        els.dialogConfirm.className = 'btn-primary';

        const onConfirm = () => {
          const val = els.dialogInput.value;
          cleanup();
          resolve(val);
        };
        const onCancel = () => { cleanup(); resolve(null); };
        const onInputKey = (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            onConfirm();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            onCancel();
          }
        };
        const cleanup = () => {
          els.dialogConfirm.removeEventListener('click', onConfirm);
          els.dialogCancel.removeEventListener('click', onCancel);
          els.dialogInput.removeEventListener('keydown', onInputKey);
          hideModal(els.dialogModal);
        };

        els.dialogConfirm.addEventListener('click', onConfirm);
        els.dialogCancel.addEventListener('click', onCancel);
        els.dialogInput.addEventListener('keydown', onInputKey);
        showModal(els.dialogModal);
        setTimeout(() => {
          els.dialogInput.focus();
          els.dialogInput.select();
        }, 50);
      });
    }

    /* =========================================================
       Long-press skip
       ========================================================= */
    function bindRepeat(btn, action) {
      const start = (e) => {
        if (btn.disabled) return;
        e.preventDefault();
        action();
        let delay = 200;
        let started = Date.now();
        const tick = () => {
          action();
          if (Date.now() - started > 1500) delay = 80;
          longPressAccel = setTimeout(tick, delay);
        };
        longPressTimer = setTimeout(tick, 400);
      };
      const end = () => {
        clearTimeout(longPressTimer);
        clearTimeout(longPressAccel);
      };
      btn.addEventListener('pointerdown', start);
      btn.addEventListener('pointerup', end);
      btn.addEventListener('pointerleave', end);
      btn.addEventListener('pointercancel', end);
    }

    /* =========================================================
       Keyboard
       ========================================================= */
    function onKey(e) {
      const modalOpen = [els.saveModal, els.settingsModal, els.moreSkipModal, els.resetAudioModal, els.deleteRecordModal, els.resetProjectModal, els.packModal, els.projectModal, els.liveMonitorModal, els.batchExportModal, els.dialogModal]
        .filter(Boolean)
        .find((m) => m.classList.contains('show'));
      if (modalOpen) {
        if (e.key === 'Escape') {
          hideModal(modalOpen);
        } else {
          trapModalKey(e, modalOpen);
        }
        return;
      }
      if (isTypingTarget(e.target)) return;
      const tag = (e.target && e.target.tagName || '').toLowerCase();
      const activatable = tag === 'button' || tag === 'a' || (e.target && e.target.getAttribute && e.target.getAttribute('role') === 'button');
      if (e.defaultPrevented) return;
      const k = e.key;
      if ((e.ctrlKey || e.metaKey) && !e.altKey && (k === 's' || k === 'S')) {
        e.preventDefault();
        openProjectModal('save');
        return;
      }
      if ((e.ctrlKey || e.metaKey) && !e.altKey && (k === 'o' || k === 'O')) {
        e.preventDefault();
        openProjectModal('restore');
        return;
      }
      if ((e.ctrlKey || e.metaKey) && !e.altKey && (k === 'z' || k === 'Z')) {
        e.preventDefault();
        if (e.shiftKey) redoFx();
        else undoFx();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && (k === 'y' || k === 'Y')) {
        e.preventDefault();
        redoFx();
        return;
      }
      if (e.altKey && !e.ctrlKey && !e.metaKey && (k === 'z' || k === 'Z')) {
        e.preventDefault();
        if (e.shiftKey) redoRecording();
        else undoRecording();
        return;
      }
      if (e.altKey && !e.ctrlKey && !e.metaKey && (k === 'y' || k === 'Y')) {
        e.preventDefault();
        redoRecording();
        return;
      }
      if (k === 'm' || k === 'M') {
        e.preventDefault();
        addCueMarker();
        return;
      }
      if (k === '[') {
        e.preventDefault();
        setInPoint();
        return;
      }
      if (k === ']') {
        e.preventDefault();
        setOutPoint();
        return;
      }
      if (k === 'Escape' && S.selection && S.selection.active) {
        e.preventDefault();
        clearSelection();
        return;
      }
      if ((k === 'Delete' || k === 'Backspace') && S.selection && S.selection.active) {
        e.preventDefault();
        applyCutSelection();
        return;
      }
      if (/^[1-9]$/.test(k)) {
        const markerIdx = parseInt(k, 10) - 1;
        if (S.cueMarkers && S.cueMarkers[markerIdx]) {
          e.preventDefault();
          seekToCueMarker(markerIdx);
          return;
        }
      }
      if (k === ' ' || k === 'Spacebar') {
        if (activatable) return;
        e.preventDefault();
        togglePlay();
      } else if (k === 'ArrowLeft' || k === 'j' || k === 'J') {
        e.preventDefault();
        skip(e.shiftKey ? -10 : -skipInterval());
      } else if (k === 'ArrowRight' || k === 'l' || k === 'L') {
        e.preventDefault();
        skip(e.shiftKey ? 10 : skipInterval());
      } else if (k === ',' && S.videoMeta) {
        e.preventDefault();
        frameStep(-1);
      } else if (k === '.' && S.videoMeta) {
        e.preventDefault();
        frameStep(1);
      } else if (k === 'Home' || k === '0') {
        e.preventDefault();
        skip(-1e9);
      } else if (k === 'End') {
        e.preventDefault();
        skip(1e9);
      }
    }

    /* =========================================================
       Network / PWA
       ========================================================= */
    function updateOnline() {
      const on = navigator.onLine;
      els.netPill.classList.toggle('online', on);
      els.netPill.classList.toggle('offline', !on);
      els.netPillText.textContent = on ? 'Online' : 'Offline';
    }

    function registerSW() {
      if (!('serviceWorker' in navigator)) return;
      navigator.serviceWorker.register('./sw.js').then((reg) => {
        if (reg.waiting && navigator.serviceWorker.controller) {
          toast('New version ready — refresh to update.');
        }
        reg.addEventListener('updatefound', () => {
          const nw = reg.installing;
          if (!nw) return;
          nw.addEventListener('statechange', () => {
            if (nw.state === 'installed' && navigator.serviceWorker.controller) {
              toast('New version ready — refresh to update.');
            }
          });
        });
      }).catch(() => {});
    }

    /* =========================================================
       Wire events
       ========================================================= */
    function wire() {
      els.btnRecord.addEventListener('click', toggleRecord);
      if (els.btnUndoRecord) els.btnUndoRecord.addEventListener('click', undoRecording);
      if (els.btnRedoRecord) els.btnRedoRecord.addEventListener('click', redoRecording);
      if (els.recModeStandalone) {
        els.recModeStandalone.addEventListener('change', (e) => {
          if (e.target.checked) {
            S.recMode = 'standalone';
            S.ui = S.ui || {};
            S.ui.recMode = S.recMode;
            schedulePersist();
          }
        });
      }
      if (els.recModeAppend) {
        els.recModeAppend.addEventListener('change', (e) => {
          if (e.target.checked) {
            S.recMode = 'append';
            S.ui = S.ui || {};
            S.ui.recMode = S.recMode;
            schedulePersist();
          }
        });
      }
      els.btnUpload.addEventListener('click', () => els.fileInput.click());
      els.fileInput.addEventListener('change', () => {
        const f = els.fileInput.files && els.fileInput.files[0];
        els.fileInput.value = '';
        if (f) loadFile(f);
      });

      // Mic level (capture) + Input gain (playback chain before FX gain)
      const onMicLevel = () => {
        S.micLevel = clampNum(parseFloat(els.micLevel.value), 1, 12, defaultMicLevel());
        els.micLevelVal.textContent = formatGainX(S.micLevel);
        if (recordGainNode && S.recording) {
          recordGainNode.gain.value = Math.max(1, S.micLevel);
        }
        schedulePersist();
      };
      let inputGainGesture = false;
      const onInputGain = () => {
        S.inputGain = clampNum(parseFloat(els.inputGain.value), 0.5, 9, defaultInputGain());
        els.inputGainVal.textContent = formatGainX(S.inputGain);
        const labIn = document.getElementById('fx_inputGain');
        const labVal = document.querySelector('[data-val="inputGain"]');
        if (labIn) labIn.value = String(S.inputGain);
        if (labVal) labVal.textContent = formatFxVal('inputGain', S.inputGain, '×');
        schedulePersist();
        updateTransportEnabled();
        if (S.playing) startPlayback();
      };
      els.micLevel.addEventListener('input', onMicLevel);
      els.micLevel.addEventListener('change', onMicLevel);
      els.inputGain.addEventListener('pointerdown', () => {
        if (!inputGainGesture) { pushHistory(); inputGainGesture = true; }
      });
      els.inputGain.addEventListener('pointerup', () => { inputGainGesture = false; });
      els.inputGain.addEventListener('input', onInputGain);
      els.inputGain.addEventListener('change', onInputGain);

      els.btnUndo.addEventListener('click', undoFx);
      els.btnRedo.addEventListener('click', redoFx);
      els.btnClearChain.addEventListener('click', () => clearPresetChain(false));
      if (els.chainBar) {
        els.chainBar.addEventListener('click', (e) => {
          if (e.target.closest('.chain-mix')) return;
          const btn = e.target.closest('.chain-step');
          if (!btn) return;
          const idx = parseInt(btn.dataset.chainIndex, 10);
          if (!isNaN(idx)) {
            removeFromChainByIndex(idx);
          }
        });
      }

      // Drop zone
      const dz = els.dropzone;
      dz.addEventListener('click', () => els.fileInput.click());
      dz.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); els.fileInput.click(); }
      });
      ['dragenter', 'dragover'].forEach((ev) => {
        dz.addEventListener(ev, (e) => {
          e.preventDefault();
          e.stopPropagation();
          dz.classList.add('dragover');
        });
      });
      ['dragleave', 'drop'].forEach((ev) => {
        dz.addEventListener(ev, (e) => {
          e.preventDefault();
          e.stopPropagation();
          dz.classList.remove('dragover');
        });
      });
      dz.addEventListener('drop', (e) => {
        const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
        if (!f) return;
        const ok = /(\.|\/)(wav|mp3|aac|m4a|ogg|flac|webm|caf|aiff|aif|mp4|mov|m4v|3gp|3g2)$/i.test(f.name) ||
          (f.type && (f.type.startsWith('audio/') || f.type.startsWith('video/')));
        if (!ok) {
          toast("Couldn't read this file. Try a different format.", 'error');
          return;
        }
        loadFile(f);
      });

      els.btnPlay.addEventListener('click', togglePlay);
      els.btnStop.addEventListener('click', () => stopPlayback(true));
      els.btnLoop.addEventListener('click', () => {
        S.loop = !S.loop;
        els.btnLoop.classList.toggle('active-loop', S.loop);
        els.btnLoop.setAttribute('aria-pressed', String(S.loop));
        schedulePersist();
      });
      bindRepeat(els.btnSkipN5, () => skip(-skipInterval()));
      bindRepeat(els.btnSkipP5, () => skip(skipInterval()));
      bindRepeat(els.btnSkipN10, () => skip(-10));
      bindRepeat(els.btnSkipP10, () => skip(10));
      bindRepeat(els.btnFramePrev, () => frameStep(-1));
      bindRepeat(els.btnFrameNext, () => frameStep(1));
      els.btnMoreSkip.addEventListener('click', () => showModal(els.moreSkipModal));
      els.moreSkipClose.addEventListener('click', () => hideModal(els.moreSkipModal));
      els.btnSkipN10m.addEventListener('click', () => { skip(-10); hideModal(els.moreSkipModal); });
      els.btnSkipP10m.addEventListener('click', () => { skip(10); hideModal(els.moreSkipModal); });

      els.btnApplyFx.addEventListener('click', applyFxBake);
      els.btnResetFx.addEventListener('click', resetFx);
      if (els.btnAB) {
        els.btnAB.addEventListener('click', () => {
          if (!S.buffer || S.baking) return;
          setDry(!S.comparingDry, true);
        });
      }
      if (els.btnMatchLoudness) els.btnMatchLoudness.addEventListener('click', matchLoudness);
      if (els.btnZoomIn) els.btnZoomIn.addEventListener('click', () => setWaveZoom((S.waveZoom || 1) * 2, S.buffer ? S.playhead / S.buffer.duration : 0.5));
      if (els.btnZoomOut) els.btnZoomOut.addEventListener('click', () => setWaveZoom((S.waveZoom || 1) / 2, S.buffer ? S.playhead / S.buffer.duration : 0.5));
      if (els.btnZoomReset) els.btnZoomReset.addEventListener('click', () => setWaveZoom(1, 0));
      if (els.presetSearch) {
        els.presetSearch.addEventListener('input', () => {
          S.ui = S.ui || {};
          S.ui.presetSearch = els.presetSearch.value.slice(0, 40);
          renderPresets();
          schedulePersist();
        });
      }
      els.btnResetAudio.addEventListener('click', () => {
        if (!S.buffer && !S.originalBuffer) {
          toast('No audio to reset');
          return;
        }
        showModal(els.resetAudioModal);
      });
      els.resetAudioCancel.addEventListener('click', () => hideModal(els.resetAudioModal));
      els.resetAudioConfirm.addEventListener('click', () => {
        hideModal(els.resetAudioModal);
        resetAudio();
      });

      if (els.btnDeleteRecord) {
        els.btnDeleteRecord.addEventListener('click', () => {
          if (recordHistoryIndex < 0 || !recordHistory.length) {
            toast('No recording to delete');
            return;
          }
          const cur = recordHistory[recordHistoryIndex];
          const name = cur ? cur.name : ('Take ' + (recordHistoryIndex + 1));
          if (els.deleteRecordDesc) {
            els.deleteRecordDesc.textContent = 'Permanently delete "' + name + '"? It will be removed forever and cannot be restored from the undo/redo buffer.';
          }
          showModal(els.deleteRecordModal);
        });
      }
      if (els.deleteRecordCancel) els.deleteRecordCancel.addEventListener('click', () => hideModal(els.deleteRecordModal));
      if (els.deleteRecordConfirm) {
        els.deleteRecordConfirm.addEventListener('click', () => {
          hideModal(els.deleteRecordModal);
          deleteCurrentRecord();
        });
      }

      els.tabBuiltIn.addEventListener('click', () => setPresetTab('built-in'));
      els.tabCustom.addEventListener('click', () => setPresetTab('custom'));
      els.btnSaveSettings.addEventListener('click', openSaveModal);
      els.saveCancel.addEventListener('click', () => hideModal(els.saveModal));
      els.saveConfirm.addEventListener('click', () => saveCustomFromModal(false));
      els.saveOverwrite.addEventListener('click', () => saveCustomFromModal(true));
      els.saveName.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') saveCustomFromModal(false);
      });

      els.btnExportPrimary.addEventListener('click', () => exportAudio(els.btnExportPrimary.dataset.format || 'wav'));
      els.btnExportSecondary.addEventListener('click', () => exportAudio(els.btnExportSecondary.dataset.format || 'mp3'));
      if (els.btnExportWav24) els.btnExportWav24.addEventListener('click', () => exportAudio('wav24'));
      if (els.btnExportOpus) els.btnExportOpus.addEventListener('click', () => exportAudio('opus'));
      if (els.btnBatchExport) els.btnBatchExport.addEventListener('click', openBatchExportModal);
      if (els.btnBatchSelectAll) els.btnBatchSelectAll.addEventListener('click', () => setAllBatchCheckboxes(true));
      if (els.btnBatchDeselectAll) els.btnBatchDeselectAll.addEventListener('click', () => setAllBatchCheckboxes(false));
      if (els.batchExportCancel) els.batchExportCancel.addEventListener('click', () => hideModal(els.batchExportModal));
      if (els.batchExportStart) els.batchExportStart.addEventListener('click', runBatchExport);

      if (els.lufsTargetSelect) {
        els.lufsTargetSelect.addEventListener('change', () => {
          S.lufsTarget = els.lufsTargetSelect.value;
          S.ui = S.ui || {};
          S.ui.lufsTarget = S.lufsTarget;
          schedulePersist();
          if (S.buffer) updateLufsReadout(S.previewBuf || S.buffer);
        });
      }

      // Live Monitor
      if (els.btnLiveMonitor) els.btnLiveMonitor.addEventListener('click', toggleLiveMonitor);
      if (els.liveMonitorCancel) els.liveMonitorCancel.addEventListener('click', () => hideModal(els.liveMonitorModal));
      if (els.liveMonitorConfirm) {
        els.liveMonitorConfirm.addEventListener('click', () => {
          hideModal(els.liveMonitorModal);
          if (els.chkSkipMonitorWarn && els.chkSkipMonitorWarn.checked) S.skipMonitorWarn = true;
          startLiveMonitor();
        });
      }

      // Vocal Cleanup Strip
      if (els.gateThreshold) {
        const onGate = () => {
          S.fx.gateThreshold = parseFloat(els.gateThreshold.value);
          if (els.gateThresholdVal) els.gateThresholdVal.textContent = S.fx.gateThreshold + ' dB';
          onFxEdited(false);
        };
        els.gateThreshold.addEventListener('input', onGate);
        els.gateThreshold.addEventListener('change', onGate);
      }
      if (els.btnAutoCalibrateGate) els.btnAutoCalibrateGate.addEventListener('click', autoCalibrateGate);
      if (els.deEssAmount) {
        const onDeEss = () => {
          S.fx.deEssAmount = parseFloat(els.deEssAmount.value);
          if (els.deEssAmountVal) els.deEssAmountVal.textContent = Math.round(S.fx.deEssAmount * 100) + '%';
          onFxEdited(false);
        };
        els.deEssAmount.addEventListener('input', onDeEss);
        els.deEssAmount.addEventListener('change', onDeEss);
      }
      if (els.humNotchSelect) {
        els.humNotchSelect.addEventListener('change', () => {
          S.fx.humNotch = parseInt(els.humNotchSelect.value, 10) || 0;
          onFxEdited(false);
        });
      }

      // Demo Voice Speech Loader
      if (els.btnLoadDemoVoice && els.demoVoiceSelect) {
        els.btnLoadDemoVoice.addEventListener('click', () => {
          loadDemoVoice(els.demoVoiceSelect.value);
        });
      }

      // Background Ambience & Soundscape Mixer
      if (els.ambiencePresetSelect) {
        els.ambiencePresetSelect.addEventListener('change', () => {
          pushHistory();
          S.fx.ambiencePreset = els.ambiencePresetSelect.value;
          if (S.fx.ambiencePreset !== 'none' && (S.fx.ambienceMix || 0) < 0.05) {
            S.fx.ambienceMix = 0.25;
          }
          syncAmbienceUI();
          onFxEdited(false);
        });
      }
      if (els.ambienceQuickChips) {
        els.ambienceQuickChips.addEventListener('click', (e) => {
          const chip = e.target.closest('.ambience-chip-btn');
          if (!chip) return;
          pushHistory();
          const scene = chip.dataset.scene || 'none';
          S.fx.ambiencePreset = scene;
          if (scene !== 'none' && (S.fx.ambienceMix || 0) < 0.05) {
            S.fx.ambienceMix = 0.25;
          }
          syncAmbienceUI();
          onFxEdited(false);
        });
      }
      if (els.ambienceMix) {
        const onAmbMix = () => {
          S.fx.ambienceMix = parseFloat(els.ambienceMix.value);
          if (els.ambienceMixVal) els.ambienceMixVal.textContent = Math.round(S.fx.ambienceMix * 100) + '%';
          onFxEdited(false);
        };
        els.ambienceMix.addEventListener('input', onAmbMix);
        els.ambienceMix.addEventListener('change', onAmbMix);
      }
      if (els.ambienceDuck) {
        const onAmbDuck = () => {
          S.fx.ambienceDuck = parseFloat(els.ambienceDuck.value);
          if (els.ambienceDuckVal) els.ambienceDuckVal.textContent = Math.round(S.fx.ambienceDuck * 100) + '%';
          onFxEdited(false);
        };
        els.ambienceDuck.addEventListener('input', onAmbDuck);
        els.ambienceDuck.addEventListener('change', onAmbDuck);
      }
      if (els.ambienceTone) {
        const onAmbTone = () => {
          S.fx.ambienceTone = parseFloat(els.ambienceTone.value);
          if (els.ambienceToneVal) {
            const sign = S.fx.ambienceTone > 0 ? '+' : '';
            els.ambienceToneVal.textContent = sign + S.fx.ambienceTone.toFixed(1) + ' dB';
          }
          onFxEdited(false);
        };
        els.ambienceTone.addEventListener('input', onAmbTone);
        els.ambienceTone.addEventListener('change', onAmbTone);
      }
      if (els.btnClearAmbience) {
        els.btnClearAmbience.addEventListener('click', () => {
          pushHistory();
          S.fx.ambiencePreset = 'none';
          S.fx.ambienceMix = 0;
          syncAmbienceUI();
          onFxEdited(false);
          toast('Background soundscape muted');
        });
      }

      // Visualizer Dock Tabs
      if (els.visTabWave) els.visTabWave.addEventListener('click', () => setVisMode('waveform'));
      if (els.visTabSpectrum) els.visTabSpectrum.addEventListener('click', () => setVisMode('spectrum'));
      if (els.visTabSpectrogram) els.visTabSpectrogram.addEventListener('click', () => setVisMode('spectrogram'));

      // Cue Markers
      if (els.btnAddMarker) els.btnAddMarker.addEventListener('click', () => addCueMarker());
      if (els.btnClearMarkers) els.btnClearMarkers.addEventListener('click', clearCueMarkers);

      // Macro XY Pad
      if (els.xyAxisMode) {
        els.xyAxisMode.addEventListener('change', () => {
          S.xyAxisMode = els.xyAxisMode.value;
          S.ui = S.ui || {};
          S.ui.xyAxisMode = S.xyAxisMode;
          updateXyLabels();
          drawXyPad();
          schedulePersist();
        });
      }
      if (els.xyPadCanvas) {
        const pad = els.xyPadCanvas;
        let dragging = false;
        pad.addEventListener('pointerdown', (e) => {
          dragging = true;
          try { pad.setPointerCapture(e.pointerId); } catch (_) {}
          pushHistory();
          handleXyPointer(e);
        });
        pad.addEventListener('pointermove', (e) => {
          if (!dragging) return;
          handleXyPointer(e);
        });
        const endPad = (e) => {
          if (dragging) {
            dragging = false;
            try { pad.releasePointerCapture(e.pointerId); } catch (_) {}
            schedulePersist();
            if (S.playing) startPlayback();
          }
        };
        pad.addEventListener('pointerup', endPad);
        pad.addEventListener('pointercancel', endPad);
      }

      if (els.btnShare) els.btnShare.addEventListener('click', shareLastExport);
      els.btnResetProject.addEventListener('click', () => {
        showModal(els.resetProjectModal);
      });
      els.resetProjectCancel.addEventListener('click', () => hideModal(els.resetProjectModal));
      els.resetProjectConfirm.addEventListener('click', () => {
        hideModal(els.resetProjectModal);
        resetProject();
      });

      els.btnSettings.addEventListener('click', () => {
        els.skipInterval.value = String(S.skipIntervalSec);
        els.exportPref.value = S.lastExportFormat;
        if (els.fxSourceMode) els.fxSourceMode.value = S.ui.fxSourceMode || 'local';
        if (els.fxRemoteUrl) els.fxRemoteUrl.value = S.ui.fxRemoteUrl || '';
        if (els.fxRemoteUrlGroup) els.fxRemoteUrlGroup.hidden = (S.ui.fxSourceMode !== 'github');
        showModal(els.settingsModal);
      });
      els.settingsClose.addEventListener('click', () => hideModal(els.settingsModal));
      els.skipInterval.addEventListener('change', () => {
        S.skipIntervalSec = parseInt(els.skipInterval.value, 10) || 5;
        updateSkipLabels();
        schedulePersist();
      });
      if (els.btnEcoToggle) {
        els.btnEcoToggle.addEventListener('click', toggleEcoModeSetting);
      }
      if (els.ecoModeSelect) {
        els.ecoModeSelect.addEventListener('change', () => {
          S.ui = S.ui || {};
          S.ui.ecoMode = ['auto', 'on', 'off'].includes(els.ecoModeSelect.value) ? els.ecoModeSelect.value : 'auto';
          applyEcoModeState();
          schedulePersist();
        });
      }
      els.exportPref.addEventListener('change', () => {
        S.lastExportFormat = els.exportPref.value === 'mp3' ? 'mp3' : 'wav';
        updateExportButtons();
        schedulePersist();
      });
      if (els.maxRecordSec) {
        els.maxRecordSec.addEventListener('change', () => {
          S.ui = S.ui || {};
          S.ui.maxRecordSec = [60, 180, 300, 600].includes(Number(els.maxRecordSec.value)) ? Number(els.maxRecordSec.value) : 180;
          schedulePersist();
        });
      }
      if (els.fxSourceMode) {
        els.fxSourceMode.addEventListener('change', () => {
          S.ui.fxSourceMode = els.fxSourceMode.value;
          if (els.fxRemoteUrlGroup) els.fxRemoteUrlGroup.hidden = (S.ui.fxSourceMode !== 'github');
          schedulePersist();
        });
      }
      if (els.fxRemoteUrl) {
        els.fxRemoteUrl.addEventListener('input', () => {
          S.ui.fxRemoteUrl = els.fxRemoteUrl.value;
          schedulePersist();
        });
      }
      if (els.btnReloadFx) {
        els.btnReloadFx.addEventListener('click', () => {
          loadFxPresetsData(false);
        });
      }
      els.btnExportCustoms.addEventListener('click', () => {
        const pack = {
          version: 3,
          kind: 'voxclip.custom-pack',
          customSettings: S.customSettings
        };
        const blob = new Blob([JSON.stringify(pack, null, 2)], { type: 'application/json' });
        downloadBlob(blob, 'voxclip-custom-pack.json');
        toast('Exported custom pack', 'ok');
      });
      els.btnImportCustoms.addEventListener('click', () => els.importCustomsInput.click());
      els.importCustomsInput.addEventListener('change', async () => {
        const f = els.importCustomsInput.files && els.importCustomsInput.files[0];
        els.importCustomsInput.value = '';
        if (!f) return;
        try {
          const data = JSON.parse(await f.text());
          const list = Array.isArray(data) ? data : data.customSettings;
          if (!Array.isArray(list)) throw new Error('bad');
          const incoming = list.slice(0, MAX_CUSTOMS).map((c) => ({
            id: String(c.id || uid()),
            name: String(c.name || 'Imported').slice(0, 40),
            fx: mergeFx(c.fx),
            presetChain: sanitizePresetChain(
              Array.isArray(c.presetChain) ? c.presetChain : (c.presetId ? [c.presetId] : [])
            ),
            presetChainMix: sanitizeChainMix(c.presetChainMix, Array.isArray(c.presetChain) ? c.presetChain.length : 0),
            createdAt: Number(c.createdAt) || Date.now(),
            updatedAt: Number(c.updatedAt) || Date.now(),
            emoji: c.emoji || '⭐'
          }));
          const conflicts = incoming.filter((c) =>
            S.customSettings.some((x) => x.id === c.id || x.name.toLowerCase() === c.name.toLowerCase())
          );
          if (!conflicts.length) {
            for (const c of incoming) {
              if (S.customSettings.length >= MAX_CUSTOMS) break;
              S.customSettings.push(c);
            }
            renderPresets();
            schedulePersist();
            toast('Imported custom settings', 'ok');
            return;
          }
          pendingPack = incoming;
          renderPackConflicts(incoming);
          showModal(els.packModal);
        } catch (_) {
          toast('Invalid settings file.', 'error');
        }
      });
      if (els.packCancel) els.packCancel.addEventListener('click', () => { pendingPack = null; hideModal(els.packModal); });
      if (els.packApplyAllKeep) els.packApplyAllKeep.addEventListener('click', () => {
        if (els.packList) {
          els.packList.querySelectorAll('select[data-pack]').forEach((s) => { s.value = 'keep'; });
        }
      });
      if (els.packConfirm) els.packConfirm.addEventListener('click', () => applyPackImport());
      els.btnClearSaved.addEventListener('click', clearAllSaved);

      // Project Manager wiring
      if (els.btnProject) els.btnProject.addEventListener('click', () => openProjectModal('save'));
      if (els.btnSaveProject) els.btnSaveProject.addEventListener('click', () => openProjectModal('save'));
      if (els.btnRestoreProject) els.btnRestoreProject.addEventListener('click', () => openProjectModal('restore'));
      if (els.tabProjectSave) els.tabProjectSave.addEventListener('click', () => openProjectModal('save'));
      if (els.tabProjectRestore) els.tabProjectRestore.addEventListener('click', () => openProjectModal('restore'));
      if (els.btnExportProjectFile) {
        els.btnExportProjectFile.addEventListener('click', async () => {
          const name = els.projectNameInput ? els.projectNameInput.value : '';
          await exportProjectFile(name);
        });
      }
      if (els.btnSaveProjectDb) {
        els.btnSaveProjectDb.addEventListener('click', async () => {
          const name = els.projectNameInput ? els.projectNameInput.value : '';
          await saveCurrentProjectToBrowser(name);
        });
      }
      if (els.projectNameInput) {
        els.projectNameInput.addEventListener('keydown', async (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            await saveCurrentProjectToBrowser(els.projectNameInput.value);
          }
        });
      }
      if (els.btnOpenProjectFile) {
        els.btnOpenProjectFile.addEventListener('click', () => {
          if (els.projectFileInput) els.projectFileInput.click();
        });
      }
      if (els.projectFileInput) {
        els.projectFileInput.addEventListener('change', async () => {
          const f = els.projectFileInput.files && els.projectFileInput.files[0];
          els.projectFileInput.value = '';
          if (!f) return;
          hideModal(els.projectModal);
          await loadFile(f);
        });
      }
      if (els.projectModalClose) {
        els.projectModalClose.addEventListener('click', () => hideModal(els.projectModal));
      }

      els.labDetails.addEventListener('toggle', () => {
        S.advancedLabExpanded = els.labDetails.open;
        schedulePersist();
      });

      // Workspace Deck Tabs
      if (els.tabDeckPresets) els.tabDeckPresets.addEventListener('click', () => setWorkspaceTab('presets'));
      if (els.tabDeckXy) els.tabDeckXy.addEventListener('click', () => setWorkspaceTab('xy'));
      if (els.tabDeckLab) els.tabDeckLab.addEventListener('click', () => setWorkspaceTab('lab'));
      if (els.tabDeckExport) els.tabDeckExport.addEventListener('click', () => setWorkspaceTab('export'));
      if (els.tabDeckAll) els.tabDeckAll.addEventListener('click', () => setWorkspaceTab('all'));

      // 3-Step Interactive Workflow Guidance Stepper
      const activateStep = (stepNum) => {
        if (stepNum === 1) {
          if (els.cardSource) els.cardSource.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          highlightNextAction(els.btnRecord);
        } else if (stepNum === 2) {
          if (S.ui && S.ui.workspaceTab === 'export') {
            setWorkspaceTab('presets');
          }
          if (els.panelPresets) els.panelPresets.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          if (S.buffer && !S.playing) highlightNextAction(els.btnPlay);
        } else if (stepNum === 3) {
          setWorkspaceTab('export');
          if (els.panelExport) els.panelExport.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          highlightNextAction(els.btnExportPrimary);
        }
      };

      if (els.stepCapture) {
        els.stepCapture.addEventListener('click', () => activateStep(1));
        els.stepCapture.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activateStep(1); }
        });
      }
      if (els.stepTransform) {
        els.stepTransform.addEventListener('click', () => activateStep(2));
        els.stepTransform.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activateStep(2); }
        });
      }
      if (els.stepExport) {
        els.stepExport.addEventListener('click', () => activateStep(3));
        els.stepExport.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activateStep(3); }
        });
      }

      // Preset Category Quick Filter Bar
      if (els.catFilterBar) {
        els.catFilterBar.addEventListener('click', (e) => {
          const btn = e.target.closest('.cat-filter-btn');
          if (!btn) return;
          const cat = btn.dataset.cat || 'all';
          setPresetCatFilter(cat);
        });
      }

      // Trim & Cut Toolbar wiring
      if (els.btnWaveToolSeek) els.btnWaveToolSeek.addEventListener('click', () => setWaveTool('seek'));
      if (els.btnWaveToolSelect) els.btnWaveToolSelect.addEventListener('click', () => setWaveTool('select'));
      if (els.btnSetIn) els.btnSetIn.addEventListener('click', setInPoint);
      if (els.btnSetOut) els.btnSetOut.addEventListener('click', setOutPoint);
      if (els.btnPlaySelection) els.btnPlaySelection.addEventListener('click', () => playSelection(false));
      if (els.btnTrimKeep) els.btnTrimKeep.addEventListener('click', applyTrimSelection);
      if (els.btnCutDelete) els.btnCutDelete.addEventListener('click', applyCutSelection);
      if (els.btnTrimSilence) els.btnTrimSilence.addEventListener('click', applyTrimSilence);
      if (els.btnClearSelection) els.btnClearSelection.addEventListener('click', clearSelection);

      if (els.trimInInput) {
        els.trimInInput.addEventListener('change', () => {
          const val = parseTimeInput(els.trimInInput.value);
          if (val != null && S.buffer) {
            const inPt = Math.max(0, Math.min(S.buffer.duration, val));
            const outPt = S.selection.active ? Math.max(inPt + 0.05, S.selection.end) : S.buffer.duration;
            setSelection(inPt, outPt);
          } else {
            updateTrimUI();
          }
        });
        els.trimInInput.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') els.trimInInput.blur();
        });
      }

      if (els.trimOutInput) {
        els.trimOutInput.addEventListener('change', () => {
          const val = parseTimeInput(els.trimOutInput.value);
          if (val != null && S.buffer) {
            const outPt = Math.max(0, Math.min(S.buffer.duration, val));
            const inPt = S.selection.active ? Math.min(outPt - 0.05, S.selection.start) : 0;
            setSelection(inPt, outPt);
          } else {
            updateTrimUI();
          }
        });
        els.trimOutInput.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') els.trimOutInput.blur();
        });
      }

      // Waveform pointer events — seeking, region drag & boundary handle adjustments
      const wave = els.wave;
      let wavePointerState = {
        down: false,
        mode: 'seek',
        startX: 0,
        startTime: 0,
        initIn: 0,
        initOut: 0
      };

      const getWaveHitMode = (clientX) => {
        if (!S.buffer) return 'seek';
        const rect = wave.getBoundingClientRect();
        const x = clientX - rect.left;
        const hitTol = ('ontouchstart' in window) ? 18 : 12;

        if (S.selection && S.selection.active) {
          const inX = xFromWaveTime(S.selection.start);
          const outX = xFromWaveTime(S.selection.end);
          if (Math.abs(x - inX) <= hitTol) return 'handle-in';
          if (Math.abs(x - outX) <= hitTol) return 'handle-out';
        }
        if (S.waveTool === 'select') return 'select';
        return 'seek';
      };

      wave.addEventListener('pointerdown', (e) => {
        if (!S.buffer || S.baking) return;
        const rect = wave.getBoundingClientRect();
        const clientX = e.clientX;
        const x = Math.max(0, Math.min(rect.width, clientX - rect.left));
        const t = timeFromWaveX(clientX);

        let mode = getWaveHitMode(clientX);
        if (e.shiftKey || e.altKey) mode = 'select';

        wavePointerState = {
          down: true,
          mode,
          startX: x,
          startTime: t,
          initIn: S.selection.active ? S.selection.start : t,
          initOut: S.selection.active ? S.selection.end : t
        };

        try { wave.setPointerCapture(e.pointerId); } catch (_) {}

        if (mode === 'seek') {
          seekFromEvent(e);
        } else if (mode === 'select') {
          setSelection(t, t);
        }
      });

      wave.addEventListener('pointermove', (e) => {
        if (!S.buffer) return;
        const clientX = e.clientX;

        if (!wavePointerState.down) {
          const mode = getWaveHitMode(clientX);
          if (mode === 'handle-in' || mode === 'handle-out') {
            wave.style.cursor = 'ew-resize';
          } else if (S.waveTool === 'select') {
            wave.style.cursor = 'crosshair';
          } else {
            wave.style.cursor = 'pointer';
          }
          return;
        }

        const t = timeFromWaveX(clientX);
        const mode = wavePointerState.mode;

        if (mode === 'seek') {
          seekFromEvent(e);
        } else if (mode === 'select') {
          setSelection(wavePointerState.startTime, t);
        } else if (mode === 'handle-in') {
          setSelection(t, wavePointerState.initOut);
        } else if (mode === 'handle-out') {
          setSelection(wavePointerState.initIn, t);
        }
      });

      const endWavePointer = (e) => {
        if (!wavePointerState.down) return;
        const mode = wavePointerState.mode;
        wavePointerState.down = false;
        try { wave.releasePointerCapture(e.pointerId); } catch (_) {}

        if (mode === 'select' && S.selection && S.selection.active) {
          if (Math.abs(S.selection.end - S.selection.start) < 0.02) {
            clearSelection();
          }
        }
        wave.style.cursor = S.waveTool === 'select' ? 'crosshair' : 'pointer';
      };

      wave.addEventListener('pointerup', endWavePointer);
      wave.addEventListener('pointercancel', endWavePointer);

      window.addEventListener('keydown', onKey);
      window.addEventListener('resize', () => resizeWave());
      window.addEventListener('online', updateOnline);
      window.addEventListener('offline', updateOnline);

      // Backdrop click closes modals
      [els.saveModal, els.settingsModal, els.moreSkipModal, els.resetAudioModal, els.deleteRecordModal, els.resetProjectModal, els.packModal, els.projectModal, els.liveMonitorModal, els.batchExportModal].forEach((m) => {
        if (!m) return;
        m.addEventListener('click', (e) => {
          if (e.target === m) hideModal(m);
        });
      });

      const handleAppInactive = () => {
        flushPersist();
        if (S.liveMonitoring) stopLiveMonitor();
        if (S.playing) stopPlayback(false);
        if (audioCtx && audioCtx.state === 'running') {
          audioCtx.suspend().catch(() => {});
        }
      };
      window.addEventListener('pagehide', handleAppInactive);
      window.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') handleAppInactive();
      });
    }

    let pendingPack = null;
    function renderPackConflicts(incoming) {
      if (!els.packList) return;
      els.packList.replaceChildren();
      for (const c of incoming) {
        const hit = S.customSettings.find((x) => x.id === c.id || x.name.toLowerCase() === c.name.toLowerCase());
        const row = document.createElement('div');
        row.className = 'pack-item';
        const name = document.createElement('span');
        name.textContent = c.name + (hit ? ' (exists as “' + hit.name + '”)' : ' (new)');
        const sel = document.createElement('select');
        sel.dataset.pack = c.id;
        [['skip', 'Skip'], ['replace', 'Replace'], ['keep', 'Keep both']].forEach(([v, lab]) => {
          const o = document.createElement('option');
          o.value = v;
          o.textContent = lab;
          if (!hit && v === 'keep') o.selected = true;
          if (hit && v === 'replace') o.selected = true;
          if (!hit && v === 'skip') o.disabled = true;
          sel.appendChild(o);
        });
        if (!hit) sel.value = 'keep';
        row.append(name, sel);
        els.packList.appendChild(row);
      }
    }
    function applyPackImport() {
      if (!pendingPack) {
        hideModal(els.packModal);
        return;
      }
      const choices = {};
      if (els.packList) {
        els.packList.querySelectorAll('select[data-pack]').forEach((s) => {
          choices[s.dataset.pack] = s.value;
        });
      }
      for (const c of pendingPack) {
        if (S.customSettings.length >= MAX_CUSTOMS) break;
        const hit = S.customSettings.find((x) => x.id === c.id || x.name.toLowerCase() === c.name.toLowerCase());
        const action = choices[c.id] || (hit ? 'replace' : 'keep');
        if (action === 'skip') continue;
        if (action === 'replace' && hit) {
          hit.name = c.name;
          hit.fx = c.fx;
          hit.presetChain = c.presetChain;
          hit.presetChainMix = c.presetChainMix;
          hit.updatedAt = Date.now();
          hit.emoji = c.emoji;
          continue;
        }
        if (hit) {
          c.id = uid();
          let n = c.name;
          let i = 2;
          while (S.customSettings.some((x) => x.name.toLowerCase() === n.toLowerCase())) {
            n = c.name.slice(0, 36) + ' ' + i;
            i += 1;
          }
          c.name = n;
        }
        S.customSettings.push(c);
      }
      pendingPack = null;
      hideModal(els.packModal);
      renderPresets();
      schedulePersist();
      toast('Imported custom pack', 'ok');
    }

    /* =========================================================
       Boot
       ========================================================= */
    function boot() {
      const p = loadPersisted();
      applyPersisted(p);
      loadFxPresetsData(true);
      rebuildFxPanel();
      syncGainSlidersUI();
      renderPresets();
      updateChainBar();
      updateUndoButtons();
      detectRecordSupport();
      updateTransportEnabled();
      updateTimeChip();
      updateOnline();

      // Initialize Phase 1-4 UI state
      if (els.gateThreshold) {
        els.gateThreshold.value = String(S.fx.gateThreshold || -100);
        if (els.gateThresholdVal) els.gateThresholdVal.textContent = (S.fx.gateThreshold || -100) + ' dB';
      }
      if (els.deEssAmount) {
        els.deEssAmount.value = String(S.fx.deEssAmount || 0);
        if (els.deEssAmountVal) els.deEssAmountVal.textContent = Math.round((S.fx.deEssAmount || 0) * 100) + '%';
      }
      if (els.humNotchSelect) {
        els.humNotchSelect.value = String(S.fx.humNotch || 0);
      }
      if (els.lufsTargetSelect) {
        els.lufsTargetSelect.value = String(S.lufsTarget || '-14');
      }
      if (els.xyAxisMode) {
        els.xyAxisMode.value = String(S.xyAxisMode || 'pitch-formant');
      }
      updateXyLabels();
      drawXyPad();
      renderCueMarkers();
      syncAmbienceUI();
      setVisMode(S.visMode || 'waveform');

      wire();
      initBatteryMonitor();
      applyEcoModeState();
      resizeWave();
      registerSW();
      updateWorkflowGuide();

      // Unlock audio on first gesture (iOS/iPad)
      const unlock = () => {
        try {
          ensureAudioCtx();
          audioCtx.resume();
        } catch (_) {}
        window.removeEventListener('pointerdown', unlock);
        window.removeEventListener('touchstart', unlock);
      };
      window.addEventListener('pointerdown', unlock, { once: true });
      window.addEventListener('touchstart', unlock, { once: true, passive: true });
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();
  })();
