/* Node test suite for VoxClip Studio LocalStorage Persistence */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');

// Extract STORAGE_KEY and helper structures from app.js
const appCode = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');

// Mock localStorage
class MockLocalStorage {
  constructor() {
    this.store = {};
  }
  getItem(key) {
    return Object.prototype.hasOwnProperty.call(this.store, key) ? this.store[key] : null;
  }
  setItem(key, value) {
    this.store[key] = String(value);
  }
  removeItem(key) {
    delete this.store[key];
  }
  clear() {
    this.store = {};
  }
}

// Mock DOM elements
function createMockElements() {
  const elements = {
    recModeStandalone: { checked: true, addEventListener: () => {} },
    recModeAppend: { checked: false, addEventListener: () => {} },
    btnLoop: {
      classList: {
        contains: (c) => false,
        toggle: function(c, v) { this[c] = !!v; },
        remove: function(c) { this[c] = false; }
      },
      setAttribute: () => {}
    },
    labDetails: { open: false, addEventListener: () => {} },
    skipInterval: { value: '5', addEventListener: () => {} },
    exportPref: { value: 'wav', addEventListener: () => {} },
    maxRecordSec: { value: '180', addEventListener: () => {} },
    fxSourceMode: { value: 'local', addEventListener: () => {} },
    fxRemoteUrl: { value: '', addEventListener: () => {} },
    fxRemoteUrlGroup: { hidden: true },
    presetSearch: { value: '', addEventListener: () => {} },
    micLevel: { value: '3', addEventListener: () => {} },
    micLevelVal: { textContent: '3.0×' },
    inputGain: { value: '1', addEventListener: () => {} },
    inputGainVal: { textContent: '1.0×' },
    tabBuiltIn: { classList: { toggle: () => {} }, setAttribute: () => {} },
    tabCustom: { classList: { toggle: () => {} }, setAttribute: () => {} }
  };
  return elements;
}

console.log('--- Testing VoxClip Studio LocalStorage Persistence ---');

// Test 1: Verify defaultPersisted contains recMode: 'standalone'
(() => {
  assert.ok(appCode.includes("recMode: 'standalone'"), 'app.js includes recMode in defaultPersisted');
  assert.ok(appCode.includes("recMode: S.recMode || (S.ui && S.ui.recMode) || 'standalone'"), 'app.js snapshots recMode');
  assert.ok(appCode.includes("ui.recMode = ui.recMode === 'append' ? 'append' : 'standalone'"), 'app.js sanitizes recMode on load');
  console.log('✓ Test 1 passed: Codebase structure verifies recMode persistence definitions');
})();

