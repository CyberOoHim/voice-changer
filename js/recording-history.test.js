/* Node test suite for Recording History (FIFO, max 10, Undo/Redo) */
'use strict';
const assert = require('assert');

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
  return {
    sampleRate: 48000,
    createBuffer: (c, l, s) => new FakeBuffer(c, l, s)
  };
}

const ctx = fakeCtx();
function cloneBuffer(src) {
  const out = ctx.createBuffer(src.numberOfChannels, src.length, src.sampleRate);
  for (let c = 0; c < src.numberOfChannels; c++) {
    out.copyToChannel(src.getChannelData(c), c);
  }
  return out;
}

// Simulates the recording history manager implemented in app.js
function createRecordingHistoryManager(maxCapacity = 10) {
  let recordHistory = [];
  let recordHistoryIndex = -1;
  let takeCounter = 0;

  function pushRecordTake(buf, meta = {}) {
    if (!buf) return;
    takeCounter++;
    // Prune redo future if not at latest take
    if (recordHistoryIndex >= 0 && recordHistoryIndex < recordHistory.length - 1) {
      recordHistory = recordHistory.slice(0, recordHistoryIndex + 1);
    }
    const takeName = meta.name || ('Take ' + takeCounter);
    const entry = {
      id: 'take_' + takeCounter,
      name: takeName,
      buffer: cloneBuffer(buf),
      duration: buf.duration,
      sampleRate: buf.sampleRate,
      createdAt: Date.now()
    };
    recordHistory.push(entry);
    // FIFO eviction: drop oldest take when exceeding max capacity
    while (recordHistory.length > maxCapacity) {
      recordHistory.shift();
    }
    recordHistoryIndex = recordHistory.length - 1;
  }

  function canUndo() {
    return recordHistoryIndex > 0;
  }

  function canRedo() {
    return recordHistoryIndex >= 0 && recordHistoryIndex < recordHistory.length - 1;
  }

  function undo() {
    if (!canUndo() || !recordHistory.length) return null;
    recordHistoryIndex--;
    const target = recordHistory[recordHistoryIndex];
    return target ? cloneBuffer(target.buffer) : null;
  }

  function redo() {
    if (!canRedo() || !recordHistory.length) return null;
    recordHistoryIndex++;
    const target = recordHistory[recordHistoryIndex];
    return target ? cloneBuffer(target.buffer) : null;
  }

  function getCurrentTake() {
    if (recordHistoryIndex < 0 || recordHistoryIndex >= recordHistory.length) return null;
    return recordHistory[recordHistoryIndex];
  }

  function clear() {
    recordHistory = [];
    recordHistoryIndex = -1;
    takeCounter = 0;
  }

  function getHistory() {
    return recordHistory;
  }

  function deleteCurrentRecord() {
    if (recordHistoryIndex < 0 || recordHistoryIndex >= recordHistory.length || !recordHistory.length) return null;
    const deleted = recordHistory[recordHistoryIndex];
    recordHistory.splice(recordHistoryIndex, 1);
    if (recordHistory.length > 0) {
      if (recordHistoryIndex >= recordHistory.length) {
        recordHistoryIndex = recordHistory.length - 1;
      }
      return cloneBuffer(recordHistory[recordHistoryIndex].buffer);
    } else {
      recordHistoryIndex = -1;
      return null;
    }
  }

  function getIndex() {
    return recordHistoryIndex;
  }

  return {
    pushRecordTake,
    canUndo,
    canRedo,
    undo,
    redo,
    deleteCurrentRecord,
    getCurrentTake,
    clear,
    getHistory,
    getIndex
  };
}

