import type { SpriteCache } from '@zakkster/lite-sprite-cache';
import type { VramManager } from './vramManager';

export interface VramHUDOptions {
    position?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
    mode?: 'interval' | 'raf';
    display?: 'full' | 'compact';
    intervalMs?: number;
    manager?: VramManager | null;
}

export declare class VramHUD {
    /** Peak VRAM usage observed (MB). */
    peakMB: number;

    constructor(cache: SpriteCache, options?: VramHUDOptions);

    /** Resets peak tracking to current usage. */
    resetPeak(): void;

    /** Removes HUD and stops updates. Idempotent. */
    destroy(): void;
}
