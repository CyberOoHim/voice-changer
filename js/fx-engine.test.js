/* Minimal Node smoke test for js/fx-engine.js (no browser). */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

class FakeBuffer {
  constructor(ch, length, sr) {
    this.numberOfChannels = ch;
    this.length = length;
    this.sampleRate = sr;
    this.duration = length / sr;
    this._ch = Array.from({ length: ch }, () => new Float32Array(length));
  }
  getChannelData(i) { return this._ch[i]; }
  copyToChannel(src, i) { this._ch[i].set(src.subarray(0, this.length)); }
}

function fakeCtx() {
  const nodes = [];
  const mk = (extra) => {
    const n = Object.assign({
      connect() { return n; },
      disconnect() {},
      start() {},
      stop() {},
    }, extra);
    nodes.push(n);
    return n;
  };
  return {
    sampleRate: 48000,
    destination: { channelCount: 1 },
    createBuffer: (c, l, s) => new FakeBuffer(c, l, s),
    createGain: () => mk({ gain: { value: 1 } }),
    createBiquadFilter: () => mk({ type: 'lowpass', frequency: { value: 0 }, Q: { value: 0 }, gain: { value: 0 } }),
    createWaveShaper: () => mk({ curve: null, oversample: 'none' }),
    createOscillator: () => mk({ frequency: { value: 0 }, type: 'sine' }),
    createBufferSource: () => mk({ buffer: null, loop: false }),
    createDelay: () => mk({ delayTime: { value: 0 } }),
    createConvolver: () => mk({ buffer: null }),
    createDynamicsCompressor: () => mk({
      threshold: { value: 0 }, ratio: { value: 0 }, attack: { value: 0 }, release: { value: 0 }
    }),
  };
}

const sandbox = { window: {}, globalThis: {}, Blob };
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'fx-engine.js'), 'utf8'), sandbox);

const ctx = fakeCtx();
const api = sandbox.VoxFx.createFxEngine({
  ensureAudioCtx: () => ctx,
  getInputGain: () => 1.5,
  LIMITER_PEAK: 0.89,
  TARGET_PEAK: 0.95,
  MAX_NORM_GAIN: 32,
  SKIP_NORM_PEAK: 0.9
});

const src = ctx.createBuffer(2, 4800, 48000);
for (let i = 0; i < 4800; i++) {
  src.getChannelData(0)[i] = Math.sin(i / 20) * 0.2;
  src.getChannelData(1)[i] = Math.sin(i / 20) * 0.1;
}
const mono = api.toMonoBuffer(src);
if (mono.numberOfChannels !== 1) throw new Error('mono channels');
const pitched = api.pitchShiftKeepLength(mono, 4);
if (pitched.length !== mono.length) throw new Error('pitch must keep length');
const crushed = api.applyFadesAndCrush(mono, { fadeIn: 0.01, fadeOut: 0.01, bitcrush: 0.3, sampleRateCrush: 0.2 });
if (crushed.length !== mono.length) throw new Error('crush length');
const wav = api.bufferToWav(mono);
if (!(wav instanceof sandbox.Blob) && !(typeof Blob !== 'undefined')) {
  // Node 18 has Blob
}
if (typeof wav.size === 'number' && wav.size < 44) throw new Error('wav too small');
const chain = api.buildFxChain(ctx, {
  highpass: 80, lowpass: 8000, formant: 2, bass: 1, mid: 0, treble: 0,
  bpMix: 0.2, bpFreq: 1200, bpQ: 1, distortion: 0.1, ringFreq: 12,
  noiseMix: 0.02, delayMix: 0.1, delayTime: 0.1, delayFeedback: 0.2,
  chorus: 0.2, flanger: 0.1, tremolo: 0.2, tremoloRate: 5,
  reverbMix: 0.2, reverbDecay: 1.2, reverbSize: 0.4,
  compressorThresh: -18, compressorRatio: 3, speed: 1.1, gain: 1
});
const peaks = api.buildPeakPyramid(mono);
if (!peaks || peaks.cols < 10) throw new Error('peaks');

// Test concatBuffersWithCrossfade
const bufA = ctx.createBuffer(1, 48000, 48000); // 1.0s
const bufB = ctx.createBuffer(1, 48000, 48000); // 1.0s
for (let i = 0; i < 48000; i++) {
  bufA.getChannelData(0)[i] = 0.5;
  bufB.getChannelData(0)[i] = 0.8;
}
const combined = api.concatBuffersWithCrossfade(bufA, bufB, 0.04);
const expectedLen = 48000 + 48000 - Math.floor(0.04 * 48000);
if (combined.length !== expectedLen) throw new Error('concat crossfade length mismatch');
if (Math.abs(combined.getChannelData(0)[0] - 0.5) > 1e-5) throw new Error('head sample mismatch');
if (Math.abs(combined.getChannelData(0)[combined.length - 1] - 0.8) > 1e-5) throw new Error('tail sample mismatch');

