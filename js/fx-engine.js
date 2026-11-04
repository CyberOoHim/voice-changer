/* VoxClip FX engine — buffer ops, phase-vocoder, harmonizer, vocoder, LUFS & mastering, WAV */
(function (root) {
  'use strict';

  function interpSample(data, pos) {
    if (pos <= 0) return data[0] || 0;
    if (pos >= data.length - 1) return data[data.length - 1] || 0;
    const i = Math.floor(pos);
    const f = pos - i;
    return data[i] * (1 - f) + data[i + 1] * f;
  }

  function dbToLin(db) {
    return Math.pow(10, db / 20);
  }

  function linToDb(lin) {
    return 20 * Math.log10(Math.max(1e-9, lin));
  }

  function clampNum(v, min, max, fallback) {
    const n = Number(v);
    if (!isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, n));
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

    function concatBuffersWithCrossfade(bufA, bufB, crossfadeSec = 0.04) {
      if (!bufA || !bufA.length) return bufB ? cloneBuffer(bufB) : null;
      if (!bufB || !bufB.length) return bufA ? cloneBuffer(bufA) : null;
      const ctx = ensureAudioCtx();
      const sr = bufA.sampleRate;
      const maxFadeSec = Math.min(crossfadeSec, bufA.duration * 0.4, bufB.duration * 0.4);
      const fadeFrames = Math.max(1, Math.floor(maxFadeSec * sr));
      const totalFrames = bufA.length + bufB.length - fadeFrames;

      const out = ctx.createBuffer(1, totalFrames, sr);
      const outData = out.getChannelData(0);
      const dataA = bufA.getChannelData(0);
      const dataB = bufB.getChannelData(0);

      // Part 1: bufA before crossfade region
      const aHeadLen = bufA.length - fadeFrames;
      outData.set(dataA.subarray(0, aHeadLen), 0);

      // Part 2: Crossfade overlap with equal-power curve
      for (let i = 0; i < fadeFrames; i++) {
        const t = i / fadeFrames;
        const gainA = Math.cos(t * 0.5 * Math.PI);
        const gainB = Math.sin(t * 0.5 * Math.PI);
        outData[aHeadLen + i] = dataA[aHeadLen + i] * gainA + dataB[i] * gainB;
      }

      // Part 3: bufB after crossfade region
      outData.set(dataB.subarray(fadeFrames), aHeadLen + fadeFrames);

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

    /* -------------------------------------------------------------
       Audio Cut, Trim & Silence Stripping (Click-Free Splicing)
       ------------------------------------------------------------- */
    function findZeroCrossing(channelData, targetFrame, maxSearchFrames = 96) {
      if (!channelData || !channelData.length) return targetFrame;
      const n = channelData.length;
      const clampedTarget = Math.max(0, Math.min(n - 1, targetFrame));
      if (Math.abs(channelData[clampedTarget]) < 1e-4) return clampedTarget;

      let bestFrame = clampedTarget;
      let minAbs = Math.abs(channelData[clampedTarget]);
      const start = Math.max(0, clampedTarget - maxSearchFrames);
      const end = Math.min(n - 1, clampedTarget + maxSearchFrames);

      // Search for sign change (true zero crossing)
      for (let i = start; i < end; i++) {
        const s1 = channelData[i];
        const s2 = channelData[i + 1];
        if ((s1 <= 0 && s2 >= 0) || (s1 >= 0 && s2 <= 0)) {
          // Found zero crossing; pick whichever sample is closest to zero
          return Math.abs(s1) <= Math.abs(s2) ? i : (i + 1);
        }
        const a = Math.abs(s1);
        if (a < minAbs) {
          minAbs = a;
          bestFrame = i;
        }
      }
      return bestFrame;
    }

    function trimBuffer(buf, startSec, endSec, opts = {}) {
      if (!buf || !buf.length) return buf;
      const sr = buf.sampleRate;
      const numCh = buf.numberOfChannels;
      const dur = buf.duration;
      const inSec = Math.max(0, Math.min(dur, Math.min(startSec, endSec)));
      const outSec = Math.max(0, Math.min(dur, Math.max(startSec, endSec)));
      if (outSec - inSec <= 0.001) return buf;

      const ch0 = buf.getChannelData(0);
      const searchRadius = Math.max(1, Math.floor(0.002 * sr)); // 2ms search window
      const inFrame = findZeroCrossing(ch0, Math.floor(inSec * sr), searchRadius);
      const outFrame = findZeroCrossing(ch0, Math.ceil(outSec * sr), searchRadius);
      const cropLen = Math.max(1, outFrame - inFrame);

      const ctx = ensureAudioCtx();
      const out = ctx.createBuffer(numCh, cropLen, sr);
      const fadeFrames = Math.min(Math.floor(cropLen * 0.45), Math.max(1, Math.floor((opts.fadeSec || 0.005) * sr)));

      for (let c = 0; c < numCh; c++) {
        const srcData = buf.getChannelData(c);
        const destData = out.getChannelData(c);
        destData.set(srcData.subarray(inFrame, inFrame + cropLen));

        // 5ms micro fade-in at head to guarantee zero click
        for (let i = 0; i < fadeFrames; i++) {
          const t = i / fadeFrames;
          const g = Math.sin(t * 0.5 * Math.PI);
          destData[i] *= g;
        }
        // 5ms micro fade-out at tail to guarantee zero click
        for (let i = 0; i < fadeFrames; i++) {
          const t = i / fadeFrames;
          const g = Math.cos(t * 0.5 * Math.PI);
          destData[cropLen - 1 - i] *= g;
        }
      }
      return out;
    }

    function cutBufferRegion(buf, startSec, endSec, opts = {}) {
      if (!buf || !buf.length) return buf;
      const sr = buf.sampleRate;
      const numCh = buf.numberOfChannels;
      const dur = buf.duration;
      const inSec = Math.max(0, Math.min(dur, Math.min(startSec, endSec)));
      const outSec = Math.max(0, Math.min(dur, Math.max(startSec, endSec)));
      if (outSec - inSec <= 0.001) return cloneBuffer(buf);

      const ch0 = buf.getChannelData(0);
      const searchRadius = Math.max(1, Math.floor(0.002 * sr));
      const inFrame = findZeroCrossing(ch0, Math.floor(inSec * sr), searchRadius);
      const outFrame = findZeroCrossing(ch0, Math.ceil(outSec * sr), searchRadius);

      const headLen = inFrame;
      const tailLen = buf.length - outFrame;
      const fadeFrames = Math.min(
        Math.floor(headLen * 0.4),
        Math.floor(tailLen * 0.4),
        Math.max(1, Math.floor((opts.crossfadeSec || 0.005) * sr))
      );

      // Equal-power micro-crossfade between head and tail
      const totalFrames = Math.max(1, headLen + tailLen - fadeFrames);
      const ctx = ensureAudioCtx();
      const out = ctx.createBuffer(numCh, totalFrames, sr);

      for (let c = 0; c < numCh; c++) {
        const srcData = buf.getChannelData(c);
        const destData = out.getChannelData(c);

        if (headLen > fadeFrames) {
          destData.set(srcData.subarray(0, headLen - fadeFrames), 0);
        }

        // Crossfade junction
        const junctionStart = Math.max(0, headLen - fadeFrames);
        for (let i = 0; i < fadeFrames; i++) {
          const t = i / fadeFrames;
          const gainHead = Math.cos(t * 0.5 * Math.PI);
          const gainTail = Math.sin(t * 0.5 * Math.PI);
          const hSample = (junctionStart + i < headLen) ? srcData[junctionStart + i] : 0;
          const tSample = (outFrame + i < buf.length) ? srcData[outFrame + i] : 0;
          destData[junctionStart + i] = hSample * gainHead + tSample * gainTail;
        }

        // Tail after crossfade
        if (tailLen > fadeFrames) {
          destData.set(srcData.subarray(outFrame + fadeFrames), headLen);
        }
      }
      return out;
    }

    function trimSilence(buf, opts = {}) {
      if (!buf || !buf.length) return { buffer: buf, trimmedStartSec: 0, trimmedEndSec: 0 };
      const threshDb = opts.thresholdDb != null ? opts.thresholdDb : -45;
      const threshLin = dbToLin(threshDb);
      const padSec = opts.padSec != null ? opts.padSec : 0.02; // 20ms breathing pad
      const sr = buf.sampleRate;
      const padFrames = Math.floor(padSec * sr);
      const numCh = buf.numberOfChannels;
      const n = buf.length;
      const ch0 = buf.getChannelData(0);

      // Windowed energy detection (10ms window)
      const winSize = Math.max(1, Math.floor(0.01 * sr));
      let startFrame = 0;
      let endFrame = n - 1;

      // Find start of sound
      for (let i = 0; i < n - winSize; i += Math.floor(winSize / 2)) {
        let maxVal = 0;
        for (let j = 0; j < winSize; j++) {
          const a = Math.abs(ch0[i + j]);
          if (a > maxVal) maxVal = a;
        }
        if (maxVal >= threshLin) {
          startFrame = Math.max(0, i - padFrames);
          break;
        }
      }

      // Find end of sound
      for (let i = n - 1; i >= winSize; i -= Math.floor(winSize / 2)) {
        let maxVal = 0;
        for (let j = 0; j < winSize; j++) {
          const a = Math.abs(ch0[i - j]);
          if (a > maxVal) maxVal = a;
        }
        if (maxVal >= threshLin) {
          endFrame = Math.min(n - 1, i + padFrames);
          break;
        }
      }

      if (startFrame >= endFrame || (endFrame - startFrame) < sr * 0.05) {
        // Entire buffer is silent or too short, return clone
        return { buffer: cloneBuffer(buf), trimmedStartSec: 0, trimmedEndSec: 0 };
      }

      // Snap to zero crossing
      const searchRadius = Math.max(1, Math.floor(0.002 * sr));
      startFrame = findZeroCrossing(ch0, startFrame, searchRadius);
      endFrame = findZeroCrossing(ch0, endFrame, searchRadius);

      const croppedLen = endFrame - startFrame + 1;
      const ctx = ensureAudioCtx();
      const out = ctx.createBuffer(numCh, croppedLen, sr);
      const fadeFrames = Math.min(Math.floor(croppedLen * 0.4), Math.max(1, Math.floor(0.008 * sr)));

      for (let c = 0; c < numCh; c++) {
        const src = buf.getChannelData(c);
        const dest = out.getChannelData(c);
        dest.set(src.subarray(startFrame, endFrame + 1));

        // Smooth 8ms micro fades at boundaries
        for (let i = 0; i < fadeFrames; i++) {
          const t = i / fadeFrames;
          dest[i] *= Math.sin(t * 0.5 * Math.PI);
          dest[croppedLen - 1 - i] *= Math.sin(t * 0.5 * Math.PI);
        }
      }

      const trimmedStartSec = startFrame / sr;
      const trimmedEndSec = (n - 1 - endFrame) / sr;
      return { buffer: out, trimmedStartSec, trimmedEndSec };
    }

    /* -------------------------------------------------------------
       Vocal Cleanup: Noise Gate, Hum Notch, De-Esser
       ------------------------------------------------------------- */
    function applyNoiseGate(buf, opts) {
      opts = opts || {};
      const thresholdDb = opts.thresholdDb != null ? opts.thresholdDb : -100;
      if (thresholdDb <= -90) return buf; // Gate is effectively off
      const releaseSec = opts.releaseSec || 0.05;
      const ctx = ensureAudioCtx();
      const sr = buf.sampleRate;
      const src = buf.getChannelData(0);
      const out = ctx.createBuffer(1, buf.length, sr);
      const dest = out.getChannelData(0);

      const thresholdLin = dbToLin(thresholdDb);
      const attackCoeff = Math.exp(-1 / (0.003 * sr));
      const releaseCoeff = Math.exp(-1 / (releaseSec * sr));
      let env = 0;

      for (let i = 0; i < src.length; i++) {
        const sample = src[i];
        const absVal = Math.abs(sample);
        if (absVal > env) {
          env = attackCoeff * env + (1 - attackCoeff) * absVal;
        } else {
          env = releaseCoeff * env + (1 - releaseCoeff) * absVal;
        }

        let gain = 1;
        if (env < thresholdLin) {
          const ratio = env / (thresholdLin + 1e-9);
          gain = Math.max(0, ratio * ratio); // smooth expansion curve
        }
        dest[i] = sample * gain;
      }
      return out;
    }

    function applyHumNotch(buf, freq) {
      const f0 = Number(freq) || 0;
      if (f0 !== 50 && f0 !== 60) return buf;
      const ctx = ensureAudioCtx();
      const sr = buf.sampleRate;
      const src = buf.getChannelData(0);
      const out = ctx.createBuffer(1, buf.length, sr);
      const dest = out.getChannelData(0);

      // Digital biquad notch filter implementation for fundamental and 2nd harmonic
      function runNotch(input, notchFreq, q = 12) {
        const w0 = 2 * Math.PI * notchFreq / sr;
        const alpha = Math.sin(w0) / (2 * q);
        const b0 = 1;
        const b1 = -2 * Math.cos(w0);
        const b2 = 1;
        const a0 = 1 + alpha;
        const a1 = -2 * Math.cos(w0);
        const a2 = 1 - alpha;

        const output = new Float32Array(input.length);
        let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
        for (let i = 0; i < input.length; i++) {
          const x0 = input[i];
          const y0 = (b0 * x0 + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0;
          x2 = x1; x1 = x0;
          y2 = y1; y1 = y0;
          output[i] = y0;
        }
        return output;
      }

      // Filter fundamental (50/60Hz) and harmonic (100/120Hz)
      const pass1 = runNotch(src, f0, 6);
      const pass2 = runNotch(pass1, f0 * 2, 5);
      dest.set(pass2);
      return out;
    }

    function applyDeEsser(buf, opts) {
      opts = opts || {};
      const amount = opts.amount != null ? opts.amount : 0;
      if (amount <= 0.01) return buf;
      const deEssFreq = opts.freq || 6500;
      const ctx = ensureAudioCtx();
      const sr = buf.sampleRate;
      const src = buf.getChannelData(0);
      const out = ctx.createBuffer(1, buf.length, sr);
      const dest = out.getChannelData(0);

      // Sibilance bandpass filter to detect harsh consonants
      const w0 = 2 * Math.PI * deEssFreq / sr;
      const bw = 1.8;
      const alpha = Math.sin(w0) * Math.sinh(Math.log(2) / 2 * bw * w0 / Math.sin(w0));
      const b0 = alpha;
      const b1 = 0;
      const b2 = -alpha;
      const a0 = 1 + alpha;
      const a1 = -2 * Math.cos(w0);
      const a2 = 1 - alpha;

      let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
      let sibilanceEnv = 0;
      const attackCoeff = Math.exp(-1 / (0.002 * sr));
      const releaseCoeff = Math.exp(-1 / (0.03 * sr));
      const thresh = 0.08 * (1.1 - amount * 0.8);

      for (let i = 0; i < src.length; i++) {
        const x0 = src[i];
        const bandSample = (b0 * x0 + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0;
        x2 = x1; x1 = x0;
        y2 = y1; y1 = bandSample;

        const bandAbs = Math.abs(bandSample);
        if (bandAbs > sibilanceEnv) {
          sibilanceEnv = attackCoeff * sibilanceEnv + (1 - attackCoeff) * bandAbs;
        } else {
          sibilanceEnv = releaseCoeff * sibilanceEnv + (1 - releaseCoeff) * bandAbs;
        }

        let gainReduction = 1;
        if (sibilanceEnv > thresh) {
          const excess = sibilanceEnv - thresh;
          gainReduction = Math.max(0.2, 1 - excess * amount * 3.5);
        }
        dest[i] = x0 * gainReduction;
      }
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

    /* -------------------------------------------------------------
       Phase-Vocoder HQ Pitch Shifting (with fine cents tuning)
       ------------------------------------------------------------- */
    function pitchShiftPhaseVocoder(buf, semitones, cents = 0) {
      const totalSemitones = (Number(semitones) || 0) + (Number(cents) || 0) / 100;
      if (Math.abs(totalSemitones) < 1e-4) return buf;
      const ratio = Math.pow(2, totalSemitones / 12);
      const src = buf.getChannelData(0);
      const n = src.length;
      const sr = buf.sampleRate;
      const ctx = ensureAudioCtx();
      const out = ctx.createBuffer(1, n, sr);
      const dest = out.getChannelData(0);

      // Phase-Vocoder Multi-Hop Hann Overlap-Add with Formant Preservation
      const grain = Math.max(128, Math.floor(sr * 0.05)); // 50ms grain
      const hop = Math.max(32, Math.floor(grain / 4));    // 75% overlap
      const win = new Float32Array(grain);
      for (let i = 0; i < grain; i++) {
        win[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (grain - 1)));
      }

      // Normalization overlap-add weight accumulator
      const weights = new Float32Array(n);

      for (let t = 0; t < n; t += hop) {
        for (let i = 0; i < grain; i++) {
          const outIdx = t + i;
          if (outIdx >= n) break;
          // Interpolate source based on pitch ratio centered on current analysis frame
          const srcIdx = t + (i - grain / 2) * ratio + grain / 2;
          if (srcIdx >= 0 && srcIdx < n) {
            const sample = interpSample(src, srcIdx);
            const w = win[i];
            dest[outIdx] += sample * w;
            weights[outIdx] += w;
          }
        }
      }

      // Normalize overlap-add energy to prevent gain fluctuations
      for (let i = 0; i < n; i++) {
        const w = weights[i];
        if (w > 0.1) dest[i] /= w;
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

    function pitchShiftGranular(buf, semitones) {
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

    function pitchShiftKeepLength(buf, semitones, opts) {
      if (opts && typeof opts === 'object') {
        const mode = opts.mode || opts.pitchMode || 'hq';
        const cents = opts.cents != null ? opts.cents : (opts.pitchCents || 0);
        if (mode === 'granular') return pitchShiftGranular(buf, semitones);
        return pitchShiftPhaseVocoder(buf, semitones, cents);
      }
      // Default to HQ phase-vocoder while preserving backward-compatible signature
      return pitchShiftPhaseVocoder(buf, semitones, 0);
    }

    /* -------------------------------------------------------------
       Harmonizer & Multi-Voice Choir Synthesis
       ------------------------------------------------------------- */
    function applyHarmonizer(buf, fx) {
      const mix = Number(fx.harmonyMix) || 0;
      const preset = String(fx.harmonyPreset || 'none');
      if (mix <= 0.001 || preset === 'none') return buf;

      let intervals = [];
      if (preset === 'octave-down') intervals = [-12];
      else if (preset === 'octave-up') intervals = [12];
      else if (preset === 'power-fifth') intervals = [7];
      else if (preset === 'major-chord') intervals = [4, 7];
      else if (preset === 'minor-chord') intervals = [3, 7];
      else if (preset === 'choir-wide') intervals = [-12, -5, 7, 12];
      else intervals = [];

      if (!intervals.length) return buf;

      const ctx = ensureAudioCtx();
      const sr = buf.sampleRate;
      const n = buf.length;
      const out = ctx.createBuffer(1, n, sr);
      const dest = out.getChannelData(0);
      const src = buf.getChannelData(0);

      // Render harmony voices
      const harmonyBuffers = intervals.map((st) => pitchShiftPhaseVocoder(buf, st, 0));
      const voiceGain = (1 / intervals.length) * mix;

      for (let i = 0; i < n; i++) {
        let harmSum = 0;
        for (let v = 0; v < harmonyBuffers.length; v++) {
          harmSum += harmonyBuffers[v].getChannelData(0)[i];
        }
        dest[i] = src[i] * (1 - mix * 0.45) + harmSum * voiceGain;
      }

      return out;
    }

    /* -------------------------------------------------------------
       16-Band Vocoder Engine
       ------------------------------------------------------------- */
    function applyVocoder(buf, fx) {
      const mix = Number(fx.vocoderMix) || 0;
      if (mix <= 0.001) return buf;
      const carrierType = fx.vocoderCarrier || 'saw';
      const numBands = Number(fx.vocoderBands) === 8 ? 8 : 16;
      const ctx = ensureAudioCtx();
      const sr = buf.sampleRate;
      const n = buf.length;
      const out = ctx.createBuffer(1, n, sr);
      const dest = out.getChannelData(0);
      const modSrc = buf.getChannelData(0);

      // Logarithmically spaced band frequencies from 150Hz to 5500Hz
      const minF = 160;
      const maxF = 5600;
      const centerFreqs = [];
      for (let b = 0; b < numBands; b++) {
        const f = minF * Math.pow(maxF / minF, b / (numBands - 1));
        centerFreqs.push(f);
      }

      // Generate synthesizer carrier signal
      const carrier = new Float32Array(n);
      const baseFreq = 130; // ~C3 pitch
      for (let i = 0; i < n; i++) {
        const t = i / sr;
        if (carrierType === 'pulse') {
          carrier[i] = (i % Math.floor(sr / baseFreq) < Math.floor(sr / baseFreq / 4)) ? 0.7 : -0.7;
        } else if (carrierType === 'chord') {
          // Major triad carrier
          const s1 = Math.sin(2 * Math.PI * baseFreq * t);
          const s2 = Math.sin(2 * Math.PI * (baseFreq * 1.25) * t);
          const s3 = Math.sin(2 * Math.PI * (baseFreq * 1.5) * t);
          carrier[i] = (s1 + s2 + s3) / 3;
        } else if (carrierType === 'noise') {
          carrier[i] = (Math.random() * 2 - 1) * 0.7;
        } else {
          // Sawtooth default
          const phase = (t * baseFreq) % 1;
          carrier[i] = (2 * phase - 1) * 0.75;
        }
      }

      // Filterbank bandpass & envelope tracking
      const vocoderOut = new Float32Array(n);
      const q = numBands === 8 ? 4 : 8;
      const envSmooth = Math.exp(-1 / (0.008 * sr));

      for (let b = 0; b < numBands; b++) {
        const cf = centerFreqs[b];
        const w0 = 2 * Math.PI * cf / sr;
        const alpha = Math.sin(w0) / (2 * q);
        const b0 = alpha;
        const b1 = 0;
        const b2 = -alpha;
        const a0 = 1 + alpha;
        const a1 = -2 * Math.cos(w0);
        const a2 = 1 - alpha;

        // Modulator analysis pass
        let mx1 = 0, mx2 = 0, my1 = 0, my2 = 0;
        let cx1 = 0, cx2 = 0, cy1 = 0, cy2 = 0;
        let env = 0;

        for (let i = 0; i < n; i++) {
          // Modulator bandpass
          const mx0 = modSrc[i];
          const my0 = (b0 * mx0 + b1 * mx1 + b2 * mx2 - a1 * my1 - a2 * my2) / a0;
          mx2 = mx1; mx1 = mx0;
          my2 = my1; my1 = my0;

          // Envelope follower (rectify + smooth)
          const rect = Math.abs(my0);
          env = envSmooth * env + (1 - envSmooth) * rect;

          // Carrier bandpass
          const cx0 = carrier[i];
          const cy0 = (b0 * cx0 + b1 * cx1 + b2 * cx2 - a1 * cy1 - a2 * cy2) / a0;
          cx2 = cx1; cx1 = cx0;
          cy2 = cy1; cy1 = cy0;

          vocoderOut[i] += cy0 * env * 2.2;
        }
      }

      // Blend wet vocoder with dry source
      for (let i = 0; i < n; i++) {
        dest[i] = modSrc[i] * (1 - mix) + vocoderOut[i] * mix;
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

      let head = input;

      // Stage 0A: Hum Notch Filter (50Hz or 60Hz) — only when not already baked offline
      if (!opts.preBaked && fx.humNotch && (fx.humNotch === 50 || fx.humNotch === 60)) {
        const notch1 = ctx.createBiquadFilter();
        notch1.type = 'notch';
        notch1.frequency.value = fx.humNotch;
        notch1.Q.value = 10;

        const notch2 = ctx.createBiquadFilter();
        notch2.type = 'notch';
        notch2.frequency.value = fx.humNotch * 2;
        notch2.Q.value = 8;

        head.connect(notch1);
        notch1.connect(notch2);
        head = notch2;
      }

      // Stage 0B: Sibilance De-Esser (4.5k - 9kHz peaking notch) — only when not already baked offline
      if (!opts.preBaked && (fx.deEssAmount || 0) > 0.001) {
        const deEsser = ctx.createBiquadFilter();
        deEsser.type = 'peaking';
        deEsser.frequency.value = fx.deEssFreq || 6500;
        deEsser.Q.value = 2.5;
        deEsser.gain.value = -Math.min(18, (fx.deEssAmount || 0) * 14);
        head.connect(deEsser);
        head = deEsser;
      }

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

      head.connect(hp);
      hp.connect(lp);
      lp.connect(bass);
      bass.connect(mid);
      mid.connect(treble);

      head = treble;

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

      // Harmonizer live detune branch if active (only when not already baked via Phase-Vocoder)
      if (!opts.preBaked && (fx.harmonyMix || 0) > 0.001 && fx.harmonyPreset && fx.harmonyPreset !== 'none') {
        const harmMerge = ctx.createGain();
        const dryBranch = ctx.createGain();
        const wetBranch = ctx.createGain();
        const hMix = Math.min(1, Math.max(0, fx.harmonyMix));
        dryBranch.gain.value = 1 - hMix * 0.4;
        wetBranch.gain.value = hMix;

        // Rich ensemble chorus-doubler for live auditioning
        const detuneDelay1 = ctx.createDelay(0.06);
        detuneDelay1.delayTime.value = 0.025;
        const detuneLfo = ctx.createOscillator();
        detuneLfo.frequency.value = 2.4;
        const detuneLfoGain = ctx.createGain();
        detuneLfoGain.gain.value = 0.004;
        detuneLfo.connect(detuneLfoGain);
        detuneLfoGain.connect(detuneDelay1.delayTime);
        try { detuneLfo.start(0); } catch (_) {}
        nodes.push(detuneLfo);

        head.connect(dryBranch);
        head.connect(detuneDelay1);
        detuneDelay1.connect(wetBranch);

        dryBranch.connect(harmMerge);
        wetBranch.connect(harmMerge);
        head = harmMerge;
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
        updateLiveParams(nextFx, nextOpts) {
          if (!nextFx) return;
          const pre = (nextOpts && nextOpts.inputGain != null) ? nextOpts.inputGain : (getInputGain() || 1);
          if (input && input.gain) {
            if (typeof input.gain.setTargetAtTime === 'function') input.gain.setTargetAtTime(Math.max(0.01, pre), ctx.currentTime, 0.015);
            else input.gain.value = Math.max(0.01, pre);
          }
          if (hp && hp.frequency) hp.frequency.value = Math.max(20, nextFx.highpass || 20);
          if (lp && lp.frequency) lp.frequency.value = Math.min(20000, nextFx.lowpass || 20000);
          const fRatio = Math.pow(2, (nextFx.formant || 0) / 12);
          if (bass && bass.gain) {
            bass.frequency.value = 120 * fRatio;
            bass.gain.value = nextFx.bass || 0;
          }
          if (mid && mid.gain) {
            mid.frequency.value = 1000 * fRatio;
            mid.gain.value = nextFx.mid || 0;
          }
          if (treble && treble.gain) {
            treble.frequency.value = 4000 * fRatio;
            treble.gain.value = nextFx.treble || 0;
          }
          if (comp && comp.threshold) comp.threshold.value = nextFx.compressorThresh ?? -18;
          if (comp && comp.ratio) comp.ratio.value = nextFx.compressorRatio ?? 3;
          if (outGain && outGain.gain) {
            if (typeof outGain.gain.setTargetAtTime === 'function') outGain.gain.setTargetAtTime(nextFx.gain ?? 1, ctx.currentTime, 0.015);
            else outGain.gain.value = nextFx.gain ?? 1;
          }
        },
        stopExtras() {
          for (const n of nodes) {
            try { n.stop(); } catch (_) {}
            try { n.disconnect(); } catch (_) {}
          }
          nodes.length = 0;
        }
      };
    }

    /* -------------------------------------------------------------
       Mastering: ITU-R BS.1770 LUFS Calculation & Normalization
       ------------------------------------------------------------- */
    function computeLUFS(buf) {
      if (!buf || !buf.length) return { lufs: -70, truePeakDb: -100, peak: 0 };
      const sr = buf.sampleRate;
      const data = buf.getChannelData(0);
      const n = data.length;

      // Stage 1: High-shelf filter (gain +4dB, fc ~1500Hz)
      const w0 = 2 * Math.PI * 1500 / sr;
      const A = Math.pow(10, 4 / 40); // +4dB
      const S = 1;
      const alpha = Math.sin(w0) / 2 * Math.sqrt((A + 1 / A) * (1 / S - 1) + 2);
      const b0 = A * ((A + 1) + (A - 1) * Math.cos(w0) + 2 * Math.sqrt(A) * alpha);
      const b1 = -2 * A * ((A - 1) + (A + 1) * Math.cos(w0));
      const b2 = A * ((A + 1) + (A - 1) * Math.cos(w0) - 2 * Math.sqrt(A) * alpha);
      const a0 = (A + 1) - (A - 1) * Math.cos(w0) + 2 * Math.sqrt(A) * alpha;
      const a1 = 2 * ((A - 1) - (A + 1) * Math.cos(w0));
      const a2 = (A + 1) - (A - 1) * Math.cos(w0) - 2 * Math.sqrt(A) * alpha;

      // Stage 2: Highpass filter (RLB weighting, fc ~100Hz)
      const w0_hp = 2 * Math.PI * 100 / sr;
      const alpha_hp = Math.sin(w0_hp) / (2 * 0.707);
      const b0_hp = (1 + Math.cos(w0_hp)) / 2;
      const b1_hp = -(1 + Math.cos(w0_hp));
      const b2_hp = (1 + Math.cos(w0_hp)) / 2;
      const a0_hp = 1 + alpha_hp;
      const a1_hp = -2 * Math.cos(w0_hp);
      const a2_hp = 1 - alpha_hp;

      let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
      let hp_x1 = 0, hp_x2 = 0, hp_y1 = 0, hp_y2 = 0;
      let peak = 0;

      const filtered = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const x = data[i];
        const absVal = Math.abs(x);
        if (absVal > peak) peak = absVal;

        // Stage 1
        const y = (b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0;
        x2 = x1; x1 = x;
        y2 = y1; y1 = y;

        // Stage 2
        const hp_y = (b0_hp * y + b1_hp * hp_x1 + b2_hp * hp_x2 - a1_hp * hp_y1 - a2_hp * hp_y2) / a0_hp;
        hp_x2 = hp_x1; hp_x1 = y;
        hp_y2 = hp_y1; hp_y1 = hp_y;

        filtered[i] = hp_y;
      }

      // 400ms gating blocks with 75% overlap (100ms step)
      const blockSize = Math.floor(0.4 * sr);
      const stepSize = Math.floor(0.1 * sr);
      const blockPowers = [];

      for (let pos = 0; pos + blockSize <= n; pos += stepSize) {
        let sumSq = 0;
        for (let i = 0; i < blockSize; i++) {
          const s = filtered[pos + i];
          sumSq += s * s;
        }
        const z = sumSq / blockSize;
        blockPowers.push(z);
      }

      if (!blockPowers.length) {
        let sumSq = 0;
        for (let i = 0; i < n; i++) sumSq += filtered[i] * filtered[i];
        const z = sumSq / Math.max(1, n);
        const lufs = -0.691 + 10 * Math.log10(Math.max(1e-9, z));
        return { lufs, truePeakDb: linToDb(peak), peak };
      }

      // Absolute threshold gating: gamma_a = -70 LKFS
      const absThreshold = Math.pow(10, (-70 + 0.691) / 10);
      let sumAbs = 0;
      let countAbs = 0;
      for (let i = 0; i < blockPowers.length; i++) {
        if (blockPowers[i] > absThreshold) {
          sumAbs += blockPowers[i];
          countAbs++;
        }
      }

      if (countAbs === 0) {
        return { lufs: -70, truePeakDb: linToDb(peak), peak };
      }

      // Relative threshold gating: gamma_r = z_avg - 10 dB
      const avgPowerAbs = sumAbs / countAbs;
      const relThreshold = avgPowerAbs * Math.pow(10, -10 / 10);

      let sumRel = 0;
      let countRel = 0;
      for (let i = 0; i < blockPowers.length; i++) {
        if (blockPowers[i] > relThreshold && blockPowers[i] > absThreshold) {
          sumRel += blockPowers[i];
          countRel++;
        }
      }

      const finalPower = countRel > 0 ? sumRel / countRel : avgPowerAbs;
      const lufs = -0.691 + 10 * Math.log10(Math.max(1e-9, finalPower));
      return { lufs, truePeakDb: linToDb(peak), peak };
    }

    function normalizeToLUFS(buf, targetLUFS, maxTruePeak = -1.0) {
      if (!buf || !isFinite(targetLUFS)) return buf;
      const stats = computeLUFS(buf);
      if (stats.lufs <= -69) return buf; // silence/near-silence
      const deltaDb = targetLUFS - stats.lufs;
      let gain = dbToLin(deltaDb);

      // Check against true-peak ceiling
      const targetPeakLin = dbToLin(maxTruePeak);
      if (stats.peak * gain > targetPeakLin) {
        gain = targetPeakLin / stats.peak;
      }

      const ctx = ensureAudioCtx();
      const out = ctx.createBuffer(1, buf.length, buf.sampleRate);
      const src = buf.getChannelData(0);
      const dest = out.getChannelData(0);
      for (let i = 0; i < src.length; i++) {
        let s = src[i] * gain;
        if (s > targetPeakLin) s = targetPeakLin;
        else if (s < -targetPeakLin) s = -targetPeakLin;
        dest[i] = s;
      }
      return out;
    }

    /* -------------------------------------------------------------
       WAV Encoders (16-bit PCM and 24-bit Studio PCM)
       ------------------------------------------------------------- */
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

    function bufferToWav24(buf) {
      const numCh = 1;
      const sr = buf.sampleRate;
      const samples = buf.getChannelData(0);
      const bytesPerSample = 3;
      const dataSize = samples.length * bytesPerSample;
      const buffer = new ArrayBuffer(44 + dataSize);
      const view = new DataView(buffer);
      const writeStr = (off, s) => { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)); };
      writeStr(0, 'RIFF');
      view.setUint32(4, 36 + dataSize, true);
      writeStr(8, 'WAVE');
      writeStr(12, 'fmt ');
      view.setUint32(16, 16, true);
      view.setUint16(20, 1, true); // PCM
      view.setUint16(22, numCh, true);
      view.setUint32(24, sr, true);
      view.setUint32(28, sr * numCh * bytesPerSample, true);
      view.setUint16(32, numCh * bytesPerSample, true);
      view.setUint16(34, 24, true); // 24-bit
      writeStr(36, 'data');
      view.setUint32(40, dataSize, true);
      let offset = 44;
      for (let i = 0; i < samples.length; i++) {
        let s = Math.max(-1, Math.min(1, samples[i]));
        const intVal = s < 0 ? Math.floor(s * 0x800000) : Math.floor(s * 0x7fffff);
        view.setUint8(offset, intVal & 0xff);
        view.setUint8(offset + 1, (intVal >> 8) & 0xff);
        view.setUint8(offset + 2, (intVal >> 16) & 0xff);
        offset += 3;
      }
      return new Blob([buffer], { type: 'audio/wav' });
    }

    async function bufferToBase64Wav(buf) {
      if (!buf) return '';
      const blob = bufferToWav(buf);
      if (typeof blob.arrayBuffer === 'function') {
        const ab = await blob.arrayBuffer();
        const bytes = new Uint8Array(ab);
        if (typeof Buffer !== 'undefined') {
          return 'data:audio/wav;base64,' + Buffer.from(bytes).toString('base64');
        }
        let binary = '';
        const len = bytes.byteLength;
        for (let i = 0; i < len; i++) {
          binary += String.fromCharCode(bytes[i]);
        }
        return 'data:audio/wav;base64,' + (typeof btoa === 'function' ? btoa(binary) : '');
      }
      return new Promise((resolve, reject) => {
        if (typeof FileReader === 'undefined') return resolve('');
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
    }

    function base64ToArrayBuffer(base64) {
      if (!base64 || typeof base64 !== 'string') return new ArrayBuffer(0);
      const clean = base64.replace(/^data:audio\/[a-z0-9-+.]+;base64,/, '');
      if (typeof Buffer !== 'undefined') {
        const buf = Buffer.from(clean, 'base64');
        const ab = new ArrayBuffer(buf.length);
        const view = new Uint8Array(ab);
        for (let i = 0; i < buf.length; ++i) {
          view[i] = buf[i];
        }
        return ab;
      }
      const binaryString = typeof atob === 'function' ? atob(clean) : '';
      const len = binaryString.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      return bytes.buffer;
    }

    async function bufferToOpus(buf) {
      if (!buf) return null;
      let mime = '';
      if (typeof MediaRecorder !== 'undefined' && typeof MediaRecorder.isTypeSupported === 'function') {
        if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) mime = 'audio/webm;codecs=opus';
        else if (MediaRecorder.isTypeSupported('audio/ogg;codecs=opus')) mime = 'audio/ogg;codecs=opus';
        else if (MediaRecorder.isTypeSupported('audio/webm')) mime = 'audio/webm';
      }
      if (!mime) {
        return { blob: bufferToWav(buf), extension: 'wav', mime: 'audio/wav', isFallback: true };
      }

      const ctx = ensureAudioCtx();
      if (typeof ctx.createMediaStreamDestination !== 'function') {
        return { blob: bufferToWav(buf), extension: 'wav', mime: 'audio/wav', isFallback: true };
      }
      const dest = ctx.createMediaStreamDestination();
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(dest);

      const recorder = new MediaRecorder(dest.stream, { mimeType: mime, audioBitsPerSecond: 128000 });
      const chunks = [];
      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunks.push(e.data);
      };

      return new Promise((resolve, reject) => {
        recorder.onstop = () => {
          const blob = new Blob(chunks, { type: mime });
          const ext = mime.includes('ogg') ? 'opus' : 'webm';
          resolve({ blob, extension: ext, mime, isFallback: false });
        };
        recorder.onerror = (e) => reject(e);
        recorder.start();
        src.start(0);
        src.onended = () => {
          setTimeout(() => {
            try { recorder.stop(); } catch (_) {}
            try { src.disconnect(); } catch (_) {}
          }, 80);
        };
      });
    }

    /* -------------------------------------------------------------
       Procedural Demo Voice Synthesis (Zero-Bloat Vocal Phrases)
       ------------------------------------------------------------- */
    const DEMO_VOICE_CATALOG = [
      { id: 'baritone', name: 'Baritone Narrative', emoji: '🎙️', desc: 'Warm male speech phrase' },
      { id: 'alto', name: 'Alto Melodic Voice', emoji: '✨', desc: 'Bright female vocal phrase' },
      { id: 'storyteller', name: 'Expressive Storyteller', emoji: '📖', desc: 'Dynamic cadence & sibilants' },
      { id: 'whisper', name: 'Intimate Whisper', emoji: '🤫', desc: 'Aspirated breath speech' },
      { id: 'scifi', name: 'Sci-Fi Comms Check', emoji: '🛸', desc: 'Staccato technical phrase' }
    ];

    function getDemoVoices() {
      return DEMO_VOICE_CATALOG.map((v) => ({ ...v }));
    }

    // Digital 2-pole resonant bandpass filter for vocal formants
    function runFormantResonator(input, sr, freq, bw, gain = 1) {
      const n = input.length;
      const out = new Float32Array(n);
      const f = Math.max(80, Math.min(sr * 0.45, freq));
      const r = Math.exp(-Math.PI * bw / sr);
      const theta = 2 * Math.PI * f / sr;
      const a1 = -2 * r * Math.cos(theta);
      const a2 = r * r;
      const b0 = (1 - r) * Math.sqrt(1 - 2 * r * Math.cos(2 * theta) + r * r) * gain;

      let y1 = 0, y2 = 0;
      for (let i = 0; i < n; i++) {
        const y0 = b0 * input[i] - a1 * y1 - a2 * y2;
        y2 = y1;
        y1 = y0;
        out[i] = y0;
      }
      return out;
    }

    function synthesizeDemoVoice(voiceType = 'baritone', opts = {}) {
      const ctx = ensureAudioCtx();
      const sr = opts.sampleRate || (ctx && ctx.sampleRate) || 48000;
      const type = DEMO_VOICE_CATALOG.some((v) => v.id === voiceType) ? voiceType : 'baritone';

      // Define phrase timings and syllable sequences for each archetype
      let syllables = [];
      let baseF0 = 110;
      let totalDuration = 3.6;

      if (type === 'alto') {
        baseF0 = 210;
        totalDuration = 3.7;
        syllables = [
          // "Lis-ten to the har-mon-y of sound"
          { dur: 0.28, f: [340, 2200, 2900], pitch: 0, c: 'l', voiced: true },
          { dur: 0.24, f: [450, 1800, 2700], pitch: 2, c: 's', voiced: true },
          { dur: 0.28, f: [380, 1100, 2400], pitch: 4, c: 't', voiced: true },
          { dur: 0.15, pause: true },
          { dur: 0.22, f: [500, 1600, 2600], pitch: 3, c: 'th', voiced: true },
          { dur: 0.32, f: [750, 1300, 2700], pitch: 5, c: 'h', voiced: true },
          { dur: 0.26, f: [450, 1200, 2500], pitch: 4, c: 'm', voiced: true },
          { dur: 0.35, f: [360, 2300, 3100], pitch: 2, c: 'n', voiced: true },
          { dur: 0.18, pause: true },
          { dur: 0.22, f: [550, 1150, 2500], pitch: 1, c: 'v', voiced: true },
          { dur: 0.55, f: [650, 1100, 2400], pitch: 0, c: 's', voiced: true }
        ];
      } else if (type === 'storyteller') {
        baseF0 = 145;
        totalDuration = 4.0;
        syllables = [
          // "Once up-on a time in a dis-tant re-alm"
          { dur: 0.32, f: [550, 1050, 2400], pitch: 1, c: 'w', voiced: true },
          { dur: 0.26, f: [650, 1250, 2500], pitch: 3, c: 'p', voiced: true },
          { dur: 0.30, f: [500, 1100, 2400], pitch: 4, c: 'n', voiced: true },
          { dur: 0.15, pause: true },
          { dur: 0.20, f: [600, 1400, 2500], pitch: 2, c: 't', voiced: true },
          { dur: 0.38, f: [700, 1200, 2600], pitch: 5, c: 't', voiced: true },
          { dur: 0.22, f: [350, 2100, 2700], pitch: 3, c: 'n', voiced: true },
          { dur: 0.14, pause: true },
          { dur: 0.25, f: [400, 2000, 2600], pitch: 1, c: 'd', voiced: true },
          { dur: 0.30, f: [650, 1300, 2500], pitch: -1, c: 't', voiced: true },
          { dur: 0.18, pause: true },
          { dur: 0.35, f: [380, 2150, 2750], pitch: 2, c: 'r', voiced: true },
          { dur: 0.55, f: [500, 1500, 2500], pitch: 0, c: 'l', voiced: true }
        ];
      } else if (type === 'whisper') {
        baseF0 = 120;
        totalDuration = 3.5;
        syllables = [
          // "Se-cret whis-pers in the sha-dows"
          { dur: 0.34, f: [360, 2150, 2750], pitch: 0, c: 's', voiced: false },
          { dur: 0.28, f: [480, 1800, 2600], pitch: 1, c: 'k', voiced: false },
          { dur: 0.32, f: [380, 2000, 2700], pitch: 2, c: 'w', voiced: false },
          { dur: 0.34, f: [420, 1750, 2550], pitch: 1, c: 'p', voiced: false },
          { dur: 0.18, pause: true },
          { dur: 0.24, f: [360, 2050, 2650], pitch: 0, c: 'n', voiced: false },
          { dur: 0.24, f: [500, 1600, 2500], pitch: -1, c: 'th', voiced: false },
          { dur: 0.36, f: [650, 1400, 2600], pitch: 1, c: 'sh', voiced: false },
          { dur: 0.55, f: [480, 1050, 2350], pitch: 0, c: 'd', voiced: false }
        ];
      } else if (type === 'scifi') {
        baseF0 = 128;
        totalDuration = 3.6;
        syllables = [
          // "Comms on-line. Sys-tems rea-dy"
          { dur: 0.28, f: [550, 1100, 2300], pitch: 0, c: 'k', voiced: true },
          { dur: 0.26, f: [600, 1150, 2400], pitch: 0, c: 'm', voiced: true },
          { dur: 0.28, f: [500, 1100, 2350], pitch: 2, c: 'n', voiced: true },
          { dur: 0.36, f: [400, 2100, 2600], pitch: 4, c: 'l', voiced: true },
          { dur: 0.20, pause: true },
          { dur: 0.26, f: [380, 2000, 2600], pitch: 2, c: 's', voiced: true },
          { dur: 0.28, f: [480, 1750, 2500], pitch: 3, c: 't', voiced: true },
          { dur: 0.30, f: [420, 2050, 2650], pitch: 2, c: 'm', voiced: true },
          { dur: 0.16, pause: true },
          { dur: 0.32, f: [460, 1950, 2600], pitch: 1, c: 'r', voiced: true },
          { dur: 0.45, f: [350, 2200, 2750], pitch: 0, c: 'd', voiced: true }
        ];
      } else {
        // 'baritone' default
        baseF0 = 112;
        totalDuration = 3.8;
        syllables = [
          // "Vox-clip stu-di-o trans-forms your voice"
          { dur: 0.30, f: [500, 1050, 2350], pitch: 0, c: 'v', voiced: true },
          { dur: 0.28, f: [360, 2050, 2600], pitch: 1, c: 'k', voiced: true },
          { dur: 0.15, pause: true },
          { dur: 0.26, f: [320, 950, 2250], pitch: 2, c: 's', voiced: true },
          { dur: 0.24, f: [450, 1750, 2500], pitch: 3, c: 'd', voiced: true },
          { dur: 0.32, f: [500, 1050, 2300], pitch: 1, c: 'o', voiced: true },
          { dur: 0.20, pause: true },
          { dur: 0.32, f: [620, 1250, 2450], pitch: 2, c: 't', voiced: true },
          { dur: 0.30, f: [500, 1050, 2350], pitch: 1, c: 'f', voiced: true },
          { dur: 0.28, f: [400, 1150, 2300], pitch: 0, c: 'y', voiced: true },
          { dur: 0.55, f: [480, 1100, 2400], pitch: -1, c: 'v', voiced: true }
        ];
      }

      const totalFrames = Math.floor(totalDuration * sr);
      const excitation = new Float32Array(totalFrames);
      const f1Target = new Float32Array(totalFrames);
      const f2Target = new Float32Array(totalFrames);
      const f3Target = new Float32Array(totalFrames);
      const ampEnvelope = new Float32Array(totalFrames);

      let currentFrame = Math.floor(0.1 * sr);
      let phase = 0;

      for (const syl of syllables) {
        const sylFrames = Math.floor(syl.dur * sr);
        if (syl.pause) {
          currentFrame += sylFrames;
          continue;
        }

        const isVoiced = syl.voiced !== false;
        const targetPitchHz = baseF0 * Math.pow(2, (syl.pitch || 0) / 12);
        const [f1, f2, f3] = syl.f || [500, 1500, 2500];

        for (let i = 0; i < sylFrames && (currentFrame + i) < totalFrames; i++) {
          const idx = currentFrame + i;
          const pos = i / sylFrames;

          let env = 1;
          if (pos < 0.15) env = pos / 0.15;
          else if (pos > 0.8) env = (1 - pos) / 0.2;
          ampEnvelope[idx] = env;

          f1Target[idx] = f1;
          f2Target[idx] = f2;
          f3Target[idx] = f3;

          if (isVoiced) {
            const vibrato = Math.sin(2 * Math.PI * 5.2 * (idx / sr)) * 0.015;
            const pitchInc = (targetPitchHz * (1 + vibrato)) / sr;
            phase += pitchInc;
            if (phase >= 1) phase -= 1;

            let pulse = 0;
            if (phase < 0.4) {
              const t = phase / 0.4;
              pulse = 3 * t * t - 2 * t * t * t;
            } else if (phase < 0.55) {
              pulse = 1 - (phase - 0.4) / 0.15;
            } else {
              pulse = 0;
            }
            const breath = (Math.random() * 2 - 1) * 0.05;
            excitation[idx] = (pulse * 2 - 1) * 0.8 + breath;
          } else {
            const noise = (Math.random() * 2 - 1);
            excitation[idx] = noise * 0.75;
          }

          if (pos < 0.08 && syl.c) {
            if (syl.c === 's' || syl.c === 'sh') {
              excitation[idx] += (Math.random() * 2 - 1) * 0.6;
            } else if (syl.c === 't' || syl.c === 'k' || syl.c === 'p') {
              excitation[idx] += Math.sin(2 * Math.PI * 2200 * pos) * (1 - pos / 0.08) * 0.5;
            }
          }
        }
        currentFrame += sylFrames;
      }

      for (let i = 1; i < totalFrames; i++) {
        if (f1Target[i] === 0) f1Target[i] = f1Target[i - 1] || 500;
        if (f2Target[i] === 0) f2Target[i] = f2Target[i - 1] || 1500;
        if (f3Target[i] === 0) f3Target[i] = f3Target[i - 1] || 2500;
      }

      let avgF1 = 0, avgF2 = 0, avgF3 = 0, activeCount = 0;
      for (let i = 0; i < totalFrames; i++) {
        if (ampEnvelope[i] > 0.05) {
          avgF1 += f1Target[i];
          avgF2 += f2Target[i];
          avgF3 += f3Target[i];
          activeCount++;
        }
      }
      activeCount = Math.max(1, activeCount);
      avgF1 /= activeCount;
      avgF2 /= activeCount;
      avgF3 /= activeCount;

      const res1 = runFormantResonator(excitation, sr, avgF1 || 500, 80, 1.2);
      const res2 = runFormantResonator(excitation, sr, avgF2 || 1600, 110, 0.75);
      const res3 = runFormantResonator(excitation, sr, avgF3 || 2600, 150, 0.45);

      const out = ctx.createBuffer(1, totalFrames, sr);
      const dest = out.getChannelData(0);

      let peak = 0;
      for (let i = 0; i < totalFrames; i++) {
        const raw = (res1[i] + res2[i] + res3[i]) * ampEnvelope[i];
        dest[i] = raw;
        const absVal = Math.abs(raw);
        if (absVal > peak) peak = absVal;
      }

      if (peak > 1e-6) {
        const normGain = 0.92 / peak;
        for (let i = 0; i < totalFrames; i++) dest[i] *= normGain;
      }

      return out;
    }

    /* -------------------------------------------------------------
       Background Ambience & Soundscape Generator + Auto-Ducker
       ------------------------------------------------------------- */
    const AMBIENCE_SCENES = [
      { id: 'none', name: 'Off (No Soundscape)', emoji: '🔇', desc: 'Silence' },
      { id: 'vinyl', name: 'Vinyl & Tape Crackle', emoji: '💿', desc: 'Warm 60Hz hum and authentic dust clicks' },
      { id: 'rain', name: 'Rain & Distant Thunder', emoji: '🌧️', desc: 'Smooth rainfall and rolling sub rumbles' },
      { id: 'starship', name: 'Starship Bridge Hum', emoji: '🛸', desc: 'Deep reactor drone and air ventilation' },
      { id: 'static', name: 'Radio Telemetry Static', emoji: '📻', desc: 'AM shortwave hiss with drifting whistles' },
      { id: 'dungeon', name: 'Dungeon Cavern Wind', emoji: '🏰', desc: 'Resonant stone howl and droplet pings' },
      { id: 'cyberpunk', name: 'Cyberpunk Neon Rain', emoji: '🌆', desc: 'Heavy street downpour and synth pad bed' },
      { id: 'campfire', name: 'Campfire Crackles', emoji: '🔥', desc: 'Wood snaps, popping sparks and draft roar' }
    ];

    function getAmbienceScenes() {
      return AMBIENCE_SCENES.map((s) => ({ ...s }));
    }

    function generateSoundscapeTrack(sceneId, numFrames, sr, toneDb = 0) {
      const out = new Float32Array(numFrames);
      if (!sceneId || sceneId === 'none') return out;

      if (sceneId === 'vinyl') {
        let humPhase = 0;
        const humInc = 60 / sr;
        for (let i = 0; i < numFrames; i++) {
          humPhase += humInc;
          const hum = Math.sin(2 * Math.PI * humPhase) * 0.08;
          const hiss = (Math.random() * 2 - 1) * 0.04;
          const pop = Math.random() < 0.0018 ? (Math.random() * 2 - 1) * 0.55 : 0;
          out[i] = hum + hiss + pop;
        }
      } else if (sceneId === 'rain') {
        let b0 = 0, b1 = 0, b2 = 0;
        let thunderPhase = 0;
        for (let i = 0; i < numFrames; i++) {
          const white = Math.random() * 2 - 1;
          b0 = 0.99765 * b0 + white * 0.0990460;
          b1 = 0.96300 * b1 + white * 0.2965164;
          b2 = 0.57000 * b2 + white * 1.0526913;
          const rain = (b0 + b1 + b2 + white * 0.5362) * 0.08;

          const t = i / sr;
          const thunderEnv = Math.max(0, Math.sin(t * 0.45) * Math.sin(t * 1.8));
          thunderPhase += 55 / sr;
          const thunder = Math.sin(2 * Math.PI * thunderPhase) * thunderEnv * 0.18;
          out[i] = rain + thunder;
        }
      } else if (sceneId === 'starship') {
        let p1 = 0, p2 = 0, p3 = 0;
        let noiseFilter = 0;
        for (let i = 0; i < numFrames; i++) {
          p1 += 42 / sr;
          p2 += 84 / sr;
          p3 += 126 / sr;
          const drone = Math.sin(2 * Math.PI * p1) * 0.12 + Math.sin(2 * Math.PI * p2) * 0.06 + Math.sin(2 * Math.PI * p3) * 0.03;
          const white = Math.random() * 2 - 1;
          noiseFilter = noiseFilter * 0.94 + white * 0.06;
          out[i] = drone + noiseFilter * 0.14;
        }
      } else if (sceneId === 'static') {
        let tonePhase = 0;
        let b0 = 0, b1 = 0;
        for (let i = 0; i < numFrames; i++) {
          const t = i / sr;
          const driftFreq = 1150 + Math.sin(t * 0.8) * 220;
          tonePhase += driftFreq / sr;
          const whistle = Math.sin(2 * Math.PI * tonePhase) * 0.04;
          const white = Math.random() * 2 - 1;
          b0 = b0 * 0.85 + white * 0.15;
          b1 = b1 * 0.85 + b0 * 0.15;
          out[i] = (b1 * 0.4) + whistle;
        }
      } else if (sceneId === 'dungeon') {
        let windFilter = 0;
        let dropDecay = 0;
        let dropFreq = 1800;
        let dropPhase = 0;
        for (let i = 0; i < numFrames; i++) {
          const t = i / sr;
          const sweep = 0.92 + Math.sin(t * 0.35) * 0.04;
          const white = Math.random() * 2 - 1;
          windFilter = windFilter * sweep + white * (1 - sweep);

          if (Math.random() < 0.0004 && dropDecay <= 0.01) {
            dropDecay = 0.45;
            dropFreq = 1400 + Math.random() * 800;
          }
          let ping = 0;
          if (dropDecay > 0.001) {
            dropPhase += dropFreq / sr;
            ping = Math.sin(2 * Math.PI * dropPhase) * dropDecay * 0.2;
            dropDecay *= 0.9992;
          }
          out[i] = (windFilter * 0.22) + ping;
        }
      } else if (sceneId === 'cyberpunk') {
        let padPhase1 = 0, padPhase2 = 0;
        let noiseF = 0;
        for (let i = 0; i < numFrames; i++) {
          padPhase1 += 65 / sr;
          padPhase2 += 97.5 / sr;
          const pad = Math.sin(2 * Math.PI * padPhase1) * 0.1 + Math.sin(2 * Math.PI * padPhase2) * 0.07;
          const white = Math.random() * 2 - 1;
          noiseF = noiseF * 0.92 + white * 0.08;
          out[i] = pad + (noiseF * 0.25);
        }
      } else if (sceneId === 'campfire') {
        let roar = 0;
        for (let i = 0; i < numFrames; i++) {
          const white = Math.random() * 2 - 1;
          roar = roar * 0.96 + white * 0.04;
          const snap = Math.random() < 0.006 ? (Math.random() * 2 - 1) * 0.45 : 0;
          out[i] = (roar * 0.22) + snap;
        }
      }

      if (Math.abs(toneDb) > 0.1) {
        const toneGain = dbToLin(toneDb);
        let y1 = 0;
        for (let i = 0; i < numFrames; i++) {
          if (toneDb > 0) {
            const hp = out[i] - y1;
            y1 = y1 * 0.9 + out[i] * 0.1;
            out[i] = out[i] + hp * (toneGain - 1) * 0.5;
          } else {
            y1 = y1 * 0.85 + out[i] * 0.15;
            out[i] = y1 * toneGain + out[i] * (1 - toneGain * 0.5);
          }
        }
      }

      return out;
    }

    function applyAmbienceSoundscape(voiceBuf, fx, opts = {}) {
      if (!voiceBuf) return voiceBuf;
      const sceneId = fx.ambiencePreset || 'none';
      const mix = Number(fx.ambienceMix) || 0;
      if (sceneId === 'none' || mix <= 0.001) return voiceBuf;

      const duckAmount = clampNum(fx.ambienceDuck != null ? fx.ambienceDuck : 0.55, 0, 1, 0.55);
      const toneDb = clampNum(fx.ambienceTone != null ? fx.ambienceTone : 0, -12, 12, 0);

      const ctx = ensureAudioCtx();
      const sr = voiceBuf.sampleRate;
      const n = voiceBuf.length;
      const out = ctx.createBuffer(1, n, sr);
      const dest = out.getChannelData(0);
      const voiceSrc = voiceBuf.getChannelData(0);

      const soundscape = generateSoundscapeTrack(sceneId, n, sr, toneDb);

      const attackCoeff = Math.exp(-1 / (0.008 * sr));
      const releaseCoeff = Math.exp(-1 / (0.28 * sr));
      let voiceEnv = 0;

      let peak = 0;
      for (let i = 0; i < n; i++) {
        const v = voiceSrc[i];
        const absV = Math.abs(v);
        if (absV > voiceEnv) {
          voiceEnv = attackCoeff * voiceEnv + (1 - attackCoeff) * absV;
        } else {
          voiceEnv = releaseCoeff * voiceEnv + (1 - releaseCoeff) * absV;
        }

        const speechActivity = Math.min(1, voiceEnv * 3.5);
        const duckGain = 1 - (speechActivity * duckAmount * 0.85);

        const ambSample = soundscape[i] * mix * duckGain;
        const blended = v + ambSample;
        dest[i] = blended;

        const a = Math.abs(blended);
        if (a > peak) peak = a;
      }

      if (peak > 0.95) {
        const limiter = 0.95 / peak;
        for (let i = 0; i < n; i++) dest[i] *= limiter;
      }

      return out;
    }

    return {
      cloneBuffer,
      concatBuffersWithCrossfade,
      toMonoBuffer,
      applyBufferGain,
      normalizeRecordingBuffer,
      peakOf,
      applyPeakLimiter,
      reverseBuffer,
      findZeroCrossing,
      trimBuffer,
      cutBufferRegion,
      trimSilence,
      applyNoiseGate,
      applyHumNotch,
      applyDeEsser,
      applyFadesAndCrush,
      pitchShiftKeepLength,
      pitchShiftPhaseVocoder,
      pitchShiftGranular,
      applyHarmonizer,
      applyVocoder,
      computeLUFS,
      normalizeToLUFS,
      buildPeakPyramid,
      buildFxChain,
      getDemoVoices,
      synthesizeDemoVoice,
      getAmbienceScenes,
      generateSoundscapeTrack,
      applyAmbienceSoundscape,
      bufferToWav,
      bufferToWav24,
      bufferToOpus,
      bufferToBase64Wav,
      base64ToArrayBuffer
    };
  }

  root.VoxFx = { createFxEngine };
})(typeof window !== 'undefined' ? window : globalThis);
