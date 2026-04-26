export { DeviceTier, detectDeviceTier } from './src/deviceTier.js';
export { createSpriteCacheForTier, getTierDefaults, createCacheAuto } from './src/presets.js';
export { WATERMARKS, getWatermarksForTier } from './src/watermarks.js';
export { AssetCategory, EVICTION_ORDER, CategoryRegistry } from './src/categoryRegistry.js';
export { VramManager } from './src/vramManager.js';
export { loadScene, unloadScene, transitionScenes, preloadScene, cleanupPartialLoad } from './src/sceneStreaming.js';
export { AssetResolver, resolveTextureUrl } from './src/assetResolver.js';
export { VramHUD } from './src/vramHud.js';
export { runSafariStressTest, runResolutionSweep } from './src/safariStressTest.js';