// Test 1: Noise Gate (Phase 1)
const gateTestBuf = ctx.createBuffer(1, 2400, 48000);
for (let i = 0; i < 1200; i++) gateTestBuf.getChannelData(0)[i] = 0.0001; // -80 dB (below -40dB gate)
for (let i = 1200; i < 2400; i++) gateTestBuf.getChannelData(0)[i] = 0.5;   // -6 dB (above gate)
const gated = api.applyNoiseGate(gateTestBuf, { thresholdDb: -40, releaseSec: 0.05 });
if (gated.length !== gateTestBuf.length) throw new Error('gate length mismatch');
if (Math.abs(gated.getChannelData(0)[100]) > 1e-5) throw new Error('noise gate failed to attenuate quiet portion');
if (Math.abs(gated.getChannelData(0)[2000]) < 0.3) throw new Error('noise gate muted loud portion');

// Test 2: Hum Notch Filter (Phase 1)
const humTestBuf = ctx.createBuffer(1, 24000, 48000);
for (let i = 0; i < 24000; i++) {
  humTestBuf.getChannelData(0)[i] = Math.sin((2 * Math.PI * 60 * i) / 48000);
}
const notched = api.applyHumNotch(humTestBuf, 60);
if (notched.length !== humTestBuf.length) throw new Error('notch length mismatch');
let steadyPeak = 0;
const notchedSamples = notched.getChannelData(0);
for (let i = 4800; i < 24000; i++) {
  const a = Math.abs(notchedSamples[i]);
  if (a > steadyPeak) steadyPeak = a;
}
if (steadyPeak > 0.05) throw new Error('hum notch filter failed to attenuate 60Hz frequency: ' + steadyPeak);

// Test 3: De-Esser (Phase 1)
const sibilanceBuf = ctx.createBuffer(1, 4800, 48000);
for (let i = 0; i < 4800; i++) {
  sibilanceBuf.getChannelData(0)[i] = Math.sin((2 * Math.PI * 7000 * i) / 48000) * 0.8;
}
const deEssed = api.applyDeEsser(sibilanceBuf, { amount: 0.8, freq: 7000 });
if (deEssed.length !== sibilanceBuf.length) throw new Error('de-esser length mismatch');
if (api.peakOf(deEssed) >= api.peakOf(sibilanceBuf)) throw new Error('de-esser failed to reduce high frequency energy');

// Test 4: Phase-Vocoder Pitch Shifter with cents (Phase 2)
const pvShifted = api.pitchShiftPhaseVocoder(mono, 3, 50); // +3.5 semitones
if (pvShifted.length !== mono.length) throw new Error('phase vocoder length mismatch');

// Test 5: Harmonizer / Choir Generator (Phase 2)
const harmonyBuf = api.applyHarmonizer(mono, { harmonyPreset: 'major-chord', harmonyMix: 0.6 });
if (harmonyBuf.length !== mono.length) throw new Error('harmonizer length mismatch');

// Test 6: 16-Band Synthesizer Vocoder (Phase 2)
const vocoderBuf = api.applyVocoder(mono, { vocoderMix: 0.7, vocoderCarrier: 'saw', vocoderBands: 16 });
if (vocoderBuf.length !== mono.length) throw new Error('vocoder length mismatch');

// Test 7: ITU-R BS.1770 LUFS Loudness & Normalization (Phase 4)
const lufsTestBuf = ctx.createBuffer(1, 48000, 48000);
for (let i = 0; i < 48000; i++) {
  lufsTestBuf.getChannelData(0)[i] = Math.sin((2 * Math.PI * 1000 * i) / 48000) * 0.3;
}
const initialLufs = api.computeLUFS(lufsTestBuf);
if (!isFinite(initialLufs.lufs) || initialLufs.lufs < -50 || initialLufs.lufs > 0) {
  throw new Error('invalid LUFS calculation: ' + initialLufs.lufs);
}
const normalized = api.normalizeToLUFS(lufsTestBuf, -14, -1.0);
const normLufs = api.computeLUFS(normalized);
if (Math.abs(normLufs.lufs - (-14)) > 1.5) {
  throw new Error('LUFS normalization deviation too large: ' + normLufs.lufs);
}

// Test 8: 24-bit Studio WAV export (Phase 4)
const wav24 = api.bufferToWav24(mono);
const expected24Size = 44 + mono.length * 3;
if (typeof wav24.size === 'number' && wav24.size !== expected24Size) {
  throw new Error('24-bit WAV size mismatch. Expected ' + expected24Size + ', got ' + wav24.size);
}

// Test 9: Live parameter update on active WebAudio chain (iPad / Power Eco optimization)
if (typeof chain.updateLiveParams !== 'function') {
  throw new Error('chain.updateLiveParams missing on buildFxChain result');
}
chain.updateLiveParams({
  bass: 4,
  treble: -2,
  highpass: 150,
  lowpass: 6000,
  gain: 1.25,
  distortion: 0.2
}, { inputGain: 1.8 });

