import type { SpriteCache } from '@zakkster/lite-sprite-cache';
import type { CategoryRegistry } from './categoryRegistry';

export interface VramManagerOptions {
    /** Polling frequency. @default 1000 (v1.1; was 2000) */
    checkIntervalMs?: number;
    /** Usage ratio (0–1) that triggers eviction. @default 0.85 (v1.1; was 0.90) */
    highWatermark?: number;
    /** Usage ratio (0–1) below which eviction stops. @default 0.70 (v1.1; was 0.75) */
    lowWatermark?: number;
    /** Usage ratio (0–1) that triggers panic mode. @default 0.96 (v1.1; was 0.95) */
    panicWatermark?: number;
    /** Fallback max-age (ms) for age-based eviction. @default 5000 */
    aggressiveUnloadAge?: number;
    /**
     * Required. Category-aware eviction depends on this.
     * Throws at construction if omitted.
     */
    registry: CategoryRegistry;
    /** Called with (id, category?) on each eviction. */
    onEvict?: ((id: string, category?: string) => void) | null;
    /**
     * Called only on the OK → HIGH-PRESSURE transition (v1.1).
     * Does not fire when the system jumps straight to panic — that path
     * fires `onPanic` only, so dashboards can detect watermark overshoot.
     */
    onPressure?: ((usage: number) => void) | null;
    /** Called on the HIGH → OK transition (returning below low watermark). */
    onRelief?: ((usage: number) => void) | null;
    /** Called every tick that usage exceeds panicWatermark. */
    onPanic?: ((usage: number) => void) | null;
}

export interface VramManagerStats {
    pressured: boolean;
    paused: boolean;
    usageRatio: number;
    usagePercent: string;
    highWatermark: number;
    lowWatermark: number;
    panicWatermark: number;
    registrySize: number;
    running: boolean;
}

export declare class VramManager {
    /**
     * @throws {Error} if `registry` is missing.
     * @throws {Error} if watermarks do not satisfy `low < high < panic` (v1.1).
     */
    constructor(cache: SpriteCache, options: VramManagerOptions);

    /** True if currently above high watermark. */
    readonly isPressured: boolean;
    /** True if eviction is temporarily disabled. */
    readonly isPaused: boolean;

    /** Starts periodic VRAM pressure checks. Idempotent. */
    start(): void;
    /** Stops periodic checks. */
    stop(): void;
    /** Temporarily disables eviction. */
    pause(): void;
    /** Resumes eviction after pause. */
    resume(): void;
    /** Manual immediate pressure check. */
    check(): void;
    /** Diagnostic snapshot. */
    stats(): VramManagerStats;
    /** Stops and nullifies references. */
    destroy(): void;
}