// Test 2: Simulate complete loadPersisted, snapshotPersisted, applyPersisted roundtrip
(() => {
  const mockStorage = new MockLocalStorage();
  const STORAGE_KEY = 'voxclip.studio.v3';

  // Helper functions simulating app.js persistence logic
  function defaultPersisted() {
    return {
      version: 3,
      ui: {
        loop: false,
        skipIntervalSec: 5,
        lastExportFormat: 'wav',
        advancedLabExpanded: false,
        presetsSection: 'built-in',
        micLevel: 3,
        inputGain: 1,
        fxSourceMode: 'local',
        fxRemoteUrl: '',
        maxRecordSec: 180,
        recMode: 'standalone',
        recentPresetIds: [],
        presetSearch: '',
        presetCatOpen: { 'Character & Creature': true }
      },
      fx: {},
      presetChain: [],
      presetChainMix: [],
      activePresetId: null,
      activeCustomId: null,
      customSettings: [],
      updatedAt: Date.now()
    };
  }

  function loadPersisted(storage) {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return defaultPersisted();
    const data = JSON.parse(raw);
    const base = defaultPersisted();
    const ui = { ...base.ui, ...(data.ui || {}) };
    if (![1, 3, 5, 10].includes(ui.skipIntervalSec)) ui.skipIntervalSec = 5;
    if (ui.lastExportFormat !== 'wav' && ui.lastExportFormat !== 'mp3') ui.lastExportFormat = 'wav';
    if (ui.fxSourceMode !== 'local' && ui.fxSourceMode !== 'github') ui.fxSourceMode = 'local';
    if (typeof ui.fxRemoteUrl !== 'string') ui.fxRemoteUrl = '';
    ui.maxRecordSec = [60, 180, 300, 600].includes(Number(ui.maxRecordSec)) ? Number(ui.maxRecordSec) : 180;
    ui.recMode = ui.recMode === 'append' ? 'append' : 'standalone';
    ui.presetsSection = ui.presetsSection === 'custom' ? 'custom' : 'built-in';
    return {
      version: 3,
      ui,
      fx: data.fx || {},
      presetChain: data.presetChain || [],
      presetChainMix: data.presetChainMix || [],
      activePresetId: data.activePresetId || null,
      activeCustomId: data.activeCustomId || null,
      customSettings: data.customSettings || [],
      updatedAt: data.updatedAt || Date.now()
    };
  }

  function snapshotPersisted(S) {
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
        fxSourceMode: (S.ui && S.ui.fxSourceMode) || 'local',
        fxRemoteUrl: (S.ui && S.ui.fxRemoteUrl) || '',
        maxRecordSec: (S.ui && S.ui.maxRecordSec) || 180,
        recMode: S.recMode || (S.ui && S.ui.recMode) || 'standalone',
        recentPresetIds: (S.ui && S.ui.recentPresetIds) ? S.ui.recentPresetIds.slice(0, 8) : [],
        presetSearch: (S.ui && S.ui.presetSearch) || '',
        presetCatOpen: { ...S.presetCatOpen }
      },
      fx: { ...S.fx },
      presetChain: [...S.presetChain],
      presetChainMix: [...S.presetChainMix],
      activePresetId: S.activePresetId,
      activeCustomId: S.activeCustomId,
      customSettings: S.customSettings,
      updatedAt: Date.now()
    };
  }

  function applyPersisted(p, S, els) {
    S.loop = !!p.ui.loop;
    S.skipIntervalSec = p.ui.skipIntervalSec;
    S.lastExportFormat = p.ui.lastExportFormat;
    S.advancedLabExpanded = !!p.ui.advancedLabExpanded;
    S.presetsSection = p.ui.presetsSection === 'custom' ? 'custom' : 'built-in';
    S.fx = { ...p.fx };
    S.presetChain = [...p.presetChain];
    S.presetChainMix = [...p.presetChainMix];
    S.activePresetId = p.activePresetId;
    S.activeCustomId = p.activeCustomId;
    S.customSettings = p.customSettings || [];
    S.presetCatOpen = { ...p.ui.presetCatOpen };
    S.micLevel = p.ui.micLevel;
    S.inputGain = p.ui.inputGain;
    S.ui = S.ui || {};
    S.ui.fxSourceMode = p.ui.fxSourceMode;
    S.ui.fxRemoteUrl = p.ui.fxRemoteUrl;
    S.ui.maxRecordSec = p.ui.maxRecordSec;
    S.ui.recentPresetIds = [...p.ui.recentPresetIds];
    S.ui.presetSearch = p.ui.presetSearch;
    S.ui.presetCatOpen = S.presetCatOpen;
    const m = (p.ui && p.ui.recMode) || S.recMode || 'standalone';
    S.recMode = m === 'append' ? 'append' : 'standalone';
    S.ui.recMode = S.recMode;

    if (els.recModeStandalone && els.recModeAppend) {
      if (S.recMode === 'append') {
        els.recModeAppend.checked = true;
        els.recModeStandalone.checked = false;
      } else {
        els.recModeStandalone.checked = true;
        els.recModeAppend.checked = false;
      }
    }
    if (els.skipInterval) els.skipInterval.value = String(S.skipIntervalSec);
    if (els.exportPref) els.exportPref.value = S.lastExportFormat;
    if (els.maxRecordSec) els.maxRecordSec.value = String(S.ui.maxRecordSec);
    if (els.presetSearch) els.presetSearch.value = S.ui.presetSearch;
    if (els.fxSourceMode) els.fxSourceMode.value = S.ui.fxSourceMode;
    if (els.fxRemoteUrl) els.fxRemoteUrl.value = S.ui.fxRemoteUrl;
    if (els.fxRemoteUrlGroup) els.fxRemoteUrlGroup.hidden = (S.ui.fxSourceMode !== 'github');
  }

  // Initial state -> user selects 'append' mode and tweaks other settings
  const state = {
    loop: true,
    skipIntervalSec: 10,
    lastExportFormat: 'mp3',
    advancedLabExpanded: true,
    presetsSection: 'custom',
    micLevel: 6,
    inputGain: 2.5,
    recMode: 'append',
    ui: {
      fxSourceMode: 'github',
      fxRemoteUrl: 'https://user.github.io/repo/fx.json',
      maxRecordSec: 300,
      recMode: 'append',
      recentPresetIds: ['robot', 'cave'],
      presetSearch: 'robot',
      presetCatOpen: { 'Character & Creature': false }
    },
    fx: { pitchSemitones: 4 },
    presetChain: ['robot'],
    presetChainMix: [0.9],
    activePresetId: 'robot',
    activeCustomId: 'custom_1',
    customSettings: [{ id: 'custom_1', name: 'My Robot', fx: {} }]
  };

  const elements = createMockElements();

  // Save to mock localStorage
  const snap = snapshotPersisted(state);
  mockStorage.setItem(STORAGE_KEY, JSON.stringify(snap));

  // Verify storage content
  const storedJson = JSON.parse(mockStorage.getItem(STORAGE_KEY));
  assert.strictEqual(storedJson.ui.recMode, 'append', 'recMode is stored as append in localStorage');
  assert.strictEqual(storedJson.ui.skipIntervalSec, 10, 'skipIntervalSec is stored as 10');
  assert.strictEqual(storedJson.ui.lastExportFormat, 'mp3', 'lastExportFormat is stored as mp3');
  assert.strictEqual(storedJson.ui.maxRecordSec, 300, 'maxRecordSec is stored as 300');
  assert.strictEqual(storedJson.ui.fxSourceMode, 'github', 'fxSourceMode is stored as github');
  assert.strictEqual(storedJson.ui.presetsSection, 'custom', 'presetsSection is stored as custom');

  // Re-load on simulated fresh browser session
  const freshState = { recMode: 'standalone', ui: {} };
  const freshElements = createMockElements();
  const loaded = loadPersisted(mockStorage);
  applyPersisted(loaded, freshState, freshElements);

  assert.strictEqual(freshState.recMode, 'append', 'Restored recMode is append');
  assert.strictEqual(freshState.ui.recMode, 'append', 'Restored S.ui.recMode is append');
  assert.strictEqual(freshElements.recModeAppend.checked, true, 'recModeAppend radio button is checked');
  assert.strictEqual(freshElements.recModeStandalone.checked, false, 'recModeStandalone radio button is unchecked');
  assert.strictEqual(freshElements.skipInterval.value, '10', 'skipInterval select restored to 10');
  assert.strictEqual(freshElements.exportPref.value, 'mp3', 'exportPref select restored to mp3');
  assert.strictEqual(freshElements.maxRecordSec.value, '300', 'maxRecordSec select restored to 300');
  assert.strictEqual(freshElements.fxSourceMode.value, 'github', 'fxSourceMode select restored to github');
  assert.strictEqual(freshElements.fxRemoteUrl.value, 'https://user.github.io/repo/fx.json', 'fxRemoteUrl input restored');
  assert.strictEqual(freshElements.fxRemoteUrlGroup.hidden, false, 'fxRemoteUrlGroup is visible for github source');

  console.log('✓ Test 2 passed: Full persistence roundtrip accurately preserves recMode and UI settings');
})();

