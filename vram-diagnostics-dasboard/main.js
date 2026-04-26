import {
    createSpriteCacheForTier,
    getTierDefaults,
    detectDeviceTier,
    CategoryRegistry,
    AssetCategory,
    VramManager,
    getWatermarksForTier
} from "../index.js";

// Session-level state populated by recordDecode() and cleared by boot().
const recentDecodes = [];      // Rolling window for throttle detection
const allDecodes = [];         // Full-session samples for the histogram
let fpsMin = 60;
let fpsDrops = 0;
let gcPauseCount = 0;          // Single-sample spikes that didn't persist
let visibilityPauseCount = 0;  // Times the tab went hidden mid-test

// ══════════════════════════════════════════════════════════
//  CONSTANTS
//  Watermarks come from the library — getWatermarksForTier(tier).
//  No local TIER_WATERMARKS table; that drifts from the library on
//  every release. We cache the tier's watermarks at boot in
//  `currentWatermarks` so the render loop and graph drawing don't
//  pay the lookup cost every frame.
// ══════════════════════════════════════════════════════════
const CATS = [AssetCategory.TEMP, AssetCategory.FX, AssetCategory.BG, AssetCategory.CHAR];

/**
 * Normalizes a select value ('safe' | 'ultra' | '1' | '2' | '3') into
 * the form getWatermarksForTier expects ('safe' | 'ultra' | 1 | 2 | 3).
 */
function watermarksKey(tierValue) {
    return (tierValue === 'safe' || tierValue === 'ultra') ? tierValue : parseInt(tierValue);
}

// ══════════════════════════════════════════════════════════
//  STATE
// ══════════════════════════════════════════════════════════
const $ = id => document.getElementById(id);
let cache, registry, manager;
let isRunning = false, currentRunId = 0, assetCounter = 0, texSize = 1024;
let totalEvictions = 0, evictsThisSec = 0, evictRate = 0;
let peakMB = 0, logCount = 0;
const memHistory = [], assetHistory = [];
const liveCells = new Map();
let sessionStartTime = performance.now();
let currentTierValue = '2';
let currentWatermarks = null;
const evictTimer = 350;
const telemetry = {pressureEvents: 0, panicEvents: 0, evictions: {total: 0}};
const detectedTier = detectDeviceTier();

// Decode timing state
const decode = {baseline: 0, samples: 0, warmUp: 5, warmTotal: 0, last: 0, peak: 0};

// Track tab-hide events. Bound at module init so we add it exactly once.
// The counter is read by buildReport() and reset inside boot().
document.addEventListener('visibilitychange', () => {
    if (document.hidden && isRunning) visibilityPauseCount++;
});

// ══════════════════════════════════════════════════════════
//  BOOT
// ══════════════════════════════════════════════════════════
function boot(tierValue) {
    if (manager) manager.destroy();
    if (cache) cache.clearAll();

    totalEvictions = 0;
    evictsThisSec = 0;
    evictRate = 0;
    peakMB = 0;
    assetCounter = 0;
    logCount = 0;
    memHistory.length = 0;
    assetHistory.length = 0;
    telemetry.pressureEvents = 0;
    telemetry.panicEvents = 0;
    telemetry.evictions = {total: 0};
    decode.baseline = 0;
    decode.samples = 0;
    decode.warmTotal = 0;
    decode.last = 0;
    decode.peak = 0;
    sessionStartTime = performance.now();
    liveCells.forEach(el => el.remove());
    liveCells.clear();
    $('log-list').innerHTML = '';
    currentTierValue = tierValue;

    // Reset session counters every boot (new run)
    recentDecodes.length = 0;
    allDecodes.length = 0;
    fpsMin = 60;
    fpsDrops = 0;
    gcPauseCount = 0;
    visibilityPauseCount = 0;

    registry = new CategoryRegistry();
    const tier = isNaN(tierValue) ? tierValue : parseInt(tierValue);
    cache = createSpriteCacheForTier(tier);

    // ── Watermarks come straight from the library (single source of truth) ──
    const wm = getWatermarksForTier(watermarksKey(tierValue));
    currentWatermarks = wm;

    manager = new VramManager(cache, {
        registry,
        ...wm,                          // spreads as highWatermark/lowWatermark/panicWatermark/checkIntervalMs
        onEvict: (id, category) => {
            totalEvictions++;
            evictsThisSec++;
            const cat = category || 'unknown';
            telemetry.evictions[cat] = (telemetry.evictions[cat] || 0) + 1;
            telemetry.evictions.total++;
            evictVisualCell(id);
            addLog('evict', `${id} [${cat}]`);
        },
        onPressure: (r) => {
            telemetry.pressureEvents++;
            addLog('warn', `Watermark breached (${(r * 100).toFixed(0)}%)`);
        },
        onPanic: (r) => {
            telemetry.panicEvents++;
            addLog('warn', `PANIC MODE (${(r * 100).toFixed(0)}%)`);
        },
        onRelief: (r) => addLog('sys', `Pressure relieved (${(r * 100).toFixed(0)}%)`)
    });

    manager.start();
    const budgetMB = getTierDefaults(tier).maxMemoryMB;
    addLog('sys', `Booted tier ${tierValue} (${budgetMB}MB) | WM: ${wm.highWatermark}/${wm.panicWatermark} | Check: ${wm.checkIntervalMs}ms`);
}

