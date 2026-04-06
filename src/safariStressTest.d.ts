export interface StressIteration {
    index: number;
    memoryMB: number;
    durationMs: number;
    ok: boolean;
}

export interface StressTestResult {
    iterations: StressIteration[];
    totalLoaded: number;
    peakMemoryMB: number;
    /** Average decode time (ms), excluding warm-up. */
    avgDurationMs: number;
    /** Average decode time during warm-up phase. */
    baselineDurationMs: number;
    stopReason: 'complete' | 'vram-limit' | 'load-failed' | 'decode-throttle' | 'error';
}

export interface StressTestOptions {
    iterations?: number;
    ceilingMB?: number;
    /** Iterations excluded from averages. @default 5 */
    warmUpCount?: number;
    /** Decode time multiplier over baseline that triggers stop. @default 3 */
    throttleMultiplier?: number;
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
