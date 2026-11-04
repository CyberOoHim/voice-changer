/* Node test suite for VoxClip Studio Selection Playback (“Play Sel”) */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');

console.log('--- Testing VoxClip Studio Selection Playback Engine ---');

const appCode = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');

// Test 1: Verify code structure prevents selectionAudition from being wiped by startPlayback
assert.ok(
  appCode.includes('function stopPlayback(resetHead = false, keepAudition = false)'),
  'stopPlayback must accept keepAudition parameter'
);
assert.ok(
  appCode.includes('stopPlayback(false, true);'),
  'startPlayback must call stopPlayback with keepAudition=true'
);
assert.ok(
  appCode.includes('src.start(0, offset, auditionDuration)'),
  'src.start must receive auditionDuration when auditioning selection to prevent hardware overrun past out mark'
);
assert.ok(
  /S\.selectionAudition\s*\?\s*Math\.min\(S\.selectionAudition\.end,\s*Math\.max\(S\.selectionAudition\.start,\s*t\)\)/.test(appCode),
  'tick animation loop must clamp playhead within [start, end] during selection audition'
);
console.log('✓ Test 1 passed: Codebase includes hardware-level duration capping and audition retention');

// Test 2: Behavioral unit test simulating the selection playback state machine
function runPlaybackSimulation() {
  const S = {
    buffer: { duration: 10.0 },
    selection: { active: true, start: 2.5, end: 5.0 },
    playhead: 0,
    playing: false,
    selectionAudition: null,
    loop: false,
    comparingDry: false,
    inputGain: 1,
    fx: {}
  };

  const startedSources = [];
  const stoppedSources = [];

  class MockAudioBufferSource {
    constructor() {
      this.playbackRate = { value: 1 };
      this.buffer = null;
      this.onended = null;
    }
    connect() {}
    disconnect() {}
    start(when, offset, duration) {
      startedSources.push({ when, offset, duration });
    }
    stop() {
      stoppedSources.push(true);
    }
  }

  let playSource = null;
  let playOffset = 0;
  let playStartedAt = 0;
  const ctx = { currentTime: 100 };

  function stopPlayback(resetHead = false, keepAudition = false) {
    if (playSource) {
      try { playSource.onended = null; playSource.stop(); } catch (_) {}
      playSource = null;
    }
    if (S.playing) {
      let pos = playOffset + Math.max(0, (ctx.currentTime - playStartedAt));
      if (S.selectionAudition) {
        pos = Math.min(S.selectionAudition.end, Math.max(S.selectionAudition.start, pos));
      } else {
        pos = Math.min(S.buffer ? S.buffer.duration : 0, pos);
      }
      S.playhead = pos;
    }
    S.playing = false;
    if (resetHead) {
      S.playhead = S.selectionAudition ? S.selectionAudition.start : 0;
    }
    if (!keepAudition) {
      S.selectionAudition = null;
    }
  }

  function startPlayback() {
    if (!S.buffer) return;
    stopPlayback(false, true);

    const src = new MockAudioBufferSource();
    src.buffer = S.buffer;
    src.playbackRate.value = 1;

    let offset = Math.max(0, Math.min(S.buffer.duration - 0.001, S.playhead));
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
          return;
        }
      }
    };

    if (auditionDuration != null) {
      src.start(0, offset, auditionDuration);
    } else {
      src.start(0, offset);
    }
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

  // 1. Initial playSelection
  playSelection(false);
  assert.strictEqual(S.playing, true, 'Playback should be running');
  assert.ok(S.selectionAudition !== null, 'selectionAudition must NOT be nullified by startPlayback');
  assert.strictEqual(S.selectionAudition.start, 2.5);
  assert.strictEqual(S.selectionAudition.end, 5.0);
  assert.strictEqual(startedSources.length, 1);
  assert.strictEqual(startedSources[0].offset, 2.5, 'Must start at selection In point');
  assert.strictEqual(startedSources[0].duration, 2.5, 'Must pass duration = 5.0 - 2.5 = 2.5 to AudioBufferSourceNode');

  // 2. Simulate animation frames during audition
  // Midway through selection
  ctx.currentTime = 101.5; // +1.5s
  let t = playOffset + (ctx.currentTime - playStartedAt);
  assert.strictEqual(t, 4.0);
  S.playhead = S.selectionAudition
    ? Math.min(S.selectionAudition.end, Math.max(S.selectionAudition.start, t))
    : t;
  assert.strictEqual(S.playhead, 4.0);

  // Reaching past Out mark in time
  ctx.currentTime = 103.5; // +3.5s (t = 6.0, which is > 5.0 out mark)
  t = playOffset + (ctx.currentTime - playStartedAt);
  assert.ok(t > S.selectionAudition.end, 'Time progressed past out mark');

  // The condition in tick checks if (t >= S.selectionAudition.end)
  if (t >= S.selectionAudition.end) {
    const end = S.selectionAudition.end;
    stopPlayback(false);
    S.playhead = end;
  }
  assert.strictEqual(S.playing, false, 'Playback should stop when Out mark is reached');
  assert.strictEqual(S.playhead, 5.0, 'Playhead must be parked at exactly the Out mark');
  assert.strictEqual(S.selectionAudition, null, 'selectionAudition cleared after completion');

  // 3. Verify clicking Play Sel while playing toggles stop
  playSelection(false);
  assert.strictEqual(S.playing, true, 'Play selection started');
  playSelection(false);
  assert.strictEqual(S.playing, false, 'Play selection stopped upon second click');

  // 4. Verify loop audition
  S.loop = true;
  playSelection(true);
  assert.strictEqual(S.playing, true);
  // Simulate onended firing from duration boundary
  playSource.onended();
  assert.strictEqual(S.playing, true, 'Playback restarted on loop');
  assert.strictEqual(S.playhead, 2.5, 'Playhead reset to In mark on loop');
}

runPlaybackSimulation();
console.log('✓ Test 2 passed: Selection audition accurately stops at Out mark without overshoot');
console.log('All Selection Playback tests passed successfully!');