// ══════════════════════════════════════════════════════════
//  TIER DISPLAY — zero inline styles
// ══════════════════════════════════════════════════════════
function renderTier() {
    const {tier, tierName, signals} = detectedTier;
    const icons = {LOW: '●', MID: '◆', HIGH: '⚡'};
    const score = tier === 1 ? 25 : tier === 2 ? 55 : 90;
    const cls = tierName.toLowerCase();

    $('tier-name').textContent = `Tier ${tier} — ${tierName}`;
    $('tier-desc').textContent = `${signals.cores} cores · ${signals.memory}GB · ${signals.gpu.substring(0, 38)}`;

    const icon = $('tier-icon');
    icon.textContent = icons[tierName] || '—';
    icon.className = `tier-icon tier-icon--${cls}`;

    const fill = $('tier-fill');
    fill.className = `tier-fill tier-fill--${cls}`;
    fill.style.width = score + '%';
}

renderTier();

// ══════════════════════════════════════════════════════════
//  DECODE TIMING — Safari throttle detection (v1.1)
//
//  Single helper drives both the on-screen indicator and the
//  exported report so they always agree. Distinguishes:
//
//   - 'normal'    decode is healthy
//   - 'spike'     single-sample > 3× baseline (likely GC/JIT pause)
//   - 'throttle'  3 of last 5 samples > 3× baseline (Safari throttling)
//
//  Matches the rolling-window logic in @zakkster/lite-vram's
//  runSafariStressTest exactly.
// ══════════════════════════════════════════════════════════
function recordDecode(ms) {
    decode.samples++;
    decode.last = ms;
    if (ms > decode.peak) decode.peak = ms;

    if (decode.samples <= decode.warmUp) {
        decode.warmTotal += ms;
        if (decode.samples === decode.warmUp) {
            decode.baseline = decode.warmTotal / decode.warmUp;
        }
        return;
    }

    // Steady-state sample: feed both the rolling window and the
    // append-only history (used for the percentile histogram).
    recentDecodes.push(ms);
    if (recentDecodes.length > 5) recentDecodes.shift();
    allDecodes.push(ms);

    // GC-pause counter: a single-sample spike that does not become
    // a sustained throttle gets logged as a transient pause. We can
    // only know that "for sure" once the rolling window has rotated
    // past it, but counting at sample-time with a slowCount<3 check
    // is good enough — it overcounts only on the iteration that
    // *becomes* the third strike, which is a wash because that one
    // is then classified as 'throttle' in the UI/report anyway.
    if (decode.baseline > 0 && ms > decode.baseline * 3) {
        const slowCount = recentDecodes.reduce(
            (n, s) => n + (s > decode.baseline * 3 ? 1 : 0), 0
        );
        if (slowCount < 3) gcPauseCount++;
    }
}

/**
 * Single source of truth for throttle detection. Used by both
 * updateDecodeUI() (for on-screen indication) and buildReport()
 * (for the exported JSON).
 */