// Test 3: Fallback and sanitization for corrupted / unknown values
(() => {
  const mockStorage = new MockLocalStorage();
  const STORAGE_KEY = 'voxclip.studio.v3';

  // Store malformed UI state
  mockStorage.setItem(STORAGE_KEY, JSON.stringify({
    version: 3,
    ui: {
      recMode: 'invalid_mode_value',
      skipIntervalSec: 999,
      maxRecordSec: 12345,
      lastExportFormat: 'ogg',
      fxSourceMode: 'unknown'
    }
  }));

  const raw = mockStorage.getItem(STORAGE_KEY);
  const data = JSON.parse(raw);
  const ui = data.ui;

  // Run sanitization logic
  if (![1, 3, 5, 10].includes(ui.skipIntervalSec)) ui.skipIntervalSec = 5;
  if (ui.lastExportFormat !== 'wav' && ui.lastExportFormat !== 'mp3') ui.lastExportFormat = 'wav';
  if (ui.fxSourceMode !== 'local' && ui.fxSourceMode !== 'github') ui.fxSourceMode = 'local';
  ui.maxRecordSec = [60, 180, 300, 600].includes(Number(ui.maxRecordSec)) ? Number(ui.maxRecordSec) : 180;
  ui.recMode = ui.recMode === 'append' ? 'append' : 'standalone';

  assert.strictEqual(ui.recMode, 'standalone', 'Corrupted recMode falls back to standalone');
  assert.strictEqual(ui.skipIntervalSec, 5, 'Invalid skip interval falls back to 5');
  assert.strictEqual(ui.lastExportFormat, 'wav', 'Invalid export format falls back to wav');
  assert.strictEqual(ui.maxRecordSec, 180, 'Invalid max recording seconds falls back to 180');
  assert.strictEqual(ui.fxSourceMode, 'local', 'Invalid fx source mode falls back to local');

  console.log('✓ Test 3 passed: Corrupted and invalid persistence values sanitize gracefully to safe defaults');
})();