// Test 1: Single take
{
  const mgr = createRecordingHistoryManager(10);
  const buf1 = ctx.createBuffer(1, 4800, 48000);
  buf1.getChannelData(0)[0] = 0.5;
  mgr.pushRecordTake(buf1);

  assert.strictEqual(mgr.getHistory().length, 1);
  assert.strictEqual(mgr.getIndex(), 0);
  assert.strictEqual(mgr.canUndo(), false, 'Single take cannot undo');
  assert.strictEqual(mgr.canRedo(), false, 'Single take cannot redo');
  assert.strictEqual(mgr.getCurrentTake().name, 'Take 1');
  console.log('✓ Test 1 passed: Single take state');
}

// Test 2: Multiple takes and Undo/Redo
{
  const mgr = createRecordingHistoryManager(10);
  for (let i = 1; i <= 3; i++) {
    const b = ctx.createBuffer(1, 4800, 48000);
    b.getChannelData(0)[0] = i * 0.1;
    mgr.pushRecordTake(b, { name: 'Take ' + i });
  }

  assert.strictEqual(mgr.getHistory().length, 3);
  assert.strictEqual(mgr.getIndex(), 2);
  assert.strictEqual(mgr.canUndo(), true);
  assert.strictEqual(mgr.canRedo(), false);
  assert.strictEqual(mgr.getCurrentTake().name, 'Take 3');

  // Undo 1
  const restored2 = mgr.undo();
  assert.strictEqual(mgr.getIndex(), 1);
  assert.strictEqual(mgr.getCurrentTake().name, 'Take 2');
  assert.strictEqual(mgr.canUndo(), true);
  assert.strictEqual(mgr.canRedo(), true);
  assert.ok(Math.abs(restored2.getChannelData(0)[0] - 0.2) < 1e-6);

  // Undo 2
  const restored1 = mgr.undo();
  assert.strictEqual(mgr.getIndex(), 0);
  assert.strictEqual(mgr.getCurrentTake().name, 'Take 1');
  assert.strictEqual(mgr.canUndo(), false);
  assert.strictEqual(mgr.canRedo(), true);
  assert.ok(Math.abs(restored1.getChannelData(0)[0] - 0.1) < 1e-6);

  // Cannot undo past 0
  assert.strictEqual(mgr.undo(), null);
  assert.strictEqual(mgr.getIndex(), 0);

  // Redo 1
  const redo2 = mgr.redo();
  assert.strictEqual(mgr.getIndex(), 1);
  assert.strictEqual(mgr.getCurrentTake().name, 'Take 2');
  assert.strictEqual(mgr.canUndo(), true);
  assert.strictEqual(mgr.canRedo(), true);

  // Redo 2
  const redo3 = mgr.redo();
  assert.strictEqual(mgr.getIndex(), 2);
  assert.strictEqual(mgr.getCurrentTake().name, 'Take 3');
  assert.strictEqual(mgr.canUndo(), true);
  assert.strictEqual(mgr.canRedo(), false);

  // Cannot redo past head
  assert.strictEqual(mgr.redo(), null);
  console.log('✓ Test 2 passed: Multiple takes navigation');
}

// Test 3: Branching (recording after undo truncates future redo)
{
  const mgr = createRecordingHistoryManager(10);
  for (let i = 1; i <= 3; i++) {
    const b = ctx.createBuffer(1, 4800, 48000);
    b.getChannelData(0)[0] = i * 0.1;
    mgr.pushRecordTake(b, { name: 'Take ' + i });
  }

  // Undo to Take 2
  mgr.undo();
  assert.strictEqual(mgr.getCurrentTake().name, 'Take 2');

  // Push new Take 4
  const b4 = ctx.createBuffer(1, 4800, 48000);
  b4.getChannelData(0)[0] = 0.4;
  mgr.pushRecordTake(b4, { name: 'Take 4' });

  assert.strictEqual(mgr.getHistory().length, 3); // Take 1, Take 2, Take 4 (Take 3 was discarded)
  assert.strictEqual(mgr.getIndex(), 2);
  assert.strictEqual(mgr.getCurrentTake().name, 'Take 4');
  assert.strictEqual(mgr.canRedo(), false);

  mgr.undo();
  assert.strictEqual(mgr.getCurrentTake().name, 'Take 2');
  mgr.undo();
  assert.strictEqual(mgr.getCurrentTake().name, 'Take 1');
  console.log('✓ Test 3 passed: Branching truncation');
}