function computeThrottleStatus() {
    if (decode.baseline === 0) return {isThrottled: false, slowCount: 0, mult: 0};
    const mult = decode.last / decode.baseline;
    let slowCount = 0;
    for (const ms of recentDecodes) {
        if (ms > decode.baseline * 3) slowCount++;
    }
    return {isThrottled: slowCount >= 3, slowCount, mult};
}

function updateDecodeUI() {
    const bl = decode.baseline;
    const last = decode.last;
    const {isThrottled, slowCount, mult} = computeThrottleStatus();

    $('d-baseline').textContent = bl > 0 ? `${bl.toFixed(1)}ms` : '—';
    $('d-last').textContent = last > 0 ? `${last.toFixed(1)}ms` : '—';
    $('d-mult').textContent = bl > 0 ? `${mult.toFixed(1)}×` : '—';
    $('d-peak').textContent = decode.peak > 0 ? `${decode.peak.toFixed(1)}ms` : '—';

    const bar = $('d-bar');
    bar.style.width = bl > 0 ? Math.min(mult / 5 * 100, 100) + '%' : '0';
    // Bar visual is now tri-state: throttle (rolling-window), spike (single sample), elevated, normal
    bar.className = 'decode-bar' + (isThrottled ? ' danger' : mult > 3 ? ' warn' : mult > 1.5 ? ' warn' : '');

    const status = $('d-status');

    if (bl === 0) {
        status.textContent = decode.samples > 0 ? `Warm-up ${decode.samples}/${decode.warmUp}...` : 'Waiting for data...';
        status.className = 'decode-status decode-status--idle';
    } else if (isThrottled) {
        status.textContent = `⚠ THROTTLE DETECTED — ${slowCount}/5 slow samples (${mult.toFixed(1)}× current)`;
        status.className = 'decode-status decode-status--danger';
    } else if (mult > 3) {
        // Single-sample spike — almost always a GC/JIT pause or a tab-switch artifact.
        // Not a throttle until the rolling window confirms.
        status.textContent = `Spike — ${mult.toFixed(1)}× baseline (likely GC pause)`;
        status.className = 'decode-status decode-status--warn';
    } else if (mult > 1.5) {
        status.textContent = `Elevated — ${mult.toFixed(1)}× baseline`;
        status.className = 'decode-status decode-status--warn';
    } else {
        status.textContent = `Normal — decode healthy`;
        status.className = 'decode-status decode-status--ok';
    }
}

// ══════════════════════════════════════════════════════════
//  VISUAL TEXTURE GRID
// ══════════════════════════════════════════════════════════
function createVisualCell(id, category) {
    const cell = document.createElement('div');
    cell.className = `tex-cell cat-${category}`;

    const hues = {temp: 210, fx: 38, bg: 155, char: 217, ui: 263};
    const h = hues[category] || 0;

    // 🔧 Pro-Fix: Use a pure CSS gradient instead of a hardware Canvas context!
    const v = Math.sin(assetCounter * 137.5) * 0.5 + 0.5;
    const color = `hsl(${h + v * 20},${60 + v * 30}%,${20 + v * 40}%)`;

    const colorBox = document.createElement('div');
    colorBox.style.width = '100%';
    colorBox.style.height = '100%';
    colorBox.style.backgroundColor = color;
    colorBox.style.borderRadius = '2px';

    const tag = document.createElement('div');
    tag.className = 'tag';
    tag.textContent = category;

    cell.append(colorBox, tag);
    $('tex-grid').appendChild(cell);
    liveCells.set(id, cell);
}

function evictVisualCell(id) {
    const cell = liveCells.get(id);

    if (!cell) return;

    cell.classList.add('evicting');

    setTimeout(() => {
        cell.remove();
        liveCells.delete(id);
    }, evictTimer);
}

// ══════════════════════════════════════════════════════════
//  LOG
// ══════════════════════════════════════════════════════════

let elLogList = null;
let elLogCount = null;

function addLog(type, text) {
    logCount++;

    // Lazy-load the cache so it doesn't break if the script runs before DOMContentLoaded
    if (!elLogList) {
        elLogList = $('log-list');
        elLogCount = $('log-count');
    }

    const e = document.createElement('div');
    e.className = 'log-e';

    const ts = new Date().toLocaleTimeString('en', {hour12: false});

    e.innerHTML = `
        <span class="t ${type}">${type}</span>
        <span class="msg">${text}</span>
        <span class="ts">${ts}</span>
    `;

    elLogList.prepend(e);

    // Lookups are now completely free, making this loop lightning fast
    while (elLogList.children.length > 80) {
        elLogList.lastChild.remove();
    }

    elLogCount.textContent = logCount;
}

