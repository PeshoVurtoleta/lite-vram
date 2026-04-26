export interface WatermarkConfig {
    /** Usage ratio (0–1) that triggers category-priority eviction. */
    high: number;
    /** Usage ratio (0–1) below which eviction stops (hysteresis floor). */
    low: number;
    /** Usage ratio (0–1) that triggers panic mode (mass eviction). */
    panic: number;
    /** Polling frequency (ms) for the VramManager. */
    checkIntervalMs: number;
}

/**
 * Subset of `VramManagerOptions` produced by `getWatermarksForTier`.
 * Keys match the constructor's named parameters exactly so the result
 * can be spread directly into the options object.
 */
export interface VramManagerWatermarks {
    highWatermark: number;
    lowWatermark: number;
    panicWatermark: number;
    checkIntervalMs: number;
}

/** Per-tier watermark configurations. Keys: `'safe' | 1 | 2 | 3 | 'ultra'`. */
export declare const WATERMARKS: Readonly<Record<string | number, Readonly<WatermarkConfig>>>;

/**
 * Returns the watermark config for a tier, shaped for direct spread into
 * `new VramManager(cache, { registry, ...getWatermarksForTier(tier) })`.
 *
 * Falls back to HIGH-tier values for unknown keys.
 *
 * @param tier - `DeviceTier.LOW | MID | HIGH`, or `'safe' | 'ultra'`.
 * @returns A fresh shallow copy — safe to mutate.
 */
export declare function getWatermarksForTier(tier: number | string): VramManagerWatermarks;