// Test 4: FIFO Buffer Cap (max 10 takes)
{
  const mgr = createRecordingHistoryManager(10);
  for (let i = 1; i <= 15; i++) {
    const b = ctx.createBuffer(1, 4800, 48000);
    b.getChannelData(0)[0] = i;
    mgr.pushRecordTake(b, { name: 'Take ' + i });
    assert.ok(mgr.getHistory().length <= 10, 'Queue length must never exceed 10');
  }

  assert.strictEqual(mgr.getHistory().length, 10);
  assert.strictEqual(mgr.getIndex(), 9);
  assert.strictEqual(mgr.getCurrentTake().name, 'Take 15');

  // Verify that the oldest 5 takes (Take 1..5) were evicted FIFO and oldest kept is Take 6
  assert.strictEqual(mgr.getHistory()[0].name, 'Take 6');
  assert.strictEqual(mgr.getHistory()[9].name, 'Take 15');

  // Undo back to the oldest retained take (Take 6)
  for (let step = 0; step < 9; step++) {
    assert.strictEqual(mgr.canUndo(), true);
    mgr.undo();
  }
  assert.strictEqual(mgr.getIndex(), 0);
  assert.strictEqual(mgr.getCurrentTake().name, 'Take 6');
  assert.strictEqual(mgr.canUndo(), false);
  console.log('✓ Test 4 passed: FIFO buffer cap (max 10 takes)');
}

// Test 5: AudioBuffer clone isolation
{
  const mgr = createRecordingHistoryManager(10);
  const b = ctx.createBuffer(1, 4800, 48000);
  b.getChannelData(0)[0] = 0.42;
  mgr.pushRecordTake(b, { name: 'Take 1' });

  // Mutate working buffer b
  b.getChannelData(0)[0] = 0.99;

  // History copy must remain 0.42
  const snap = mgr.getCurrentTake().buffer;
  assert.ok(Math.abs(snap.getChannelData(0)[0] - 0.42) < 1e-5, 'Snapshot buffer must be isolated from mutations');
  console.log('✓ Test 5 passed: Clone isolation');
}

// Test 6: Clear / Reset
{
  const mgr = createRecordingHistoryManager(10);
  const b = ctx.createBuffer(1, 4800, 48000);
  mgr.pushRecordTake(b);
  mgr.pushRecordTake(b);
  mgr.clear();

  assert.strictEqual(mgr.getHistory().length, 0);
  assert.strictEqual(mgr.getIndex(), -1);
  assert.strictEqual(mgr.canUndo(), false);
  assert.strictEqual(mgr.canRedo(), false);
  assert.strictEqual(mgr.getCurrentTake(), null);
  console.log('✓ Test 6 passed: Clear history');
}

// Test 7: Delete single take (permanently emptied)
{
  const mgr = createRecordingHistoryManager(10);
  const b = ctx.createBuffer(1, 4800, 48000);
  mgr.pushRecordTake(b, { name: 'Take 1' });
  assert.strictEqual(mgr.getHistory().length, 1);

  const res = mgr.deleteCurrentRecord();
  assert.strictEqual(res, null);
  assert.strictEqual(mgr.getHistory().length, 0);
  assert.strictEqual(mgr.getIndex(), -1);
  assert.strictEqual(mgr.canUndo(), false);
  assert.strictEqual(mgr.canRedo(), false);
  assert.strictEqual(mgr.getCurrentTake(), null);
  console.log('✓ Test 7 passed: Delete single take');
}