// ══════════════════════════════════════════════════════════
//  GRAPH
// ══════════════════════════════════════════════════════════
const gCanvas = $('graph');
const gCtx = gCanvas.getContext('2d');
let lastGraphPush = 0;

function resizeGraph() {
    const r = gCanvas.parentElement.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    gCanvas.width = r.width * dpr;
    gCanvas.height = r.height * dpr;
    gCanvas.style.width = r.width + 'px';
    gCanvas.style.height = r.height + 'px';
    gCtx.setTransform(1, 0, 0, 1, 0, 0);
    gCtx.scale(dpr, dpr);
}

resizeGraph();
window.addEventListener('resize', resizeGraph);

function drawGraph() {
    const w = gCanvas.width / (window.devicePixelRatio || 1);
    const h = gCanvas.height / (window.devicePixelRatio || 1);
    gCtx.clearRect(0, 0, w, h);

    const stats = cache.stats();
    const curMB = parseFloat(stats.memoryMB) || 0;
    const maxMB = parseFloat(stats.maxMemoryMB) || 1;
    const ceilMB = maxMB * 1.15;

    const now = performance.now();
    if (now - lastGraphPush >= 16.66) {
        memHistory.push(curMB);
        assetHistory.push(stats.items);
        const maxPts = Math.floor(w);
        if (memHistory.length > maxPts) memHistory.shift();
        if (assetHistory.length > maxPts) assetHistory.shift();
        lastGraphPush = now;
    }

    // Grid lines
    gCtx.strokeStyle = '#152040';
    gCtx.lineWidth = 0.5;
    for (let i = 0; i <= 4; i++) {
        const y = (i / 4) * h;
        gCtx.beginPath();
        gCtx.moveTo(0, y);
        gCtx.lineTo(w, y);
        gCtx.stroke();
    }
    gCtx.font = '9px IBM Plex Mono, monospace';
    gCtx.fillStyle = '#2a3a55';
    for (let i = 0; i <= 4; i++) gCtx.fillText(`${Math.round(ceilMB * (1 - i / 4))}MB`, 3, (i / 4) * h + 10);

    // Ceiling
    const ceilY = h - (maxMB / ceilMB) * h;
    gCtx.strokeStyle = '#ef4444';
    gCtx.lineWidth = 1;
    gCtx.setLineDash([6, 4]);
    gCtx.beginPath();
    gCtx.moveTo(0, ceilY);
    gCtx.lineTo(w, ceilY);
    gCtx.stroke();
    gCtx.setLineDash([]);
    gCtx.fillStyle = '#ef4444';
    gCtx.fillText(`${maxMB}MB CEILING`, w - 95, ceilY - 4);

    // High watermark (per-tier)
    const wm = currentWatermarks;
    if (wm) {
        const hwY = h - (maxMB * wm.highWatermark / ceilMB) * h;
        gCtx.strokeStyle = '#f59e0b44';
        gCtx.lineWidth = 0.5;
        gCtx.setLineDash([3, 3]);
        gCtx.beginPath();
        gCtx.moveTo(0, hwY);
        gCtx.lineTo(w, hwY);
        gCtx.stroke();
        gCtx.setLineDash([]);
    }

    // Asset count bars
    if (assetHistory.length > 1) {
        const ma = Math.max(20, ...assetHistory);
        gCtx.fillStyle = 'rgba(16,185,129,0.06)';
        const sx = w - assetHistory.length;
        assetHistory.forEach((c, i) => gCtx.fillRect(sx + i, h - (c / ma) * h * 0.3, 1, (c / ma) * h * 0.3));
    }

    // Memory area + line
    if (memHistory.length > 1) {
        const grad = gCtx.createLinearGradient(0, 0, 0, h);
        grad.addColorStop(0, 'rgba(59,130,246,0.22)');
        grad.addColorStop(1, 'rgba(59,130,246,0.01)');
        const sx = w - memHistory.length;
        gCtx.beginPath();
        gCtx.moveTo(sx, h);
        memHistory.forEach((mb, i) => gCtx.lineTo(sx + i, h - (mb / ceilMB) * h));
        gCtx.lineTo(sx + memHistory.length - 1, h);
        gCtx.closePath();
        gCtx.fillStyle = grad;
        gCtx.fill();

        gCtx.strokeStyle = '#3b82f6';
        gCtx.lineWidth = 1.5;
        gCtx.beginPath();
        memHistory.forEach((mb, i) => {
            const x = sx + i, y = h - (mb / ceilMB) * h;
            i === 0 ? gCtx.moveTo(x, y) : gCtx.lineTo(x, y);
        });
        gCtx.stroke();

        const ly = h - (memHistory[memHistory.length - 1] / ceilMB) * h;
        gCtx.fillStyle = '#3b82f6';
        gCtx.beginPath();
        gCtx.arc(w - 1, ly, 2.5, 0, Math.PI * 2);
        gCtx.fill();
    }
}