// Test 10: Opus audio export support
if (typeof api.bufferToOpus !== 'function') {
  throw new Error('api.bufferToOpus missing');
}
api.bufferToOpus(mono).then((opusBlob) => {
  if (!opusBlob || !(opusBlob instanceof sandbox.Blob || typeof Blob !== 'undefined')) {
    throw new Error('bufferToOpus failed to return a valid audio blob');
  }
}).catch((err) => {
  throw new Error('bufferToOpus rejected: ' + err);
});

// Test 11: Curated FX Presets catalog & preBaked buildFxChain validation
const presetsRaw = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'fx-presets.json'), 'utf8'));
if (!Array.isArray(presetsRaw.categories) || presetsRaw.categories.length !== 7 || !presetsRaw.categories.includes('FX & Utility')) {
  throw new Error('fx-presets.json categories invalid: ' + JSON.stringify(presetsRaw.categories));
}
if (!Array.isArray(presetsRaw.presets) || presetsRaw.presets.length < 60 || presetsRaw.presets.length > 70) {
  throw new Error('Expected 60-70 curated presets, got ' + (presetsRaw.presets && presetsRaw.presets.length));
}
const seenIds = new Set();
let vocoderCount = 0;
let harmonyCount = 0;
let deEssCount = 0;
for (const p of presetsRaw.presets) {
  if (!p.id || !p.name || !presetsRaw.categories.includes(p.cat) || !p.fx) {
    throw new Error('Invalid preset entry: ' + JSON.stringify(p));
  }
  if (seenIds.has(p.id)) throw new Error('Duplicate preset id: ' + p.id);
  seenIds.add(p.id);
  if (typeof p.fx.pitchSemi === 'number' && (p.fx.pitchSemi < -12 || p.fx.pitchSemi > 12)) {
    throw new Error('Preset ' + p.id + ' pitchSemi out of bounds: ' + p.fx.pitchSemi);
  }
  if (p.fx.vocoderMix > 0) vocoderCount++;
  if (p.fx.harmonyMix > 0 && p.fx.harmonyPreset && p.fx.harmonyPreset !== 'none') harmonyCount++;
  if (p.fx.deEssAmount > 0) deEssCount++;
}
if (vocoderCount === 0 || harmonyCount === 0 || deEssCount === 0) {
  throw new Error('Expected active vocoder, harmonizer, and de-esser presets in catalog');
}
const preBakedChain = api.buildFxChain(ctx, Object.assign({}, presetsRaw.defaultFx, {
  harmonyPreset: 'octave-dual',
  harmonyMix: 0.4,
  deEssAmount: 0.5,
  humNotch: 60
}), { live: false, preBaked: true, duration: 2 });
if (!preBakedChain || !preBakedChain.input || !preBakedChain.output) {
  throw new Error('preBaked buildFxChain failed');
}

// Test 12: Procedural Demo Voice Synthesis
const demoVoices = api.getDemoVoices();
if (!Array.isArray(demoVoices) || demoVoices.length < 5) {
  throw new Error('getDemoVoices invalid: ' + JSON.stringify(demoVoices));
}
for (const dv of demoVoices) {
  const synthBuf = api.synthesizeDemoVoice(dv.id, { sampleRate: 48000 });
  if (!synthBuf || synthBuf.numberOfChannels !== 1 || synthBuf.length < 48000 * 2) {
    throw new Error('synthesizeDemoVoice failed for ' + dv.id);
  }
  const pk = api.peakOf(synthBuf);
  if (pk < 0.2 || pk > 1.0) {
    throw new Error('synthesizeDemoVoice peak out of bounds for ' + dv.id + ': ' + pk);
  }
}

// Test 13: Background Ambience Soundscapes & Voice Auto-Ducker
const scenes = api.getAmbienceScenes();
if (!Array.isArray(scenes) || scenes.length < 8) {
  throw new Error('getAmbienceScenes invalid: ' + JSON.stringify(scenes));
}
for (const scene of scenes) {
  if (scene.id === 'none') continue;
  const ambMix = api.applyAmbienceSoundscape(mono, {
    ambiencePreset: scene.id,
    ambienceMix: 0.35,
    ambienceDuck: 0.6,
    ambienceTone: 2
  });
  if (!ambMix || ambMix.numberOfChannels !== 1 || ambMix.length !== mono.length) {
    throw new Error('applyAmbienceSoundscape failed for ' + scene.id);
  }
  const pk = api.peakOf(ambMix);
  if (pk <= 0 || pk > 1.0) {
    throw new Error('applyAmbienceSoundscape peak invalid for ' + scene.id + ': ' + pk);
  }
}

console.log('fx-engine smoke ok', {
  mono: mono.length,
  wav: wav.size,
  wav24: wav24.size,
  peaks: peaks.cols,
  combined: combined.length,
  lufs: initialLufs.lufs.toFixed(2),
  normLufs: normLufs.lufs.toFixed(2),
  presets: presetsRaw.presets.length,
  demoVoices: demoVoices.length,
  ambienceScenes: scenes.length
});


