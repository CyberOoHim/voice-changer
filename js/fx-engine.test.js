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
if (!chain.input || !chain.output || chain.rate < 1) throw new Error('chain');
const peaks = api.buildPeakPyramid(mono);
if (!peaks || peaks.cols < 10) throw new Error('peaks');
console.log('fx-engine smoke ok', { mono: mono.length, wav: wav.size, peaks: peaks.cols });