// ══════════════════════════════════════════════════════════
//  STRESS TEST with decode timing
// ══════════════════════════════════════════════════════════
const genCanvas = document.createElement('canvas');
const genCtx = genCanvas.getContext('2d');

async function testLoop(runId) {
    while (isRunning && currentRunId === runId) {
        const id = `t-${assetCounter++}`;
        const cat = CATS[assetCounter % CATS.length];

        // 🔧 2. Reuse the global canvas instead of creating a new one
        genCanvas.width = texSize;
        genCanvas.height = texSize;

        const hue = (assetCounter * 47) % 360;
        const g = genCtx.createLinearGradient(0, 0, texSize, texSize);
        g.addColorStop(0, `hsl(${hue},70%,45%)`);
        g.addColorStop(1, `hsl(${(hue + 60) % 360},50%,25%)`);
        genCtx.fillStyle = g;
        genCtx.fillRect(0, 0, texSize, texSize);

        // Convert the shared canvas to a blob
        const blob = await new Promise(res => genCanvas.toBlob(res, 'image/png'));

        if (!isRunning || currentRunId !== runId) break;

        const url = URL.createObjectURL(blob);

        const t0 = performance.now();

        // 🔧 CREATE DOM AFTER LOAD: Only render what actually hits VRAM
        cache.load(id, url).then(bmp => {
            const ms = performance.now() - t0;
            URL.revokeObjectURL(url);

            if (bmp && currentRunId === runId) {
                registry.register(id, cat);
                createVisualCell(id, cat);

                recordDecode(ms);
                addLog('load', `${id} [${cat}] ${texSize}² ${ms.toFixed(1)}ms`);
            }
        }).catch(() => {
            URL.revokeObjectURL(url);
        });

        let delay = 50;
        const activeTier = parseInt(currentTierValue) || 2;

        if (activeTier === 3) delay = 80;
        else if (activeTier === 2) delay = 120;
        else delay = 200;

        const cStats = cache.stats();
        const usedRatio = parseFloat(cStats.memoryMB) / parseFloat(cStats.maxMemoryMB);
        const wm = currentWatermarks;

        // 🔧 1. HARDWARE SAFETY BRAKE (v1.1)
        // The high watermark is where the manager *starts* evicting — give it
        // room to do its job. We only slam the brakes inside the panic band,
        // where eviction speed alone might not save us before the hardware
        // ceiling. With v1.1 widening the high→panic gap to ≥ 11pp, this
        // distinction matters: braking at high-WM would jam the test in
        // 800ms-delay mode for most of the run.
        if (usedRatio >= wm.panicWatermark) {
            delay = 800;
        }
        // 🔧 2. ENGINE BACKPRESSURE
        else if (manager && manager.stats().pressured) {
            delay *= 2.5;
        }

        // 🔧 3. PROMISE QUEUE CIRCUIT BREAKER
        if (cStats.pending > 15) {
            delay = 1000;
        }

        await new Promise(r => setTimeout(r, delay));
    }
}

// ══════════════════════════════════════════════════════════
//  RENDER LOOP
// ══════════════════════════════════════════════════════════
let lastTime = performance.now(), frames = 0, fpsVal = 60, lastEvReset = performance.now();

