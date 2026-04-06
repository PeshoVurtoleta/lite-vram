/**
 * Asset Category Registry — Priority-based VRAM eviction metadata.
 *
 * Eviction order (first to die → last to die):
 *   TEMP → FX → BG → CHAR → UI (immune)
 */

export const AssetCategory = {
    TEMP: 'temp',
    FX:   'fx',
    BG:   'bg',
    CHAR: 'char',
    UI:   'ui'
};

/** @type {ReadonlySet<string>} */
const VALID_CATEGORIES = new Set(Object.values(AssetCategory));

/**
 * Eviction priority order. Lower index = evicted first.
 * UI is absent — immune to priority-based eviction.
 * @type {ReadonlyArray<string>}
 */
export const EVICTION_ORDER = [
    AssetCategory.TEMP,
    AssetCategory.FX,
    AssetCategory.BG,
    AssetCategory.CHAR
];

export class CategoryRegistry {
    constructor() {
        /** @type {Map<string, string>} */
        this._map = new Map();
    }

    /**
     * Tags an asset ID with a category.
     * Validates the category against AssetCategory values.
     * Invalid or unknown categories are coerced to TEMP with a console warning.
     *
     * @param {string} id
     * @param {string} category
     */
    register(id, category) {
        if (!VALID_CATEGORIES.has(category)) {
            console.warn(`CategoryRegistry: Unknown category "${category}" for [${id}] — treating as TEMP`);
            category = AssetCategory.TEMP;
        }
        this._map.set(id, category);
    }

    /**
     * Registers multiple assets at once.
     * @param {Array<{id: string, category: string}>} assets
     */
    registerBatch(assets) {
        for (const { id, category } of assets) {
            this.register(id, category);
        }
    }

    /**
     * Returns the category for an asset, or `undefined` if unregistered.
     * @param {string} id
     * @returns {string|undefined}
     */
    getCategory(id) {
        return this._map.get(id);
    }

    /**
     * Returns true if the ID is registered.
     * @param {string} id
     * @returns {boolean}
     */
    has(id) {
        return this._map.has(id);
    }

    /**
     * Returns true if the asset can be evicted by the priority system.
     * UI assets are immune. Unregistered assets are evictable.
     * @param {string} id
     * @returns {boolean}
     */
    isEvictable(id) {
        return this._map.get(id) !== AssetCategory.UI;
    }

    /**
     * Returns the eviction bucket index for a category.
     * Lower = evicted first. Returns -1 for UI (immune) or unknown categories.
     *
     * @param {string} category
     * @returns {number}
     */
    getEvictionBucket(category) {
        return EVICTION_ORDER.indexOf(category);
    }

    /** @param {string} id */
    unregister(id) {
        this._map.delete(id);
    }

    /**
     * Returns all registered IDs sorted by eviction priority.
     * TEMP first, CHAR last. UI excluded entirely.
     * @returns {string[]}
     */
    getIdsByPriority() {
        const buckets = new Map();
        for (const cat of EVICTION_ORDER) {
            buckets.set(cat, []);
        }

        for (const [id, category] of this._map) {
            if (category === AssetCategory.UI) continue;
            const bucket = buckets.get(category);
            if (bucket) {
                bucket.push(id);
            } else {
                buckets.get(AssetCategory.TEMP).push(id);
            }
        }

        const result = [];
        for (const cat of EVICTION_ORDER) {
            const ids = buckets.get(cat);
            for (let i = 0; i < ids.length; i++) result.push(ids[i]);
        }
        return result;
    }

    /**
     * Returns all IDs registered under a specific category.
     * @param {string} category
     * @returns {string[]}
     */
    getIdsByCategory(category) {
        const result = [];
        for (const [id, cat] of this._map) {
            if (cat === category) result.push(id);
        }
        return result;
    }

    /**
     * Returns all registered entries as `[id, category]` pairs.
     * Useful for debugging and diagnostics.
     * @returns {Array<[string, string]>}
     */
    getAll() {
        return Array.from(this._map.entries());
    }

    /** Clears all registrations. */
    clear() {
        this._map.clear();
    }

    /** @returns {number} */
    get size() {
        return this._map.size;
    }
}
