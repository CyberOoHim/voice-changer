/* VoxClip FX engine — buffer ops, pitch (duration-preserving), graph, WAV */
(function (root) {
  'use strict';

  function interpSample(data, pos) {
    if (pos <= 0) return data[0] || 0;
    if (pos >= data.length - 1) return data[data.length - 1] || 0;
    const i = Math.floor(pos);
    const f = pos - i;
    return data[i] * (1 - f) + data[i + 1] * f;
  }

  function createFxEngine(deps) {
    const ensureAudioCtx = deps.ensureAudioCtx;
    const getInputGain = deps.getInputGain || (() => 1);
    const LIMITER_PEAK = deps.LIMITER_PEAK;
    const TARGET_PEAK = deps.TARGET_PEAK;
    const MAX_NORM_GAIN = deps.MAX_NORM_GAIN;
    const SKIP_NORM_PEAK = deps.SKIP_NORM_PEAK;

    function cloneBuffer(src) {
      const ctx = ensureAudioCtx();
      const out = ctx.createBuffer(src.numberOfChannels, src.length, src.sampleRate);
      for (let c = 0; c < src.numberOfChannels; c++) {
        out.copyToChannel(src.getChannelData(c), c);
      }
      return out;
    }

    function toMonoBuffer(src) {
      const ctx = ensureAudioCtx();
      if (src.numberOfChannels === 1) {
        const out = ctx.createBuffer(1, src.length, src.sampleRate);
        out.copyToChannel(src.getChannelData(0), 0);
        return out;
      }
      const out = ctx.createBuffer(1, src.length, src.sampleRate);
      const dest = out.getChannelData(0);
      const chans = [];
      for (let c = 0; c < src.numberOfChannels; c++) chans.push(src.getChannelData(c));
      const n = chans.length;
      for (let i = 0; i < src.length; i++) {
        let sum = 0;
        for (let c = 0; c < n; c++) sum += chans[c][i];
        dest[i] = sum / n;
      }
      return out;
    }

    function applyBufferGain(buf, gain) {
      if (!buf || !isFinite(gain) || Math.abs(gain - 1) < 1e-6) return buf;
      const ctx = ensureAudioCtx();
      const out = ctx.createBuffer(1, buf.length, buf.sampleRate);
      const src = buf.getChannelData(0);
      const dest = out.getChannelData(0);
      for (let i = 0; i < src.length; i++) {
        let s = src[i] * gain;
        if (s > 0.95 || s < -0.95) s = Math.tanh(s);
        if (s > 1) s = 1;
        else if (s < -1) s = -1;
        dest[i] = s;
      }
      return out;
    }

    function normalizeRecordingBuffer(buf, opts) {
      opts = opts || {};
      const maxGain = opts.maxGain != null ? opts.maxGain : MAX_NORM_GAIN;
      const targetPeak = opts.targetPeak != null ? opts.targetPeak : TARGET_PEAK;
      const extraGain = opts.extraGain != null ? opts.extraGain : 1;
      const data = buf.getChannelData(0);
      let peak = 0;
      for (let i = 0; i < data.length; i++) {
        const a = Math.abs(data[i]);
        if (a > peak) peak = a;
      }
      if (peak < 1e-8) return buf;
      let gain = 1;
      if (peak < SKIP_NORM_PEAK) {
        gain = targetPeak / peak;
        if (gain > maxGain) gain = maxGain;
      }
      gain *= extraGain;
      if (Math.abs(gain - 1) < 1e-6) return buf;
      return applyBufferGain(buf, gain);
    }

    function peakOf(buf) {
      const d = buf.getChannelData(0);
      let p = 0;
      for (let i = 0; i < d.length; i++) {
        const a = Math.abs(d[i]);
        if (a > p) p = a;
      }
      return p;
    }

    function applyPeakLimiter(buf, target) {
      if (target == null) target = LIMITER_PEAK;
      const peak = peakOf(buf);
      if (peak <= target || peak < 1e-8) return buf;
      const g = target / peak;
      const ctx = ensureAudioCtx();
      const out = ctx.createBuffer(1, buf.length, buf.sampleRate);
      const src = buf.getChannelData(0);
      const dest = out.getChannelData(0);
      for (let i = 0; i < src.length; i++) dest[i] = src[i] * g;
      return out;
    }

    function reverseBuffer(buf) {
      const ctx = ensureAudioCtx();
      const out = ctx.createBuffer(1, buf.length, buf.sampleRate);
      const s = buf.getChannelData(0);
      const d = out.getChannelData(0);
      for (let i = 0; i < s.length; i++) d[i] = s[s.length - 1 - i];
      return out;
    }

    function applyFadesAndCrush(buf, fx) {
      const ctx = ensureAudioCtx();
      const out = ctx.createBuffer(1, buf.length, buf.sampleRate);
      const s = buf.getChannelData(0);
      const d = out.getChannelData(0);
      const sr = buf.sampleRate;
      const fadeInN = Math.min(buf.length, Math.floor((fx.fadeIn || 0) * sr));
      const fadeOutN = Math.min(buf.length, Math.floor((fx.fadeOut || 0) * sr));
      const bit = fx.bitcrush || 0;
      const levels = bit > 0 ? Math.max(2, Math.round(Math.pow(2, 16 - bit * 14))) : 0;
      const crush = fx.sampleRateCrush || 0;
      const holdEvery = crush > 0 ? Math.max(1, Math.round(1 + crush * 24)) : 1;
      let holdVal = 0;
      for (let i = 0; i < s.length; i++) {
        let v = s[i];
        if (holdEvery > 1) {
          if (i % holdEvery === 0) holdVal = v;
          v = holdVal;
        }
        if (levels > 0) v = Math.round(v * levels) / levels;
        if (fadeInN > 0 && i < fadeInN) v *= i / fadeInN;
        if (fadeOutN > 0 && i >= s.length - fadeOutN) v *= (s.length - 1 - i) / fadeOutN;
        d[i] = v;
      }
      return out;
    }

    function pitchShiftKeepLength(buf, semitones) {
      const st = Number(semitones) || 0;
      if (Math.abs(st) < 1e-4) return buf;
      const ratio = Math.pow(2, st / 12);
      const src = buf.getChannelData(0);
      const n = src.length;
      const sr = buf.sampleRate;
      const ctx = ensureAudioCtx();
      const out = ctx.createBuffer(1, n, sr);
      const dest = out.getChannelData(0);
      const grain = Math.max(64, Math.floor(sr * 0.045));
      const hop = Math.max(32, Math.floor(grain / 2));
      const win = new Float32Array(grain);
      for (let i = 0; i < grain; i++) {
        win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (grain - 1));
      }
      for (let t = 0; t < n; t += hop) {
        const center = t;
        for (let i = 0; i < grain; i++) {
          const oi = t + i - Math.floor(grain / 4);
          if (oi < 0 || oi >= n) continue;
          dest[oi] += interpSample(src, center + (i - grain / 2) * ratio) * win[i];
        }
      }
      let peak = 0;
      for (let i = 0; i < n; i++) {
        const a = Math.abs(dest[i]);
        if (a > peak) peak = a;
      }
      if (peak > 1) {
        const g = 0.98 / peak;
        for (let i = 0; i < n; i++) dest[i] *= g;
      }
      return out;
    }

    function buildPeakPyramid(buf) {
      if (!buf) return null;
      const data = buf.getChannelData(0);
      const n = data.length;
      const cols = Math.min(4096, Math.max(256, Math.ceil(n / 64)));
      const step = n / cols;
      const mins = new Float32Array(cols);
      const maxs = new Float32Array(cols);
      for (let x = 0; x < cols; x++) {
        const start = Math.floor(x * step);
        const end = Math.min(n, Math.floor((x + 1) * step));
        let mn = 1, mx = -1;
        for (let i = start; i < end; i++) {
          const v = data[i];
          if (v < mn) mn = v;
          if (v > mx) mx = v;
        }
        mins[x] = mn;
        maxs[x] = mx;
      }
      return { cols, mins, maxs, length: n };
    }

    function makeImpulse(ctx, seconds, decay, size) {
      const len = Math.max(1, Math.floor(ctx.sampleRate * seconds * (0.5 + size * 0.5)));
      const chCount = Math.min(2, Math.max(1, ctx.destination && ctx.destination.channelCount ? ctx.destination.channelCount : 2));
      const impulse = ctx.createBuffer(chCount, len, ctx.sampleRate);
      for (let c = 0; c < chCount; c++) {
        const ch = impulse.getChannelData(c);
        for (let i = 0; i < len; i++) {
          ch[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 1.5 + decay);
        }
      }
      return impulse;
    }

    function buildFxChain(ctx, fx, opts) {
      opts = opts || {};
      const nodes = [];
      const input = ctx.createGain();
      const preGain = opts.inputGain != null ? opts.inputGain : (getInputGain() || 1);
      input.gain.value = Math.max(0.01, preGain);

      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = Math.max(20, fx.highpass);
      hp.Q.value = 0.7;

      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = Math.min(20000, fx.lowpass);
      lp.Q.value = 0.7;

      const formantRatio = Math.pow(2, (fx.formant || 0) / 12);
      const bass = ctx.createBiquadFilter();
      bass.type = 'lowshelf';
      bass.frequency.value = 120 * formantRatio;
      bass.gain.value = fx.bass || 0;

      const mid = ctx.createBiquadFilter();
      mid.type = 'peaking';
      mid.frequency.value = 1000 * formantRatio;
      mid.Q.value = 1;
      mid.gain.value = fx.mid || 0;

      const treble = ctx.createBiquadFilter();
      treble.type = 'highshelf';
      treble.frequency.value = 4000 * formantRatio;
      treble.gain.value = fx.treble || 0;

      input.connect(hp);
      hp.connect(lp);
      lp.connect(bass);
      bass.connect(mid);
      mid.connect(treble);

      let head = treble;

      if ((fx.bpMix || 0) > 0.001) {
        const dryG = ctx.createGain();
        const wetG = ctx.createGain();
        dryG.gain.value = 1 - fx.bpMix;
        wetG.gain.value = fx.bpMix;
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.value = fx.bpFreq * formantRatio;
        bp.Q.value = Math.max(0.2, fx.bpQ);
        const merge = ctx.createGain();
        head.connect(dryG);
        head.connect(bp);
        bp.connect(wetG);
        dryG.connect(merge);
        wetG.connect(merge);
        head = merge;
      }

      if ((fx.distortion || 0) > 0.001) {
        const shaper = ctx.createWaveShaper();
        const amount = fx.distortion;
        const n = 256;
        const curve = new Float32Array(n);
        for (let i = 0; i < n; i++) {
          const x = (i * 2) / n - 1;
          curve[i] = ((1 + amount * 4) * x) / (1 + amount * 4 * Math.abs(x));
        }
        shaper.curve = curve;
        shaper.oversample = '2x';
        head.connect(shaper);
        head = shaper;
      }

      if ((fx.ringFreq || 0) > 0.1) {
        const dry = ctx.createGain();
        dry.gain.value = 0.35;
        const vca = ctx.createGain();
        vca.gain.value = 0;
        const osc = ctx.createOscillator();
        osc.frequency.value = fx.ringFreq;
        osc.type = 'sine';
        const depth = ctx.createGain();
        depth.gain.value = 0.65;
        const merge = ctx.createGain();
        head.connect(dry);
        head.connect(vca);
        osc.connect(depth);
        depth.connect(vca.gain);
        dry.connect(merge);
        vca.connect(merge);
        try { osc.start(0); } catch (_) {}
        nodes.push(osc);
        head = merge;
      }

      if ((fx.noiseMix || 0) > 0.001) {
        const noiseGain = ctx.createGain();
        noiseGain.gain.value = fx.noiseMix;
        const merge = ctx.createGain();
        head.connect(merge);
        const bufferSize = Math.floor(ctx.sampleRate * 2);
        const noiseBuf = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
        const nd = noiseBuf.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) nd[i] = Math.random() * 2 - 1;
        const noiseSrc = ctx.createBufferSource();
        noiseSrc.buffer = noiseBuf;
        noiseSrc.loop = true;
        noiseSrc.connect(noiseGain);
        noiseGain.connect(merge);
        try { noiseSrc.start(0); } catch (_) {}
        nodes.push(noiseSrc);
        head = merge;
      }

      if ((fx.delayMix || 0) > 0.001 && (fx.delayTime || 0) > 0) {
        const dry = ctx.createGain();
        const wet = ctx.createGain();
        dry.gain.value = 1 - fx.delayMix;
        wet.gain.value = fx.delayMix;
        const delay = ctx.createDelay(2);
        delay.delayTime.value = Math.min(1.5, Math.max(0, fx.delayTime));
        const fb = ctx.createGain();
        fb.gain.value = Math.min(0.9, fx.delayFeedback || 0);
        const merge = ctx.createGain();
        head.connect(dry);
        head.connect(delay);
        delay.connect(fb);
        fb.connect(delay);
        delay.connect(wet);
        dry.connect(merge);
        wet.connect(merge);
        head = merge;
      }

      function attachModDelay(from, mix, rate, baseDelay, depth) {
        if (mix <= 0.001) return from;
        const dry = ctx.createGain();
        const wet = ctx.createGain();
        dry.gain.value = 1 - mix * 0.7;
        wet.gain.value = mix * 0.7;
        const delay = ctx.createDelay(0.05);
        delay.delayTime.value = baseDelay;
        const lfo = ctx.createOscillator();
        lfo.type = 'sine';
        lfo.frequency.value = rate;
        const lfoGain = ctx.createGain();
        lfoGain.gain.value = depth;
        lfo.connect(lfoGain);
        lfoGain.connect(delay.delayTime);
        const merge = ctx.createGain();
        from.connect(dry);
        from.connect(delay);
        delay.connect(wet);
        dry.connect(merge);
        wet.connect(merge);
        try { lfo.start(0); } catch (_) {}
        nodes.push(lfo);
        return merge;
      }
      head = attachModDelay(head, fx.chorus || 0, 1.4, 0.012, 0.004);
      head = attachModDelay(head, fx.flanger || 0, 0.35, 0.004, 0.0025);

      if ((fx.tremolo || 0) > 0.001) {
        const tGain = ctx.createGain();
        tGain.gain.value = 1 - (fx.tremolo * 0.5);
        const lfo = ctx.createOscillator();
        lfo.frequency.value = fx.tremoloRate || 5;
        const depth = ctx.createGain();
        depth.gain.value = fx.tremolo * 0.5;
        lfo.connect(depth);
        depth.connect(tGain.gain);
        head.connect(tGain);
        head = tGain;
        try { lfo.start(0); } catch (_) {}
        nodes.push(lfo);
      }

      if ((fx.reverbMix || 0) > 0.001) {
        const dry = ctx.createGain();
        const wet = ctx.createGain();
        dry.gain.value = 1 - fx.reverbMix;
        wet.gain.value = fx.reverbMix;
        const conv = ctx.createConvolver();
        conv.buffer = makeImpulse(ctx, Math.max(0.2, fx.reverbDecay || 1.4), fx.reverbDecay || 1.4, fx.reverbSize || 0.45);
        const merge = ctx.createGain();
        head.connect(dry);
        head.connect(conv);
        conv.connect(wet);
        dry.connect(merge);
        wet.connect(merge);
        head = merge;
      }

      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = fx.compressorThresh ?? -18;
      comp.ratio.value = fx.compressorRatio ?? 3;
      comp.attack.value = 0.005;
      comp.release.value = 0.12;
      const outGain = ctx.createGain();
      outGain.gain.value = fx.gain ?? 1;
      head.connect(comp);
      comp.connect(outGain);

      return {
        input,
        output: outGain,
        rate: Math.max(0.25, Math.min(4, fx.speed || 1)),
        vibrato: fx.vibrato || 0,
        vibratoRate: fx.vibratoRate || 5,
        stopExtras() {
          for (const n of nodes) {
            try { n.stop(); } catch (_) {}
            try { n.disconnect(); } catch (_) {}
          }
          nodes.length = 0;
        }
      };
    }

    function bufferToWav(buf) {
      const numCh = 1;
      const sr = buf.sampleRate;
      const samples = buf.getChannelData(0);
      const buffer = new ArrayBuffer(44 + samples.length * 2);
      const view = new DataView(buffer);
      const writeStr = (off, s) => { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)); };
      writeStr(0, 'RIFF');
      view.setUint32(4, 36 + samples.length * 2, true);
      writeStr(8, 'WAVE');
      writeStr(12, 'fmt ');
      view.setUint32(16, 16, true);
      view.setUint16(20, 1, true);
      view.setUint16(22, numCh, true);
      view.setUint32(24, sr, true);
      view.setUint32(28, sr * numCh * 2, true);
      view.setUint16(32, numCh * 2, true);
      view.setUint16(34, 16, true);
      writeStr(36, 'data');
      view.setUint32(40, samples.length * 2, true);
      let offset = 44;
      for (let i = 0; i < samples.length; i++) {
        let s = Math.max(-1, Math.min(1, samples[i]));
        view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
        offset += 2;
      }
      return new Blob([buffer], { type: 'audio/wav' });
    }

    return {
      cloneBuffer,
      toMonoBuffer,
      applyBufferGain,
      normalizeRecordingBuffer,
      peakOf,
      applyPeakLimiter,
      reverseBuffer,
      applyFadesAndCrush,
      pitchShiftKeepLength,
      buildPeakPyramid,
      buildFxChain,
      bufferToWav
    };
  }

  root.VoxFx = { createFxEngine };
})(typeof window !== 'undefined' ? window : globalThis);