// Test 8: Delete middle take from multiple takes (not in undo/redo anymore)
{
  const mgr = createRecordingHistoryManager(10);
  for (let i = 1; i <= 3; i++) {
    const b = ctx.createBuffer(1, 4800, 48000);
    b.getChannelData(0)[0] = i;
    mgr.pushRecordTake(b, { name: 'Take ' + i });
  }

  // Active is Take 3 (index 2). Undo to Take 2 (index 1).
  mgr.undo();
  assert.strictEqual(mgr.getCurrentTake().name, 'Take 2');
  assert.strictEqual(mgr.getIndex(), 1);

  // Permanently delete Take 2
  mgr.deleteCurrentRecord();

  // History now has [Take 1, Take 3]
  assert.strictEqual(mgr.getHistory().length, 2);
  assert.strictEqual(mgr.getHistory()[0].name, 'Take 1');
  assert.strictEqual(mgr.getHistory()[1].name, 'Take 3');
  assert.strictEqual(mgr.getIndex(), 1); // Now points to Take 3
  assert.strictEqual(mgr.getCurrentTake().name, 'Take 3');

  // Undo goes directly from Take 3 to Take 1 (Take 2 is completely gone)
  mgr.undo();
  assert.strictEqual(mgr.getCurrentTake().name, 'Take 1');
  assert.strictEqual(mgr.canUndo(), false);
  assert.strictEqual(mgr.canRedo(), true);

  // Redo goes directly from Take 1 to Take 3
  mgr.redo();
  assert.strictEqual(mgr.getCurrentTake().name, 'Take 3');
  assert.strictEqual(mgr.canRedo(), false);
  console.log('✓ Test 8 passed: Delete middle take and verify total removal from undo/redo');
}

// Test 9: Delete tail take and head take
{
  const mgr = createRecordingHistoryManager(10);
  for (let i = 1; i <= 3; i++) {
    const b = ctx.createBuffer(1, 4800, 48000);
    mgr.pushRecordTake(b, { name: 'Take ' + i });
  }

  // Delete Take 3 (head)
  mgr.deleteCurrentRecord();
  assert.strictEqual(mgr.getHistory().length, 2);
  assert.strictEqual(mgr.getIndex(), 1);
  assert.strictEqual(mgr.getCurrentTake().name, 'Take 2');
  assert.strictEqual(mgr.canRedo(), false);

  // Undo to Take 1 and delete Take 1
  mgr.undo();
  assert.strictEqual(mgr.getCurrentTake().name, 'Take 1');
  mgr.deleteCurrentRecord();
  assert.strictEqual(mgr.getHistory().length, 1);
  assert.strictEqual(mgr.getIndex(), 0);
  assert.strictEqual(mgr.getCurrentTake().name, 'Take 2');
  assert.strictEqual(mgr.canUndo(), false);
  assert.strictEqual(mgr.canRedo(), false);
  console.log('✓ Test 9 passed: Delete head and tail takes');
}

function concatBuffersWithCrossfade(bufA, bufB, crossfadeSec = 0.04) {
  if (!bufA || !bufA.length) return bufB ? cloneBuffer(bufB) : null;
  if (!bufB || !bufB.length) return bufA ? cloneBuffer(bufA) : null;
  const sr = bufA.sampleRate;
  const maxFadeSec = Math.min(crossfadeSec, bufA.duration * 0.4, bufB.duration * 0.4);
  const fadeFrames = Math.max(1, Math.floor(maxFadeSec * sr));
  const totalFrames = bufA.length + bufB.length - fadeFrames;

  const out = ctx.createBuffer(1, totalFrames, sr);
  const outData = out.getChannelData(0);
  const dataA = bufA.getChannelData(0);
  const dataB = bufB.getChannelData(0);

  const aHeadLen = bufA.length - fadeFrames;
  outData.set(dataA.subarray(0, aHeadLen), 0);

  for (let i = 0; i < fadeFrames; i++) {
    const t = i / fadeFrames;
    const gainA = Math.cos(t * 0.5 * Math.PI);
    const gainB = Math.sin(t * 0.5 * Math.PI);
    outData[aHeadLen + i] = dataA[aHeadLen + i] * gainA + dataB[i] * gainB;
  }

  outData.set(dataB.subarray(fadeFrames), aHeadLen + fadeFrames);
  return out;
}

