export type IterationClassification = 'normal' | 'gc-pause' | 'throttle' | 'ignored';

export interface StressIteration {
    index: number;
    memoryMB: number;
    durationMs: number;
    ok: boolean;
    /**
     * v1.1: How this sample was treated.
     *  - `'normal'`   — counted in baseline + histogram
     *  - `'gc-pause'` — single spike that recovered (excluded from histogram)
     *  - `'throttle'` — final spike that triggered the rolling-window stop
     *  - `'ignored'`  — sample taken during visibility resume window
     */
    classification: IterationClassification;
}

export interface DecodeHistogram {
    p50: number;
    p75: number;
    p90: number;
    p95: number;
    p99: number;
}

export interface StressTestResult {
    iterations: StressIteration[];
    totalLoaded: number;
    peakMemoryMB: number;
    /** Average decode time (ms), excluding warm-up and ignored samples. */
    avgDurationMs: number;
    /** Average decode time during warm-up phase. */
    baselineDurationMs: number;
    /** v1.1: Percentiles over steady-state, gc-pause-free samples. */
    histogram: DecodeHistogram;
    /** v1.1: Single-iteration spikes that did not persist. */
    gcPauseCount: number;
    /** v1.1: Times the tab went hidden during the test. */
    visibilityPauseCount: number;
    stopReason: 'complete' | 'vram-limit' | 'load-failed' | 'decode-throttle' | 'error';
}

export interface StressTestOptions {
    iterations?: number;
    ceilingMB?: number;
    /** Iterations excluded from averages. @default 5 */
    warmUpCount?: number;
    /** Decode time multiplier over baseline that classifies as slow. @default 3 */
    throttleMultiplier?: number;
    /** v1.1: Rolling window size for throttle detection. @default 5 */
    slowWindow?: number;
    /** v1.1: Slow samples in window required to stop. @default 3 */
    slowThreshold?: number;
    /** v1.1: Cool-down (ms) after `visibilitychange → visible`. @default 500 */
    visibilityResumeMs?: number;
}

export interface ResolutionSweepOptions {
    resolutions?: Array<[number, number]>;
    iterationsPerRes?: number;
    ceilingMB?: number;
}

export interface ResolutionSweepEntry {
    width: number;
    height: number;
    result: StressTestResult;
}

/** Runs an incremental VRAM stress test. */
export declare function runSafariStressTest(
    url: string,
    options?: StressTestOptions
): Promise<StressTestResult>;

/** Tests multiple texture sizes to build a VRAM cost matrix. */
export declare function runResolutionSweep(
    baseUrl: string,
    options?: ResolutionSweepOptions
): Promise<ResolutionSweepEntry[]>;
