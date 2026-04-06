import type { SpriteCache, SpriteCacheOptions } from '@zakkster/lite-sprite-cache';
import type { TierResult } from './deviceTier';

/**
 * Creates a SpriteCache configured for the given tier.
 * @param tier - DeviceTier.LOW|MID|HIGH, or 'safe'|'ultra'.
 * @param overrides - Partial options merged onto tier defaults.
 */
export declare function createSpriteCacheForTier(
    tier: number | string,
    overrides?: Partial<SpriteCacheOptions>
): SpriteCache;

/** Returns raw preset defaults without creating an instance. */
export declare function getTierDefaults(tier: number | string): SpriteCacheOptions;

/**
 * Auto-detects device tier and creates a configured SpriteCache.
 * @returns The cache and the full tier detection result.
 */
export declare function createCacheAuto(
    overrides?: Partial<SpriteCacheOptions>
): { cache: SpriteCache; tier: TierResult };