// Test 10: Append recording mode with crossfade and undo/redo management
{
  const mgr = createRecordingHistoryManager(10);
  let workingBuffer = null;

  // 1. Record Take 1 (1.0s) as standalone
  const b1 = ctx.createBuffer(1, 48000, 48000);
  for (let i = 0; i < 48000; i++) b1.getChannelData(0)[i] = 0.2;
  mgr.pushRecordTake(b1, { name: 'Take 1' });
  workingBuffer = b1;

  assert.strictEqual(mgr.getHistory().length, 1);
  assert.strictEqual(mgr.getCurrentTake().name, 'Take 1');
  assert.strictEqual(workingBuffer.length, 48000);

  // 2. Record Take 2 (1.0s) with APPEND mode (crossfade)
  const b2 = ctx.createBuffer(1, 48000, 48000);
  for (let i = 0; i < 48000; i++) b2.getChannelData(0)[i] = 0.6;
  const appended1 = concatBuffersWithCrossfade(workingBuffer, b2, 0.04);
  mgr.pushRecordTake(appended1, { name: 'Take 2 (Appended)' });
  workingBuffer = appended1;

  const fadeFrames = Math.floor(0.04 * 48000);
  const expectedLen1 = 48000 + 48000 - fadeFrames;
  assert.strictEqual(mgr.getHistory().length, 2);
  assert.strictEqual(mgr.getIndex(), 1);
  assert.strictEqual(mgr.getCurrentTake().name, 'Take 2 (Appended)');
  assert.strictEqual(workingBuffer.length, expectedLen1);

  // 3. Undo to Take 1
  workingBuffer = mgr.undo();
  assert.strictEqual(mgr.getIndex(), 0);
  assert.strictEqual(mgr.getCurrentTake().name, 'Take 1');
  assert.strictEqual(workingBuffer.length, 48000);
  assert.strictEqual(mgr.canUndo(), false);
  assert.strictEqual(mgr.canRedo(), true);

  // 4. Redo to Take 2 (Appended)
  workingBuffer = mgr.redo();
  assert.strictEqual(mgr.getIndex(), 1);
  assert.strictEqual(mgr.getCurrentTake().name, 'Take 2 (Appended)');
  assert.strictEqual(workingBuffer.length, expectedLen1);
  assert.strictEqual(mgr.canUndo(), true);
  assert.strictEqual(mgr.canRedo(), false);

  // 5. Append Take 3 (0.5s) to workingBuffer
  const b3 = ctx.createBuffer(1, 24000, 48000);
  for (let i = 0; i < 24000; i++) b3.getChannelData(0)[i] = 0.9;
  const appended2 = concatBuffersWithCrossfade(workingBuffer, b3, 0.04);
  mgr.pushRecordTake(appended2, { name: 'Take 3 (Appended)' });
  workingBuffer = appended2;

  const expectedLen2 = expectedLen1 + 24000 - fadeFrames;
  assert.strictEqual(mgr.getHistory().length, 3);
  assert.strictEqual(mgr.getIndex(), 2);
  assert.strictEqual(mgr.getCurrentTake().name, 'Take 3 (Appended)');
  assert.strictEqual(workingBuffer.length, expectedLen2);

  // 6. Undo back through takes: Take 3 (appended) -> Take 2 (appended) -> Take 1 (original)
  workingBuffer = mgr.undo();
  assert.strictEqual(mgr.getCurrentTake().name, 'Take 2 (Appended)');
  assert.strictEqual(workingBuffer.length, expectedLen1);

  workingBuffer = mgr.undo();
  assert.strictEqual(mgr.getCurrentTake().name, 'Take 1');
  assert.strictEqual(workingBuffer.length, 48000);

  console.log('✓ Test 10 passed: Append mode crossfade and undo/redo management');
}

console.log('\nAll 10 Recording History test suites passed successfully!');
