export { DeviceTier, detectDeviceTier } from './deviceTier.js';
export { createSpriteCacheForTier, getTierDefaults, createCacheAuto } from './presets.js';
export { AssetCategory, EVICTION_ORDER, CategoryRegistry } from './categoryRegistry.js';
export { VramManager } from './vramManager.js';
export { loadScene, unloadScene, transitionScenes, preloadScene, cleanupPartialLoad } from './sceneStreaming.js';
export { AssetResolver, resolveTextureUrl } from './assetResolver.js';
export { VramHUD } from './vramHud.js';
export { runSafariStressTest, runResolutionSweep } from './safariStressTest.js';
