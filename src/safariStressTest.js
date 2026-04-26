/**
 * Safari Stress Test — VRAM crash threshold detector.
 *
 * Loads progressively heavier assets until the browser approaches
 * VRAM limits. Detects decode slowdown — Safari throttles decodes
 * near its VRAM limit before killing the tab.
 *
 * ── v1.1.0 Improvements ──────────────────────────────────────────
 * Three problems found in v1.0.x by analyzing 38 real-device reports:
 *
 *   1. Single-iteration spike detection misclassified GC pauses and
 *      tab-switches as throttles. Report #27 (Nvidia GT 1030) had a
 *      724ms spike (25.7× baseline) that was an alt-tab event, not
 *      throttling — the user even annotated "Tab freezes when pressed
 *      alt + tab."  Fix: rolling-window detection (3 of last 5 must
 *      exceed threshold) + per-iteration `classification` field.
 *
 *   2. No visibility-change handling. When the tab goes hidden, RAF
 *      pauses but setInterval/setTimeout continue at heavily reduced
 *      frequency. Decode samples taken across a hidden→visible
 *      boundary were polluted. Fix: visibilitychange listener freezes
 *      sampling and adds a 500ms re-warm-up after `visible`.
 *
 *   3. Result lacked a decode-time histogram, so the dashboard could
 *      not distinguish "30ms typical, one 700ms outlier" from "200ms
 *      typical, device is genuinely slow."  Fix: p50/p75/p90/p95/p99
 *      computed over steady-state samples (excludes warm-up + ignored
 *      visibility-pause samples + GC-pause samples).
 */

import { SpriteCache } from '@zakkster/lite-sprite-cache';

/**
 * @typedef {Object} StressIteration
 * @property {number}  index
 * @property {number}  memoryMB
 * @property {number}  durationMs
 * @property {boolean} ok
 * @property {'normal'|'gc-pause'|'throttle'|'ignored'} classification - v1.1
 */

/**
 * @typedef {Object} DecodeHistogram
 * @property {number} p50
 * @property {number} p75
 * @property {number} p90
 * @property {number} p95
 * @property {number} p99
 */

/**
 * @typedef {Object} StressTestResult
 * @property {StressIteration[]} iterations
 * @property {number}  totalLoaded
 * @property {number}  peakMemoryMB
 * @property {number}  avgDurationMs        - Mean over steady-state samples (excludes warm-up).
 * @property {number}  baselineDurationMs   - Mean over warm-up samples.
 * @property {DecodeHistogram} histogram    - v1.1: Percentiles over steady-state samples.
 * @property {number}  gcPauseCount         - v1.1: Single-iteration spikes that recovered.
 * @property {number}  visibilityPauseCount - v1.1: Times the tab went hidden mid-test.
 * @property {string}  stopReason           - 'complete'|'vram-limit'|'load-failed'|'decode-throttle'|'error'
 */

/**
 * Runs an incremental VRAM stress test.
 *
 * @param {string} url
 * @param {Object} [options]
 * @param {number} [options.iterations=200]
 * @param {number} [options.ceilingMB=512]
 * @param {number} [options.warmUpCount=5]
 * @param {number} [options.throttleMultiplier=3]
 * @param {number} [options.slowWindow=5]      - v1.1: Rolling window size.
 * @param {number} [options.slowThreshold=3]   - v1.1: Slow samples in window required to stop.
 * @param {number} [options.visibilityResumeMs=500] - v1.1: Cool-down after `visible`.
 * @returns {Promise<StressTestResult>}
 */
