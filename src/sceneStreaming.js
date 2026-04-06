/**
 * Scene Streaming — Parallel load/unload/transition/preload pipeline.
 *
 * ⚠️ Always `unloadScene()` BEFORE `loadScene()` during transitions.
 * The `transitionScenes()` helper enforces correct ordering.
 */

/**
 * @typedef {Object} SceneAsset
 * @property {string} id
 * @property {string} url
 * @property {string} [category]
 */

/**
 * @typedef {Object} Scene
 * @property {string}       name
 * @property {SceneAsset[]} assets
 */

/**
 * @typedef {Object} LoadResult
 * @property {boolean}  ok
 * @property {number}   total
 * @property {number}   loaded
 * @property {number}   failed
 * @property {string[]} failures
 */

/**
 * Loads all assets for a scene in parallel.
 *
 * @param {import('@zakkster/lite-sprite-cache').SpriteCache} cache
 * @param {Scene} scene
 * @param {import('./categoryRegistry.js').CategoryRegistry} [registry]
 * @returns {Promise<LoadResult>}
 */
export async function loadScene(cache, scene, registry = null) {
    const { assets } = scene;

    if (registry) {
        for (const asset of assets) {
            if (asset.category) registry.register(asset.id, asset.category);
        }
    }

    const results = await cache.loadAll(assets);

    const failures = [];
    for (let i = 0; i < assets.length; i++) {
        if (results[i] === null) failures.push(assets[i].id);
    }

    return {
        ok:       failures.length === 0,
        total:    assets.length,
        loaded:   assets.length - failures.length,
        failed:   failures.length,
        failures
    };
}

/**
 * Unloads all assets for a scene immediately.
 *
 * @param {import('@zakkster/lite-sprite-cache').SpriteCache} cache
 * @param {Scene} scene
 * @param {import('./categoryRegistry.js').CategoryRegistry} [registry]
 */
export function unloadScene(cache, scene, registry = null) {
    for (const asset of scene.assets) {
        cache.dispose(asset.id);
        if (registry) registry.unregister(asset.id);
    }
}

/**
 * Safe scene transition: unloads old scene FIRST, then loads new scene.
 *
 * @param {import('@zakkster/lite-sprite-cache').SpriteCache} cache
 * @param {Scene} fromScene
 * @param {Scene} toScene
 * @param {import('./categoryRegistry.js').CategoryRegistry} [registry]
 * @returns {Promise<LoadResult>}
 */
export async function transitionScenes(cache, fromScene, toScene, registry = null) {
    unloadScene(cache, fromScene, registry);
    return loadScene(cache, toScene, registry);
}

/**
 * Preloads a scene's assets WITHOUT unloading the current scene.
 *
 * Useful for portals, cutscene pre-buffering, and background loading
 * where both scenes must coexist in VRAM temporarily.
 *
 * If some assets fail, the successfully loaded assets remain cached.
 * Call `cleanupPartialLoad()` to roll back if needed.
 *
 * @param {import('@zakkster/lite-sprite-cache').SpriteCache} cache
 * @param {Scene} scene
 * @param {import('./categoryRegistry.js').CategoryRegistry} [registry]
 * @returns {Promise<LoadResult>}
 */
export async function preloadScene(cache, scene, registry = null) {
    return loadScene(cache, scene, registry);
}

/**
 * Rolls back a partially loaded scene.
 *
 * If `loadScene()` or `preloadScene()` reported failures, this function
 * disposes the assets that DID load successfully, preventing half-loaded
 * scenes from occupying VRAM.
 *
 * @param {import('@zakkster/lite-sprite-cache').SpriteCache} cache
 * @param {Scene} scene
 * @param {LoadResult} result - The result from loadScene/preloadScene.
 * @param {import('./categoryRegistry.js').CategoryRegistry} [registry]
 *
 * @example
 * ```js
 * const result = await loadScene(cache, bossScene, registry);
 * if (!result.ok) {
 *     console.warn(`${result.failed} assets failed — rolling back`);
 *     cleanupPartialLoad(cache, bossScene, result, registry);
 * }
 * ```
 */
export function cleanupPartialLoad(cache, scene, result, registry = null) {
    const failedSet = new Set(result.failures);

    for (const asset of scene.assets) {
        if (registry) {
            registry.unregister(asset.id);
        }

        // Only dispose assets that successfully made it to VRAM
        if (!failedSet.has(asset.id)) {
            cache.dispose(asset.id);
        }
    }
}