function frame(time) {
    try {
        frames++;

        if (time - lastTime >= 1000) {
            fpsVal = Math.round(frames * 1000 / (time - lastTime));

            // Pro Telemetry: Track sustained drops
            if (fpsVal < fpsMin && fpsVal > 0) fpsMin = fpsVal;
            if (fpsVal <= 30) fpsDrops++;

            frames = 0;
            lastTime = time;
        }

        if (time - lastEvReset >= 1000) {
            evictRate = evictsThisSec;
            evictsThisSec = 0;
            lastEvReset = time;

            // 🔧 THE GHOST SWEEPER: Clean up emergency internal evictions
            // Access the underlying Map directly to prevent LRU poisoning!
            if (cache && cache.cache instanceof Map) {
                for (const [id, cell] of liveCells.entries()) {

                    // Directly check the Map. No .get(), no undefined traps.
                    if (!cache.cache.has(id) && !cell.classList.contains('evicting')) {
                        evictVisualCell(id);
                        if (registry) registry.unregister(id);
                    }

                }
            }
        }

        if (!cache || !manager || !registry) {
            requestAnimationFrame(frame);
            return;
        }

        const stats = cache.stats();
        const usedMB = parseFloat(stats.memoryMB) || 0;
        const maxMB = parseFloat(stats.maxMemoryMB) || 1;
        if (usedMB > peakMB) peakMB = usedMB;

        $('v-mem').innerHTML = `${stats.memoryMB}<span class="unit">MB</span>`;
        $('v-pct').textContent = `${(usedMB / maxMB * 100).toFixed(0)}% of ${maxMB}MB`;
        $('v-peak').innerHTML = `${peakMB.toFixed(2)}<span class="unit">MB</span>`;
        $('v-assets').textContent = stats.items;
        $('v-pending').textContent = `${stats.pending} pending`;
        $('v-evict').textContent = totalEvictions;
        $('v-evrate').textContent = `${evictRate} /sec`;
        $('v-fps').textContent = fpsVal;
        $('v-ft').textContent = `${(1000 / (fpsVal || 60)).toFixed(1)}ms`;

        const ms = manager.stats();

        const elVPressure = $('v-pressure');

        // v1.1: read panic threshold from the manager itself rather than
        // hard-coding 95% — the threshold is per-tier (HIGH=96, ultra=98).
        const panicPct = ms.panicWatermark * 100;
        const inPanic = parseFloat(ms.usagePercent) >= panicPct;
        elVPressure.textContent = ms.pressured ? (inPanic ? 'PANIC' : 'HIGH') : 'OK';
        elVPressure.className = `val ${ms.pressured ? 'c-red' : 'c-green'}`;
        $('v-mgr').textContent = ms.paused ? 'paused' : ms.pressured ? 'evicting' : 'monitoring';

        for (const cat of ['temp', 'fx', 'bg', 'char', 'ui']) {
            const el = $(`cc-${cat}`);
            if (el) el.textContent = registry.getIdsByCategory(cat).length;
        }

        $('g-texcount').textContent = `${liveCells.size} textures`;

        updateDecodeUI();
        drawGraph();
    } catch (err) {
        console.error('[VRAM Diagnostic] frame error:', err);
    }
    requestAnimationFrame(frame);
}