export async function runSafariStressTest(url, {
    iterations          = 200,
    ceilingMB           = 512,
    warmUpCount         = 5,
    throttleMultiplier  = 3,
    slowWindow          = 5,
    slowThreshold       = 3,
    visibilityResumeMs  = 500
} = {}) {
    const cache = new SpriteCache({ maxMemoryMB: ceilingMB });
    const results = [];
    let peakMemoryMB = 0;
    let stopReason = 'complete';

    // ── Warm-up tracking ──────────────────────────────────
    let warmUpTotal = 0;
    let warmUpSamples = 0;
    let baselineDurationMs = 0;

    // ── Steady-state tracking ─────────────────────────────
    let steadyTotal = 0;
    let steadySamples = 0;
    const steadyDurations = [];

    // ── v1.1: Rolling-window slow detection ───────────────
    /** @type {boolean[]} circular buffer; true = sample exceeded throttle threshold */
    const slowWindowBuf = [];
    let gcPauseCount = 0;

    // ── v1.1: Visibility tracking ─────────────────────────
    let visibilityPauseCount = 0;
    let resumeAtTimestamp = 0; // Samples before this timestamp are 'ignored'

    /** @type {((this: Document, ev: Event) => any) | null} */
    let visibilityHandler = null;
    const supportsVisibility = typeof document !== 'undefined' && typeof document.addEventListener === 'function';

    if (supportsVisibility) {
        visibilityHandler = () => {
            if (document.hidden) {
                visibilityPauseCount++;
            } else {
                // Tab returned. Discard samples for the next visibilityResumeMs ms.
                resumeAtTimestamp = performance.now() + visibilityResumeMs;
            }
        };
        document.addEventListener('visibilitychange', visibilityHandler);
    }

    /**
     * Wait while the tab is hidden. Returns when visible.
     * @returns {Promise<void>}
     */
    const waitWhileHidden = async () => {
        if (!supportsVisibility) return;
        while (document.hidden) {
            await new Promise(r => setTimeout(r, 100));
        }
    };

    try {
        for (let i = 0; i < iterations; i++) {
            // Pause iteration count if backgrounded — no point loading
            // textures the user can't see and that may be rate-limited.
            await waitWhileHidden();

            const id = `stress-${i}`;
            const t0 = performance.now();

            const bmp = await cache.load(id, `${url}?cachebust=${i}`);

            const durationMs = performance.now() - t0;
            const stats = cache.stats();
            const memoryMB = parseFloat(stats.memoryMB) || 0;
            const maxMB    = parseFloat(stats.maxMemoryMB) || 1;
            const ok = bmp !== null;

            // ── Classification (v1.1) ─────────────────────
            // Samples taken during the post-visibility re-warm-up window
            // are flagged 'ignored' and excluded from baseline + histogram.
            let classification = 'normal';
            const sampleIgnored = performance.now() < resumeAtTimestamp;

            if (sampleIgnored) {
                classification = 'ignored';
            }

            results.push({
                index: i,
                memoryMB,
                durationMs: Math.round(durationMs * 10) / 10,
                ok,
                classification // populated below if we determine throttle/gc-pause
            });

            if (!ok) {
                stopReason = 'load-failed';
                break;
            }

            if (memoryMB > peakMemoryMB) peakMemoryMB = memoryMB;

            // ── Warm-up phase ─────────────────────────────
            if (i < warmUpCount) {
                if (!sampleIgnored) {
                    warmUpTotal += durationMs;
                    warmUpSamples++;
                    if (warmUpSamples === warmUpCount) {
                        baselineDurationMs = warmUpTotal / warmUpSamples;
                    }
                }
            } else if (!sampleIgnored) {
                steadyTotal += durationMs;
                steadySamples++;
                steadyDurations.push(durationMs);

                // ── Rolling-window slow detection (v1.1) ──
                if (baselineDurationMs > 0) {
                    const isSlow = durationMs > baselineDurationMs * throttleMultiplier;
                    slowWindowBuf.push(isSlow);
                    if (slowWindowBuf.length > slowWindow) slowWindowBuf.shift();

                    if (isSlow) {
                        const slowCount = slowWindowBuf.reduce((n, x) => n + (x ? 1 : 0), 0);
                        if (slowCount >= slowThreshold) {
                            // Persistent slowdown — Safari throttle confirmed.
                            results[results.length - 1].classification = 'throttle';
                            stopReason = 'decode-throttle';
                            break;
                        } else {
                            // Single (or sparse) spike — likely GC/JIT pause.
                            results[results.length - 1].classification = 'gc-pause';
                            gcPauseCount++;
                        }
                    }
                }
            }

            if (memoryMB / maxMB > 0.95) {
                stopReason = 'vram-limit';
                break;
            }
        }
    } catch (e) {
        stopReason = 'error';
        console.error('Safari stress test crashed:', e);
    } finally {
        if (visibilityHandler) {
            document.removeEventListener('visibilitychange', visibilityHandler);
        }
    }

    // ── Histogram (v1.1) — over steady-state, GC-pauses excluded ──
    const cleanDurations = results
        .filter(r => r.ok && r.classification === 'normal' && r.index >= warmUpCount)
        .map(r => r.durationMs)
        .sort((a, b) => a - b);

    /** @param {number} p */
    const pct = (p) => {
        if (cleanDurations.length === 0) return 0;
        const idx = Math.min(cleanDurations.length - 1, Math.floor(cleanDurations.length * p));
        return cleanDurations[idx];
    };

    const histogram = {
        p50: pct(0.50),
        p75: pct(0.75),
        p90: pct(0.90),
        p95: pct(0.95),
        p99: pct(0.99)
    };

    const totalLoaded = results.filter(r => r.ok).length;
    const avgDurationMs = steadySamples > 0 ? steadyTotal / steadySamples : 0;

    const result = {
        iterations:           results,
        totalLoaded,
        peakMemoryMB,
        avgDurationMs,
        baselineDurationMs,
        histogram,
        gcPauseCount,
        visibilityPauseCount,
        stopReason
    };

    console.log(
        `[StressTest] ${totalLoaded}/${iterations} loaded | ` +
        `Peak: ${peakMemoryMB.toFixed(1)}MB | ` +
        `Baseline: ${baselineDurationMs.toFixed(1)}ms | ` +
        `Avg: ${avgDurationMs.toFixed(1)}ms | ` +
        `p99: ${histogram.p99.toFixed(1)}ms | ` +
        `GC-pauses: ${gcPauseCount} | ` +
        `Visibility-pauses: ${visibilityPauseCount} | ` +
        `Stop: ${stopReason}`
    );
    console.table(results);

    cache.clearAll();
    return result;
}

