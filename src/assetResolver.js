/**
 * Asset Resolver — Tier-aware texture URL resolution.
 *
 * | Tier | Suffix  | Example              |
 * |------|---------|----------------------|
 * | LOW  | @0.5x  | assets/hero@0.5x.png |
 * | MID  | @0.75x | assets/hero@0.75x.png|
 * | HIGH | (none) | assets/hero.png       |
 */

import { DeviceTier } from './deviceTier.js';

/** @type {Record<number, string>} */
const DEFAULT_SUFFIXES = {
    [DeviceTier.LOW]:  '@0.5x',
    [DeviceTier.MID]:  '@0.75x',
    [DeviceTier.HIGH]: ''
};

const KNOWN_TIERS = new Set([DeviceTier.LOW, DeviceTier.MID, DeviceTier.HIGH]);

export class AssetResolver {
    /**
     * @param {Object} [options]
     * @param {string} [options.basePath='assets']
     * @param {string} [options.extension='.png']
     * @param {Record<number, string>} [options.suffixes]
     */
    constructor({
        basePath  = 'assets',
        extension = '.png',
        suffixes  = {}
    } = {}) {
        this.basePath  = basePath.replace(/\/+$/, '');
        this.extension = extension;
        this.suffixes  = { ...DEFAULT_SUFFIXES, ...suffixes };
    }

    /**
     * Resolves a logical asset ID to a tier-appropriate URL.
     *
     * @param {string} id
     * @param {number} tier
     * @returns {string}
     */
    resolve(id, tier) {
        if (!KNOWN_TIERS.has(tier)) {
            console.warn(`AssetResolver: Unknown tier ${tier} — falling back to HIGH (no suffix)`);
        }
        const suffix = this.suffixes[tier] ?? '';
        return `${this.basePath}/${id}${suffix}${this.extension}`;
    }

    /**
     * Bulk-resolves IDs into `{ id, url }` descriptors for `cache.loadAll()`.
     *
     * @param {string[]} ids
     * @param {number}   tier
     * @returns {Array<{id: string, url: string}>}
     */
    resolveAll(ids, tier) {
        return ids.map(id => ({ id, url: this.resolve(id, tier) }));
    }

    /**
     * Resolves a full scene's assets, preserving categories.
     * Converts `{ id, category }` entries into `{ id, url, category }`
     * ready for `loadScene()`.
     *
     * @param {Array<{id: string, category?: string}>} assets
     * @param {number} tier
     * @returns {Array<{id: string, url: string, category?: string}>}
     *
     * @example
     * ```js
     * const scene = {
     *     name: 'forest',
     *     assets: resolver.resolveSceneAssets([
     *         { id: 'bg',   category: 'bg' },
     *         { id: 'hero', category: 'char' },
     *         { id: 'hud',  category: 'ui' },
     *     ], tier)
     * };
     * await loadScene(cache, scene, registry);
     * ```
     */
    resolveSceneAssets(assets, tier) {
        return assets.map(a => ({
            id:   a.id,
            url:  this.resolve(a.id, tier),
            ...(a.category ? { category: a.category } : {})
        }));
    }
}

/**
 * Standalone function for simple one-off resolution.
 *
 * @param {string} id
 * @param {number} tier
 * @param {string} [basePath='assets']
 * @returns {string}
 */
export function resolveTextureUrl(id, tier, basePath = 'assets') {
    if (!KNOWN_TIERS.has(tier)) {
        console.warn(`resolveTextureUrl: Unknown tier ${tier} — falling back to HIGH`);
    }
    const suffix = DEFAULT_SUFFIXES[tier] ?? '';
    return `${basePath}/${id}${suffix}.png`;
}
