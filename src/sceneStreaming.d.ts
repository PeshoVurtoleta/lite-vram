import type { SpriteCache } from '@zakkster/lite-sprite-cache';
import type { CategoryRegistry } from './categoryRegistry';

export interface SceneAsset {
    id: string;
    url: string;
    category?: string;
}

export interface Scene {
    name: string;
    assets: SceneAsset[];
}

export interface LoadResult {
    /** True if all assets loaded successfully. */
    ok: boolean;
    total: number;
    loaded: number;
    failed: number;
    /** IDs of assets that returned null. */
    failures: string[];
}

/** Loads all scene assets in parallel. */
export declare function loadScene(
    cache: SpriteCache,
    scene: Scene,
    registry?: CategoryRegistry | null
): Promise<LoadResult>;

/** Disposes all scene assets immediately. */
export declare function unloadScene(
    cache: SpriteCache,
    scene: Scene,
    registry?: CategoryRegistry | null
): void;

/** Unloads old scene first, then loads new scene. */
export declare function transitionScenes(
    cache: SpriteCache,
    fromScene: Scene,
    toScene: Scene,
    registry?: CategoryRegistry | null
): Promise<LoadResult>;

/** Loads scene assets without unloading the current scene. */
export declare function preloadScene(
    cache: SpriteCache,
    scene: Scene,
    registry?: CategoryRegistry | null
): Promise<LoadResult>;

/** Rolls back a partially loaded scene — disposes assets that succeeded. */
export declare function cleanupPartialLoad(
    cache: SpriteCache,
    scene: Scene,
    result: LoadResult,
    registry?: CategoryRegistry | null
): void;
