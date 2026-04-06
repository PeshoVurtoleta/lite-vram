/**
 * Safari Stress Test — VRAM crash threshold detector.
 *
 * Loads progressively heavier assets until the browser approaches
 * VRAM limits. Detects decode slowdown (Safari throttles decodes
 * near its VRAM limit before killing the tab).
 *
 * Features:
 * - Per-iteration timing and memory tracking
 * - Warm-up phase (first N decodes excluded from averages)
 * - Decode slowdown detection (3× baseline = throttled)
 * - Resolution sweep mode for building VRAM cost matrices
 */

import { SpriteCache } from '@zakkster/lite-sprite-cache';

/**
 * @typedef {Object} StressIteration
 * @property {number}  index
 * @property {number}  memoryMB
 * @property {number}  durationMs
 * @property {boolean} ok
 */

/**
 * @typedef {Object} StressTestResult
 * @property {StressIteration[]} iterations
 * @property {number}  totalLoaded
 * @property {number}  peakMemoryMB
 * @property {number}  avgDurationMs    - Excludes warm-up iterations.
 * @property {number}  baselineDurationMs - Average of warm-up iterations.
 * @property {string}  stopReason       - 'complete'|'vram-limit'|'load-failed'|'decode-throttle'|'error'
 */

/**
 * Runs an incremental VRAM stress test.
 *
 * @param {string} url
 * @param {Object} [options]
 * @param {number} [options.iterations=200]
 * @param {number} [options.ceilingMB=512]
 * @param {number} [options.warmUpCount=5]  - Iterations excluded from averages.
 * @param {number} [options.throttleMultiplier=3] - Decode time × baseline that triggers 'decode-throttle' stop.
 * @returns {Promise<StressTestResult>}
 */
export async function runSafariStressTest(url, {
    iterations          = 200,
    ceilingMB           = 512,
    warmUpCount         = 5,
    throttleMultiplier  = 3
} = {}) {
    const cache = new SpriteCache({ maxMemoryMB: ceilingMB });
    const results = [];
    let peakMemoryMB = 0;
    let stopReason = 'complete';

    // Warm-up tracking
    let warmUpTotal = 0;
    let warmUpSamples = 0;
    let baselineDurationMs = 0;

    // Post-warm-up tracking
    let steadyTotal = 0;
    let steadySamples = 0;

    try {
        for (let i = 0; i < iterations; i++) {
            const id = `stress-${i}`;
            const t0 = performance.now();

            const bmp = await cache.load(id, `${url}?cachebust=${i}`);

            const durationMs = performance.now() - t0;
            const stats = cache.stats();
            const memoryMB = parseFloat(stats.memoryMB) || 0;
            const maxMB    = parseFloat(stats.maxMemoryMB) || 1;
            const ok = bmp !== null;

            results.push({
                index: i,
                memoryMB,
                durationMs: Math.round(durationMs * 10) / 10,
                ok
            });

            if (ok) {
                if (memoryMB > peakMemoryMB) peakMemoryMB = memoryMB;

                // Warm-up phase
                if (i < warmUpCount) {
                    warmUpTotal += durationMs;
                    warmUpSamples++;
                    if (warmUpSamples === warmUpCount) {
                        baselineDurationMs = warmUpTotal / warmUpSamples;
                    }
                } else {
                    steadyTotal += durationMs;
                    steadySamples++;

                    // Decode slowdown detection
                    if (baselineDurationMs > 0 && durationMs > baselineDurationMs * throttleMultiplier) {
                        stopReason = 'decode-throttle';
                        break;
                    }
                }
            }

            if (!ok) {
                stopReason = 'load-failed';
                break;
            }

            if (memoryMB / maxMB > 0.95) {
                stopReason = 'vram-limit';
                break;
            }
        }
    } catch (e) {
        stopReason = 'error';
        console.error('Safari stress test crashed:', e);
    }

    const totalLoaded = results.filter(r => r.ok).length;
    const avgDurationMs = steadySamples > 0 ? steadyTotal / steadySamples : 0;

    const result = {
        iterations:    results,
        totalLoaded,
        peakMemoryMB,
        avgDurationMs,
        baselineDurationMs,
        stopReason
    };

    console.log(
        `[StressTest] ${totalLoaded}/${iterations} loaded | ` +
        `Peak: ${peakMemoryMB.toFixed(1)}MB | ` +
        `Baseline: ${baselineDurationMs.toFixed(1)}ms | ` +
        `Avg: ${avgDurationMs.toFixed(1)}ms | ` +
        `Stop: ${stopReason}`
    );
    console.table(results);

    cache.clearAll();
    return result;
}

/**
 * Resolution Sweep — Tests multiple texture sizes to build a VRAM cost matrix.
 *
 * Runs `runSafariStressTest` at each resolution, returning a summary
 * that maps resolution → peak VRAM / decode speed / stop reason.
 *
 * @param {string} baseUrl - URL template. The test appends `?w={w}&h={h}&cachebust={i}`.
 * @param {Object} [options]
 * @param {Array<[number, number]>} [options.resolutions] - Array of [width, height] pairs.
 * @param {number} [options.iterationsPerRes=50]
 * @param {number} [options.ceilingMB=512]
 * @returns {Promise<Array<{width: number, height: number, result: StressTestResult}>>}
 *
 * @example
 * ```js
 * const sweep = await runResolutionSweep('https://cdn.example.com/test-texture.png');
 * for (const { width, height, result } of sweep) {
 *     console.log(`${width}×${height}: peak ${result.peakMemoryMB.toFixed(1)}MB, ` +
 *                 `avg ${result.avgDurationMs.toFixed(1)}ms, stop: ${result.stopReason}`);
 * }
 * ```
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
        stop:        r.result.stopReason
    })));

    return results;
}
