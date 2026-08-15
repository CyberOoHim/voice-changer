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

console.log('\nAll 9 Recording History test suites passed successfully!');
