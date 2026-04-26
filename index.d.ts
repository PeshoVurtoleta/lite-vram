export { DeviceTier, detectDeviceTier } from './src/deviceTier';
export type { TierResult, TierSignals } from './src/deviceTier';

export { AssetCategory, EVICTION_ORDER, CategoryRegistry } from './src/categoryRegistry';

export { VramManager } from './src/vramManager';
export type { VramManagerOptions, VramManagerStats } from './src/vramManager';

export { loadScene, unloadScene, transitionScenes, preloadScene, cleanupPartialLoad } from './src/sceneStreaming';
export type { Scene, SceneAsset, LoadResult } from './src/sceneStreaming';

export { createSpriteCacheForTier, getTierDefaults, createCacheAuto } from './src/presets';

export { WATERMARKS, getWatermarksForTier } from './src/watermarks';
export type { WatermarkConfig, VramManagerWatermarks } from './src/watermarks';

export { AssetResolver, resolveTextureUrl } from './src/assetResolver';
export type { AssetResolverOptions } from './src/assetResolver';

export { VramHUD } from './src/vramHud';
export type { VramHUDOptions } from './src/vramHud';

export { runSafariStressTest, runResolutionSweep } from './src/safariStressTest';
export type {
    StressIteration,
    StressTestResult,
    StressTestOptions,
    ResolutionSweepOptions,
    ResolutionSweepEntry,
    DecodeHistogram,
    IterationClassification
} from './src/safariStressTest';
