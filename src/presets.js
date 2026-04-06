/**
 * Tier-Aware SpriteCache Presets.
 *
 * | Tier  | maxMemoryMB | Target Devices |
 * |-------|-------------|----------------|
 * | SAFE  | 32 MB       | iPhone 6–7, Safari under pressure, low-end Android |
 * | LOW   | 48 MB       | iPhone SE, iPad 6th, 2GB Android |
 * | MID   | 96 MB       | iPhone 12, mid-range Android, 4GB laptops |
 * | HIGH  | 192 MB      | Desktop, gaming laptops, iPad Pro |
 * | ULTRA | 256 MB      | High-end desktop, WebGPU, cinematic scenes |
 */

import { SpriteCache } from '@zakkster/lite-sprite-cache';
import { DeviceTier, detectDeviceTier } from './deviceTier.js';

/** @type {Record<string, import('@zakkster/lite-sprite-cache').SpriteCacheOptions>} */
const PRESETS = {
    safe: {
        maxMemoryMB:    32,
        fetchTimeoutMs: 6000,
        onEvict:        null
    },
    [DeviceTier.LOW]: {
        maxMemoryMB:    48,
        fetchTimeoutMs: 8000,
        onEvict:        null
    },
    [DeviceTier.MID]: {
        maxMemoryMB:    96,
        fetchTimeoutMs: 12000,
        onEvict:        null
    },
    [DeviceTier.HIGH]: {
        maxMemoryMB:    192,
        fetchTimeoutMs: 15000,
        onEvict:        null
    },
    ultra: {
        maxMemoryMB:    256,
        fetchTimeoutMs: 20000,
        onEvict:        null
    }
};

/**
 * Creates a SpriteCache pre-configured for the given device tier.
 * Accepts partial overrides that merge with tier defaults.
 *
 * @param {number|string} tier - DeviceTier.LOW|MID|HIGH, or 'safe'|'ultra'.
 * @param {Object} [overrides]
 * @returns {SpriteCache}
 */
export function createSpriteCacheForTier(tier, overrides = {}) {
    const defaults = PRESETS[tier] || PRESETS[DeviceTier.HIGH];
    return new SpriteCache({ ...defaults, ...overrides });
}

/**
 * Returns raw preset defaults without creating an instance.
 *
 * @param {number|string} tier
 * @returns {import('@zakkster/lite-sprite-cache').SpriteCacheOptions}
 */
export function getTierDefaults(tier) {
    return { ...(PRESETS[tier] || PRESETS[DeviceTier.HIGH]) };
}

/**
 * Convenience: auto-detects device tier and creates a configured SpriteCache.
 *
 * @param {Object} [overrides]
 * @returns {{ cache: SpriteCache, tier: import('./deviceTier.js').TierResult }}
 *
 * @example
 * ```js
 * const { cache, tier } = createCacheAuto();
 * console.log(`Using ${tier.tierName} tier (${cache.stats().maxMemoryMB}MB)`);
 * ```
 */
export function createCacheAuto(overrides = {}) {
    const tier = detectDeviceTier();
    const cache = createSpriteCacheForTier(tier.tier, overrides);
    return { cache, tier };
}