// ══════════════════════════════════════════════════════════
//  REPORT — enriched v1.1.0
// ══════════════════════════════════════════════════════════
function buildReport() {
    const stats = cache ? cache.stats() : {};

    // Pull from the library, not a hardcoded constant
    const wm = getWatermarksForTier(watermarksKey(currentTierValue));

    const durationMs = Math.round(performance.now() - sessionStartTime);

    // Shared throttle decision — same code path as the on-screen indicator,
    // so the report and the UI never disagree.
    const {isThrottled} = computeThrottleStatus();

    // Decode-time percentiles over the full session.
    const pct = (p) => {
        if (allDecodes.length === 0) return 0;
        const sorted = [...allDecodes].sort((a, b) => a - b);
        const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * p));
        return parseFloat(sorted[idx].toFixed(2));
    };

    return {
        generator: '@zakkster/lite-vram playbook diagnostic',
        schemaVersion: 2,
        version: '1.1.0',
        deviceModel: "__________",
        osVersion: "__________",
        browserVersion: "__________",
        batteryStart: "__________",
        deviceTemp: "cool | warm | hot",
        network: "WiFi 5GHz | WiFi 2.4GHz | LTE | 5G",
        notes: "Anything unusual you observed",
        timestamp: new Date().toISOString(),

        session: {
            durationMs: durationMs,
            thermalWarmedUp: durationMs > 30000, // Flag short sessions
            visibilityPauseCount,                // v1.1: tab-hide events during run
            gcPauseCount                         // v1.1: single-sample spikes (not throttle)
        },

        device: {
            userAgent: navigator.userAgent,
            platform: navigator.platform,
            cores: navigator.hardwareConcurrency || 'unknown',
            ramGB: navigator.deviceMemory || 'unknown (non-Chrome)',
            dpr: window.devicePixelRatio || 1, // Crucial for actual VRAM calculation
            gpu: detectedTier.signals.gpu,
            gpuIsLow: detectedTier.signals.gpuIsLow,
            tier: detectedTier.tierName,
            tierReason: detectedTier.signals.reason,
            isIOS: detectedTier.signals.isIOS,
            isIPad: detectedTier.signals.isIPad,
            isMobile: detectedTier.signals.isMobile
        },

        runtime: {
            avgFps: fpsVal,
            minFps: fpsMin === 60 ? null : fpsMin,
            fpsDropsBelow30: fpsDrops
        },

        vram: {
            presetTier: currentTierValue,
            presetMaxMB: stats.maxMemoryMB || '0',
            currentMB: stats.memoryMB || '0',
            peakReachedMB: parseFloat(peakMB.toFixed(2)),
            activeAssets: stats.items || 0,
            textureResolution: `${texSize}x${texSize}`,
            textureVramMB: parseFloat(((texSize * texSize * 4) / 1024 / 1024).toFixed(1))
        },

        watermarks: wm,

        decode: {
            baselineMs: decode.baseline ? parseFloat(decode.baseline.toFixed(2)) : 0,
            lastMs: decode.last ? parseFloat(decode.last.toFixed(2)) : 0,
            peakMs: decode.peak ? parseFloat(decode.peak.toFixed(2)) : 0,
            samples: decode.samples,
            throttleDetected: isThrottled,
            histogram: {                          // v1.1: full-session percentiles
                p50: pct(0.50),
                p75: pct(0.75),
                p90: pct(0.90),
                p95: pct(0.95),
                p99: pct(0.99)
            }
        },

        pressure: {
            events: telemetry.pressureEvents,
            panics: telemetry.panicEvents,
            evictions: telemetry.evictions
        }
    };
}

// ══════════════════════════════════════════════════════════
//  REPORT UI
// ══════════════════════════════════════════════════════════
const elModalBg = $('modal-bg');

$('btn-report').addEventListener('click', () => {
    $('report-json').textContent = JSON.stringify(buildReport(), null, 2);
    elModalBg.classList.add('open');
});

$('btn-close-modal').addEventListener('click', () => elModalBg.classList.remove('open'));

elModalBg.addEventListener('click', e => {
    if (e.target === elModalBg) elModalBg.classList.remove('open');
});

const elBtnCopy = $('btn-copy');

elBtnCopy.addEventListener('click', async () => {
    const textToCopy = $('report-json').textContent;

    // 1. Try modern secure context first
    if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(textToCopy);
    } else {
        // 2. Fallback for non-HTTPS local network testing (http://192.168.x.x)
        const textArea = document.createElement("textarea");
        textArea.value = textToCopy;

        // Prevent mobile keyboard from flashing and screen from scrolling
        textArea.style.position = "fixed";
        textArea.style.top = "-9999px";

        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();

        try {
            document.execCommand('copy');
        } catch (err) {
            console.error('Fallback copy failed', err);
        }
        document.body.removeChild(textArea);
    }

    // Show toast notification
    const toast = $('toast');
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 2000);
});

