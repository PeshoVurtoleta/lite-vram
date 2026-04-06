export { DeviceTier, detectDeviceTier } from './deviceTier';
export type { TierResult, TierSignals } from './deviceTier';

export { AssetCategory, EVICTION_ORDER, CategoryRegistry } from './categoryRegistry';

export { VramManager } from './vramManager';
export type { VramManagerOptions, VramManagerStats } from './vramManager';

export { loadScene, unloadScene, transitionScenes, preloadScene, cleanupPartialLoad } from './sceneStreaming';
export type { Scene, SceneAsset, LoadResult } from './sceneStreaming';

export { createSpriteCacheForTier, getTierDefaults, createCacheAuto } from './presets';

export { AssetResolver, resolveTextureUrl } from './assetResolver';
export type { AssetResolverOptions } from './assetResolver';

export { VramHUD } from './vramHud';
export type { VramHUDOptions } from './vramHud';

export { runSafariStressTest, runResolutionSweep } from './safariStressTest';
export type {
    StressIteration,
        StressTestResult,
        StressTestOptions,
        ResolutionSweepOptions,
        ResolutionSweepEntry
} from './safariStressTest';