/**
 * Resolution Sweep — Tests multiple texture sizes to build a VRAM cost matrix.
 *
 * @param {string} baseUrl - URL template; the test appends `?w={w}&h={h}&cachebust={i}`.
 * @param {Object} [options]
 * @param {Array<[number, number]>} [options.resolutions]
 * @param {number} [options.iterationsPerRes=50]
 * @param {number} [options.ceilingMB=512]
 * @returns {Promise<Array<{width: number, height: number, result: StressTestResult}>>}
 */
export async function runResolutionSweep(baseUrl, {
    resolutions = [
        [512, 256],
        [1024, 512],
        [2048, 1024]
    ],
    iterationsPerRes = 50,
    ceilingMB        = 512
} = {}) {
    const results = [];

    for (const [w, h] of resolutions) {
        console.log(`[ResolutionSweep] Testing ${w}×${h}...`);
        const url = `${baseUrl}?w=${w}&h=${h}`;
        const result = await runSafariStressTest(url, {
            iterations: iterationsPerRes,
            ceilingMB
        });
        results.push({ width: w, height: h, result });
    }

    console.log('[ResolutionSweep] Complete:');
    console.table(results.map(r => ({
        resolution:  `${r.width}×${r.height}`,
        peakMB:      r.result.peakMemoryMB.toFixed(1),
        avgDecodeMs: r.result.avgDurationMs.toFixed(1),
        p99Ms:       r.result.histogram.p99.toFixed(1),
        stop:        r.result.stopReason
    })));

    return results;
}
