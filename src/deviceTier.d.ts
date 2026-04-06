export declare const DeviceTier: {
    readonly LOW:  1;
    readonly MID:  2;
    readonly HIGH: 3;
};

export interface TierSignals {
    isIOS: boolean;
    isIPad: boolean;
    isMobile: boolean;
    /** RAM in GB. From `navigator.deviceMemory` or fallback estimate. */
    memory: number;
    /** True if `navigator.deviceMemory` was available (Chrome/Edge only). */
    memoryReal: boolean;
    cores: number;
    /** GPU renderer string from WebGL, or 'unknown'/'no-webgl'. */
    gpu: string;
    /** True if GPU matched a known low-end pattern. */
    gpuIsLow: boolean;
    /** Human-readable explanation of why this tier was chosen. */
    reason: string;
}

export interface TierResult {
    tier: number;
    tierName: string;
    signals: TierSignals;
}

/**
 * Detects the device's performance tier for VRAM budget selection.
 * Returns signals and reasoning for debugging.
 */
export declare function detectDeviceTier(): TierResult;