$('btn-download').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(buildReport(), null, 2)], {type: 'application/json'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `vram-report-${detectedTier.tierName.toLowerCase()}-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    addLog('sys', 'Report downloaded');
});

$('btn-email').addEventListener('click', () => {
    const body = encodeURIComponent(JSON.stringify(buildReport(), null, 2));
    const subj = encodeURIComponent(`VRAM Report — ${detectedTier.tierName} — ${detectedTier.signals.gpu.substring(0, 30)}`);
    window.open('mailto:shinikchiev' + '@' + 'yahoo.com?subject=' + subj + '&body=' + body);
    addLog('sys', 'Email client opened');
});

// ══════════════════════════════════════════════════════════
//  CONTROLS
// ══════════════════════════════════════════════════════════
const elBtnRun = $('btn-run');
const elBtnFlush = $('btn-flush');
const elGStatus = $('g-status');
const elSelTier = $('sel-tier');
const elSelTex = $('sel-tex');

elBtnRun.addEventListener('click', e => {
    if (isRunning) {
        // Stop requested
        isRunning = false;
        currentRunId++;
        e.target.innerHTML = '&#9654; Start';
        e.target.className = 'btn primary';
        elGStatus.textContent = 'Paused';
    } else {
        // Start requested — always works, even if old loop is still in an await
        isRunning = true;
        currentRunId++;
        e.target.innerHTML = '&#9632; Stop';
        e.target.className = 'btn danger';
        elGStatus.textContent = 'Streaming';
        testLoop(currentRunId);
    }
});

elBtnFlush.addEventListener('click', () => {
    isRunning = false;
    currentRunId++;
    elBtnRun.innerHTML = '&#9654; Start';
    elBtnRun.className = 'btn primary';
    elGStatus.textContent = 'Flushed';

    cache.clearAll();
    registry.clear();
    liveCells.forEach(el => el.remove());
    liveCells.clear();

    // Reset all metrics for a clean slate
    totalEvictions = 0;
    evictsThisSec = 0;
    evictRate = 0;
    peakMB = 0;
    memHistory.length = 0;
    assetHistory.length = 0;
    decode.baseline = 0;
    decode.samples = 0;
    decode.warmTotal = 0;
    decode.last = 0;
    decode.peak = 0;
    sessionStartTime = performance.now();

    addLog('sys', 'Architecture flushed — metrics reset');
});

elSelTier.addEventListener('change', e => {
    isRunning = false;
    currentRunId++;
    elBtnRun.innerHTML = '&#9654; Start';
    elBtnRun.className = 'btn primary';
    boot(e.target.value);
});

elSelTex.addEventListener('change', e => {
    texSize = parseInt(e.target.value);
    addLog('sys', `Texture res → ${texSize}² (~${((texSize * texSize * 4) / 1024 / 1024).toFixed(0)}MB each)`);
});

// ══════════════════════════════════════════════════════════
//  VISIBILITY — pause everything when tab is hidden
// ══════════════════════════════════════════════════════════
let wasRunningBeforeHide = false;

document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
        // Tab going to background — pause manager and kill loops
        wasRunningBeforeHide = isRunning;
        isRunning = false;
        currentRunId++;

        if (manager) manager.pause();

        addLog('sys', 'Tab hidden — paused manager + streaming');
    } else {
        if (manager) manager.resume();

        if (wasRunningBeforeHide) {
            wasRunningBeforeHide = false; // 🔧 Prevent ghost double-starts
            isRunning = true;
            currentRunId++;
            elBtnRun.innerHTML = '&#9632; Stop';
            elBtnRun.className = 'btn danger';
            elGStatus.textContent = 'Streaming';
            testLoop(currentRunId);
        }

        // Reset timing counters to avoid false FPS readings
        lastTime = performance.now();
        frames = 0;
        lastEvReset = performance.now();
        evictsThisSec = 0;

        addLog('sys', 'Tab visible — resumed');
    }
});

// ══════════════════════════════════════════════════════════
//  INIT — sync selector to auto-detected tier
// ══════════════════════════════════════════════════════════
function tierToSelectValue(tierName) {
    switch (tierName) {
        case 'LOW':
            return '1';
        case 'MID':
            return '2';
        case 'HIGH':
            return '3';
        default:
            return '2';
    }
}

const initialTier = tierToSelectValue(detectedTier.tierName);

elSelTier.value = initialTier;

boot(initialTier);
requestAnimationFrame(frame);