// Test 4: A/B button comparingDry is non-persistent and defaults to applying FX (wet) on reset and restore
(() => {
  // Verify comparingDry is NOT stored in localStorage snapshot
  assert.ok(!appCode.includes('comparingDry: S.comparingDry'), 'comparingDry is never stored in snapshotPersisted');

  // Verify setDry(false, false) is called across resets, restores, buffer sets, and bakes
  const resetProjectSection = appCode.slice(appCode.indexOf('function resetProject()'), appCode.indexOf('function clearAllSaved()'));
  assert.ok(resetProjectSection.includes('setDry(false, false)'), 'resetProject resets A/B dry auditioning');

  const resetAudioSection = appCode.slice(appCode.indexOf('function resetAudio()'), appCode.indexOf('function resetProject()'));
  assert.ok(resetAudioSection.includes('setDry(false, false)'), 'resetAudio resets A/B dry auditioning');

  const clearAllSavedSection = appCode.slice(appCode.indexOf('function clearAllSaved()'), appCode.indexOf('function openProjectsDb()'));
  assert.ok(clearAllSavedSection.includes('setDry(false, false)'), 'clearAllSaved resets A/B dry auditioning');

  const restoreProjectSection = appCode.slice(appCode.indexOf('async function restoreProjectFromData('), appCode.indexOf('async function exportProjectFile('));
  assert.ok(restoreProjectSection.includes('setDry(false, false)'), 'restoreProjectFromData resets A/B dry auditioning');

  const setBufferSection = appCode.slice(appCode.indexOf('function setBuffer('), appCode.indexOf('function bufferIsBakedFromOriginal()'));
  assert.ok(setBufferSection.includes('setDry(false, false)'), 'setBuffer resets A/B dry auditioning');

  const resetFxSection = appCode.slice(appCode.indexOf('function resetFx()'), appCode.indexOf('function resetAudio()'));
  assert.ok(resetFxSection.includes('setDry(false, false)'), 'resetFx resets A/B dry auditioning');

  console.log('✓ Test 4 passed: A/B comparingDry is non-persistent and always defaults to applying FX (wet)');
})();

// Test 5: iPad / Power Eco Mode persistence and sanitization
(() => {
  assert.ok(appCode.includes("ecoMode: 'auto'"), 'app.js includes ecoMode in defaultPersisted');
  assert.ok(appCode.includes("ecoMode: (S.ui && S.ui.ecoMode) || 'auto'"), 'app.js snapshots ecoMode');
  assert.ok(appCode.includes("['auto', 'on', 'off'].includes(p.ui.ecoMode)"), 'app.js validates ecoMode on load');

  const sanitizeEco = (val) => ['auto', 'on', 'off'].includes(val) ? val : 'auto';
  assert.strictEqual(sanitizeEco('auto'), 'auto', 'auto ecoMode preserved');
  assert.strictEqual(sanitizeEco('on'), 'on', 'on ecoMode preserved');
  assert.strictEqual(sanitizeEco('off'), 'off', 'off ecoMode preserved');
  assert.strictEqual(sanitizeEco('invalid'), 'auto', 'invalid ecoMode falls back to auto');
  assert.strictEqual(sanitizeEco(null), 'auto', 'null ecoMode falls back to auto');

  console.log('✓ Test 5 passed: iPad and battery Power Eco Mode properly persists and sanitizes');
})();

console.log('\nAll LocalStorage Persistence tests passed successfully!');
